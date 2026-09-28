"""Rules that flag a care plan for the physio (milestone A3 of docs/digital-twin/A-knee-twin.md).

Each rule is a pure function of the patient's timeline, so it can be unit-tested without a database. `evaluate_plan`
runs them all when new data arrives (check-in, reading, target change) and once a day from cron, then:

- opens a flag for a new hit, or updates the active one (at most one active flag per plan and rule);
- auto-resolves an active flag once its condition has been false for `auto_resolve_days` (never for red flags);
- doesn't re-open what a physio closed until the condition has cleared (condition rules) or a new event occurs
  (event rules like red flags, keyed by day) — so dismissing a flag actually quiets it.

Thresholds live in the `twin_rules` platform setting so a clinical lead can tune them without a deploy.
R4 (behind the expected recovery band) stays off until the reference band is clinically signed off.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.clinical import CarePlan, CarePlanStatus
from app.models.patient import ClinicPatient
from app.models.twin import ACTIVE_FLAG_STATUSES, CarePlanTarget, DailyCheckin, FlagSeverity, FlagStatus, Measurement, Side, TwinFlag
from app.services.adherence import DayStat, day_stats
from app.services.checkins import CHECKIN_PROTOCOLS, RED_FLAGS, TWIN_TRACKING, active_consent
from app.services.settings import DEFAULT_SETTINGS, get_setting
from app.services.suggestions import expire_for_ended_plans, expire_for_flag, propose

IST = ZoneInfo("Asia/Kolkata")

EVENT_RULES = {"pain_high", "red_flag"}  # keyed per occurrence (day)
MANUAL_ONLY = {"red_flag"}  # a physio must close these
SEVERITY_RANK = {FlagSeverity.INFO: 0, FlagSeverity.WATCH: 1, FlagSeverity.ACT: 2}
SEVERITY_ORDER = {s.value: r for s, r in SEVERITY_RANK.items()}
SIDE_NAME = {Side.LEFT: "Left", Side.RIGHT: "Right"}


def local_today() -> date:
    return datetime.now(IST).date()


def base_rule(rule: str) -> str:
    return rule.split(":", 1)[0]


@dataclass
class Reading:
    value: float
    day: date


@dataclass
class Timeline:
    today: date
    checkins: list[DailyCheckin] = field(default_factory=list)  # oldest first
    flexion: dict[Side, list[Reading]] = field(default_factory=dict)  # trusted, oldest first
    targets: dict[Side, float] = field(default_factory=dict)  # knee flexion targets
    days: list[DayStat] = field(default_factory=list)  # exercise schedule before today, oldest first
    consent_since: date | None = None


@dataclass
class Hit:
    rule: str
    key: str
    severity: FlagSeverity
    summary: str
    evidence: dict


# ── Rules (pure) ────────────────────────────────────────────────────────────


def pain_rising(t: Timeline, cfg: dict) -> Hit | None:
    recent = [c.pain for c in t.checkins if t.today - timedelta(days=2) <= c.day <= t.today]
    prior = [c.pain for c in t.checkins if t.today - timedelta(days=9) <= c.day < t.today - timedelta(days=2)]
    if len(recent) < 2 or len(prior) < 3:
        return None
    now, before = sum(recent) / len(recent), sum(prior) / len(prior)
    if now < before + cfg["pain_rising_delta"]:
        return None
    return Hit("pain_rising", "pain_rising", FlagSeverity.WATCH,
               f"3-day average {now:.1f}/10 vs {before:.1f}/10 the week before",
               {"avg_3d": round(now, 1), "avg_prev_7d": round(before, 1), "threshold": cfg["pain_rising_delta"]})


def pain_high(t: Timeline, cfg: dict) -> Hit | None:
    high = [c for c in t.checkins if c.day >= t.today - timedelta(days=2) and c.pain >= cfg["pain_high"]]
    if not high:
        return None
    last = high[-1]
    return Hit("pain_high", last.day.isoformat(), FlagSeverity.ACT, f"{last.pain}/10 reported on {last.day:%a %d %b}",
               {"day": last.day.isoformat(), "pain": last.pain, "threshold": cfg["pain_high"]})


def red_flag(t: Timeline, cfg: dict) -> Hit | None:
    flagged = [c for c in t.checkins if c.day >= t.today - timedelta(days=1) and c.red_flags]
    if not flagged:
        return None
    last = flagged[-1]
    labels = [RED_FLAGS.get(f, f) for f in last.red_flags]
    return Hit("red_flag", last.day.isoformat(), FlagSeverity.ACT, f"{', '.join(labels)} · reported {last.day:%a %d %b}"[:300],
               {"day": last.day.isoformat(), "red_flags": list(last.red_flags), "pain": last.pain})


def rom_plateau(t: Timeline, cfg: dict, side: Side) -> Hit | None:
    r = t.flexion.get(side, [])[-3:]
    target = t.targets.get(side)
    if len(r) < 3 or target is None or r[-1].value >= target:
        return None
    values = [x.value for x in r]
    span = (r[-1].day - r[0].day).days
    if span < cfg["plateau_min_span_days"] or max(values) - min(values) >= cfg["plateau_min_change_deg"]:
        return None
    return Hit(f"rom_plateau:{side.value}", f"rom_plateau:{side.value}", FlagSeverity.WATCH,
               f"{SIDE_NAME[side]} knee flexion flat at {min(values):g}–{max(values):g}° over {span} days (target {target:g}°)",
               {"side": side.value, "readings": [{"day": x.day.isoformat(), "value": x.value} for x in r], "target": target})


def rom_drop(t: Timeline, cfg: dict, side: Side) -> Hit | None:
    r = t.flexion.get(side, [])
    if len(r) < 2:
        return None
    best, latest = max(x.value for x in r[:-1]), r[-1].value
    if best - latest < cfg["rom_drop_deg"]:
        return None
    return Hit(f"rom_drop:{side.value}", f"rom_drop:{side.value}", FlagSeverity.ACT,
               f"{SIDE_NAME[side]} knee flexion dropped to {latest:g}° (best {best:g}°)",
               {"side": side.value, "latest": latest, "best": best, "day": r[-1].day.isoformat(), "threshold": cfg["rom_drop_deg"]})


def missed_sessions(t: Timeline, cfg: dict) -> Hit | None:
    n = cfg["missed_days"]
    scheduled = [d for d in t.days if d.scheduled > 0 and d.day < t.today][-n:]
    if len(scheduled) < n or any(d.done for d in scheduled):
        return None
    return Hit("missed_sessions", "missed_sessions", FlagSeverity.WATCH, f"No exercises logged on the last {n} scheduled days",
               {"days": [d.day.isoformat() for d in scheduled]})


def no_checkin(t: Timeline, cfg: dict) -> Hit | None:
    n = cfg["no_checkin_days"]
    if t.consent_since is None:
        return None
    last = t.checkins[-1].day if t.checkins else t.consent_since
    gap = (t.today - last).days
    if gap < n:
        return None
    return Hit("no_checkin", "no_checkin", FlagSeverity.INFO, f"No check-in for {gap} days",
               {"last_checkin": t.checkins[-1].day.isoformat() if t.checkins else None, "days": gap})


def evaluate(t: Timeline, cfg: dict) -> tuple[list[Hit], set[str]]:
    """All hits, plus every rule id that was evaluated (so rules that didn't fire can count towards auto-resolve)."""
    hits: list[Hit | None] = [pain_rising(t, cfg), pain_high(t, cfg), red_flag(t, cfg), missed_sessions(t, cfg), no_checkin(t, cfg)]
    evaluated = {"pain_rising", "pain_high", "red_flag", "missed_sessions", "no_checkin"}
    for side in sorted(set(t.flexion) | set(t.targets)):
        hits += [rom_plateau(t, cfg, side), rom_drop(t, cfg, side)]
        evaluated |= {f"rom_plateau:{side.value}", f"rom_drop:{side.value}"}
    return [h for h in hits if h], evaluated


# ── Applying hits to flags ──────────────────────────────────────────────────


def build_timeline(db: Session, plan: CarePlan, today: date) -> Timeline:
    cp = db.get(ClinicPatient, plan.clinic_patient_id)
    t = Timeline(today=today)
    t.checkins = list(db.scalars(
        select(DailyCheckin).where(DailyCheckin.care_plan_id == plan.id, DailyCheckin.day > today - timedelta(days=30), DailyCheckin.day <= today)
        .order_by(DailyCheckin.day)
    ))
    for m in db.scalars(
        select(Measurement).where(Measurement.clinic_patient_id == cp.id, Measurement.code == "knee_flexion", Measurement.trusted.is_(True))
        .order_by(Measurement.measured_at)
    ):
        t.flexion.setdefault(m.side, []).append(Reading(float(m.value), m.measured_at.astimezone(IST).date()))
    t.targets = {tg.side: float(tg.target_value) for tg in db.scalars(
        select(CarePlanTarget).where(CarePlanTarget.care_plan_id == plan.id, CarePlanTarget.code == "knee_flexion"))}
    t.days = day_stats(db, cp.patient_id, today - timedelta(days=14), today - timedelta(days=1), [plan.id])
    consent = active_consent(db, cp.patient_id, TWIN_TRACKING)
    t.consent_since = consent.granted_at.astimezone(IST).date() if consent else None
    return t


def _config(db: Session) -> dict:
    return DEFAULT_SETTINGS["twin_rules"] | get_setting(db, "twin_rules")  # new keys still get their defaults


def apply_hits(db: Session, plan: CarePlan, hits: Sequence[Hit], evaluated: set[str], today: date, auto_resolve_days: int) -> None:
    now = datetime.now(UTC)
    active = {f.rule: f for f in db.scalars(select(TwinFlag).where(TwinFlag.care_plan_id == plan.id, TwinFlag.status.in_(ACTIVE_FLAG_STATUSES)))}
    hit_rules = {h.rule for h in hits}
    opened: list[TwinFlag] = []  # new or re-opened flags, which may get a plan suggestion

    for h in hits:
        f = active.get(h.rule)
        if f is not None:
            if base_rule(h.rule) in EVENT_RULES and h.key < f.key:
                continue  # an older occurrence (keys are ISO days); the flag already shows a newer one
            if base_rule(h.rule) in EVENT_RULES and f.key != h.key:
                f.status = FlagStatus.OPEN  # a new occurrence: make sure the physio sees it again
                f.opened_at = now
                expire_for_flag(db, f.id)  # the old occurrence's suggestion no longer applies
                opened.append(f)
            if SEVERITY_RANK[h.severity] > SEVERITY_RANK[f.severity]:
                f.severity = h.severity
            f.key, f.summary, f.evidence, f.last_seen_at, f.clear_since = h.key, h.summary, h.evidence, now, None
            continue
        closed = db.scalar(
            select(TwinFlag).where(TwinFlag.care_plan_id == plan.id, TwinFlag.rule == h.rule, TwinFlag.resolved_by.is_not(None))
            .order_by(TwinFlag.resolved_at.desc()).limit(1)
        )
        if closed is not None and closed.key == h.key and not closed.cleared:
            continue  # a physio closed this and nothing has changed since
        f = TwinFlag(clinic_patient_id=plan.clinic_patient_id, care_plan_id=plan.id, rule=h.rule, key=h.key, severity=h.severity,
                     summary=h.summary, evidence=h.evidence, opened_at=now, last_seen_at=now)
        db.add(f)
        opened.append(f)

    for rule in evaluated - hit_rules:
        f = active.get(rule)
        if f is not None and base_rule(rule) not in MANUAL_ONLY:
            if f.clear_since is None:
                f.clear_since = today
            elif (today - f.clear_since).days >= auto_resolve_days:
                f.status, f.resolved_at = FlagStatus.RESOLVED, now
                f.resolution_note = f"Resolved automatically: back to normal for {auto_resolve_days} days"
                expire_for_flag(db, f.id)
        db.execute(update(TwinFlag).where(TwinFlag.care_plan_id == plan.id, TwinFlag.rule == rule,
                                          TwinFlag.status.not_in(ACTIVE_FLAG_STATUSES), TwinFlag.cleared.is_(False)).values(cleared=True))

    if opened:
        db.flush()
        for f in opened:
            propose(db, plan, f, today)


def evaluate_plan(db: Session, plan: CarePlan | None, today: date | None = None) -> None:
    """Re-run the rules for one plan. Call after flushing new data, inside the caller's transaction."""
    if plan is None or plan.status != CarePlanStatus.ACTIVE or plan.protocol not in CHECKIN_PROTOCOLS:
        return
    today = today or local_today()
    cfg = _config(db)
    hits, evaluated = evaluate(build_timeline(db, plan, today), cfg)
    apply_hits(db, plan, hits, evaluated, today, cfg["auto_resolve_days"])


def evaluate_all(db: Session, today: date | None = None) -> dict:
    """Daily cron: time-based rules (missed sessions, no check-ins), auto-resolve, and closing flags of ended plans."""
    plans = list(db.scalars(select(CarePlan).where(CarePlan.status == CarePlanStatus.ACTIVE, CarePlan.protocol.in_(CHECKIN_PROTOCOLS))))
    for plan in plans:
        evaluate_plan(db, plan, today)
    ended = db.execute(
        update(TwinFlag)
        .where(TwinFlag.status.in_(ACTIVE_FLAG_STATUSES), TwinFlag.care_plan_id.in_(select(CarePlan.id).where(CarePlan.status != CarePlanStatus.ACTIVE)))
        .values(status=FlagStatus.RESOLVED, resolved_at=datetime.now(UTC), resolution_note="Care plan ended")
    ).rowcount
    expired = expire_for_ended_plans(db)
    return {"plans_evaluated": len(plans), "flags_closed_plan_ended": ended, "suggestions_expired": expired}


def active_plan_for(db: Session, clinic_patient_id: uuid.UUID) -> CarePlan | None:
    return db.scalar(select(CarePlan).where(CarePlan.clinic_patient_id == clinic_patient_id, CarePlan.status == CarePlanStatus.ACTIVE)
                     .order_by(CarePlan.created_at.desc()).limit(1))
