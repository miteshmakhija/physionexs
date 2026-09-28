"""Digital twin: what can be measured, how readings are checked, and the per-patient twin view.

Design: docs/digital-twin/A-knee-twin.md (milestone A1: structured measurements, targets, read-only twin).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.clinical import AffectedSide, CarePlan
from app.models.patient import ClinicPatient, Patient
from app.models.twin import ACTIVE_FLAG_STATUSES, CarePlanTarget, DailyCheckin, Measurement, Side, TwinFlag
from app.models.user import User
from app.schemas.twin import CodeOut, FlagOut, MeasurementOut, RecoveryDayOut, RecoveryMeasureOut, RecoveryOut, RecoveryReadingOut, TwinMeasureOut, TwinOut
from app.services.checkins import RED_FLAGS, checkin_out
from app.services.suggestions import pending_for_flag, suggestion_out


@dataclass(frozen=True)
class Code:
    label: str
    unit: str
    lo: float
    hi: float
    sided: bool
    higher_is_better: bool
    # A change bigger than this from the last trusted reading within JUMP_WINDOW is held for confirmation.
    max_jump: float | None = None


CODES: dict[str, Code] = {
    "knee_flexion": Code("Knee flexion", "deg", 0, 160, sided=True, higher_is_better=True, max_jump=30),
    "knee_extension_lag": Code("Knee extension lag", "deg", 0, 60, sided=True, higher_is_better=False, max_jump=30),
    "knee_girth": Code("Knee girth", "cm", 20, 80, sided=True, higher_is_better=False),
    "pain_nprs": Code("Pain (NPRS)", "score", 0, 10, sided=False, higher_is_better=False),
}

PROTOCOLS = {"tka": "Knee replacement (TKA)"}
# Measures shown for a protocol even before the first reading, on the affected side(s).
PROTOCOL_MEASURES = {"tka": ["knee_flexion", "knee_extension_lag"]}

JUMP_WINDOW = timedelta(hours=48)
FUTURE_SLACK = timedelta(minutes=5)


def check(code: str, side: Side, value: float) -> Code:
    """Reject unknown codes, wrong sidedness and physiologically impossible values (422)."""
    spec = CODES.get(code)
    if spec is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown measure: {code}")
    if spec.sided != (side != Side.NONE):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{spec.label} needs {'a left or right side' if spec.sided else 'side “none”'}")
    if not spec.lo <= value <= spec.hi:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{spec.label} must be between {spec.lo:g} and {spec.hi:g} {spec.unit}")
    return spec


def is_plausible(spec: Code, value: float, previous: float | None) -> bool:
    return spec.max_jump is None or previous is None or abs(value - previous) <= spec.max_jump


def last_trusted(db: Session, cp_id: uuid.UUID, code: str, side: Side, before: datetime) -> Measurement | None:
    return db.scalar(
        select(Measurement)
        .where(Measurement.clinic_patient_id == cp_id, Measurement.code == code, Measurement.side == side,
               Measurement.trusted.is_(True), Measurement.measured_at <= before, Measurement.measured_at >= before - JUMP_WINDOW)
        .order_by(Measurement.measured_at.desc())
        .limit(1)
    )


def measured_at_or_now(at: datetime | None) -> datetime:
    now = datetime.now(UTC)
    if at is None:
        return now
    if at.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "measured_at needs a timezone")
    if at > now + FUTURE_SLACK:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A measurement can't be in the future")
    return at


def progress(spec: Code, baseline: float | None, latest: float | None, target: float | None) -> tuple[str, int | None]:
    """Status and % of the way from baseline to target, respecting whether higher or lower is better."""
    if latest is None:
        return "no_data", None
    if target is None:
        return "no_target", None
    met = latest >= target if spec.higher_is_better else latest <= target
    if met:
        return "target_met", 100
    if baseline is None or baseline == target:
        return "in_progress", 0
    pct = (latest - baseline) / (target - baseline) * 100
    return "in_progress", max(0, min(99, round(pct)))


def weeks_since(day: date | None, today: date | None = None) -> int | None:
    if day is None:
        return None
    days = ((today or date.today()) - day).days
    return days // 7 if days >= 0 else None


def measurement_out(m: Measurement, names: dict[uuid.UUID, str]) -> MeasurementOut:
    spec = CODES.get(m.code)
    return MeasurementOut(
        id=m.id, code=m.code, label=spec.label if spec else m.code, unit=m.unit, side=m.side, value=float(m.value),
        source=m.source, method=m.method, measured_at=m.measured_at, trusted=m.trusted,
        confidence=float(m.confidence) if m.confidence is not None else None, note=m.note,
        consultation_id=m.consultation_id, recorded_by_name=names.get(m.recorded_by) if m.recorded_by else None,
    )


def user_names(db: Session, rows: list[Measurement]) -> dict[uuid.UUID, str]:
    ids = {m.recorded_by for m in rows if m.recorded_by}
    return dict(db.execute(select(User.id, User.full_name).where(User.id.in_(ids))).all()) if ids else {}


def _sides(affected: AffectedSide | None) -> list[Side]:
    return {AffectedSide.LEFT: [Side.LEFT], AffectedSide.RIGHT: [Side.RIGHT], AffectedSide.BOTH: [Side.LEFT, Side.RIGHT]}.get(affected, [])


def twin_out(db: Session, cp: ClinicPatient, plan: CarePlan | None) -> TwinOut:
    rows = list(db.scalars(select(Measurement).where(Measurement.clinic_patient_id == cp.id).order_by(Measurement.measured_at.desc()).limit(500)))
    names = user_names(db, rows)
    targets = {(t.code, t.side): t for t in db.scalars(select(CarePlanTarget).where(CarePlanTarget.care_plan_id == plan.id))} if plan else {}

    # Only check-ins made against this clinic's plans for the patient.
    checkins = list(db.scalars(
        select(DailyCheckin).join(CarePlan, CarePlan.id == DailyCheckin.care_plan_id)
        .where(CarePlan.clinic_patient_id == cp.id, DailyCheckin.day > date.today() - timedelta(days=30))
        .order_by(DailyCheckin.day.desc())
    ))

    keys: list[tuple[str, Side]] = []
    if plan and plan.protocol in PROTOCOL_MEASURES:
        keys += [(code, side) for code in PROTOCOL_MEASURES[plan.protocol] for side in _sides(plan.affected_side)]
    keys += list(targets)
    keys += [(m.code, m.side) for m in reversed(rows) if m.code in CODES]
    keys = list(dict.fromkeys(keys))  # de-duplicate, keep order

    measures = []
    for code, side in keys:
        spec = CODES[code]
        trusted = [m for m in rows if m.code == code and m.side == side and m.trusted]
        latest = trusted[0] if trusted else None
        baseline = float(trusted[-1].value) if trusted else None
        t = targets.get((code, side))
        target = float(t.target_value) if t else None
        state, pct = progress(spec, baseline, float(latest.value) if latest else None, target)
        measures.append(TwinMeasureOut(
            code=code, label=spec.label, unit=spec.unit, side=side, higher_is_better=spec.higher_is_better,
            latest=measurement_out(latest, names) if latest else None, baseline=baseline, target=target,
            by_week=t.by_week if t else None, status=state, progress_pct=pct,
        ))

    return TwinOut(
        care_plan_id=plan.id if plan else None,
        protocol=plan.protocol if plan else None,
        protocol_label=PROTOCOLS.get(plan.protocol) if plan and plan.protocol else None,
        surgery_date=plan.surgery_date if plan else None,
        affected_side=plan.affected_side if plan else None,
        weeks_since_surgery=weeks_since(plan.surgery_date) if plan else None,
        measures=measures,
        measurements=[measurement_out(m, names) for m in rows],
        codes=[CodeOut(code=k, label=c.label, unit=c.unit, sided=c.sided, min=c.lo, max=c.hi, higher_is_better=c.higher_is_better) for k, c in CODES.items()],
        checkins=[checkin_out(c) for c in checkins],
        red_flag_labels=RED_FLAGS,
        flags=[flag_out(db, f) for f in db.scalars(
            select(TwinFlag).where(TwinFlag.clinic_patient_id == cp.id,
                                   or_(TwinFlag.status.in_(ACTIVE_FLAG_STATUSES), TwinFlag.resolved_at >= datetime.now(UTC) - timedelta(days=30)))
            .order_by(TwinFlag.last_seen_at.desc())
        )],
    )


RULE_LABELS = {
    "pain_rising": "Pain rising",
    "pain_high": "High pain",
    "rom_plateau": "Knee bend plateau",
    "rom_drop": "Knee bend dropped",
    "missed_sessions": "Missed exercises",
    "no_checkin": "No check-ins",
    "red_flag": "Red flag",
}


def flag_out(db: Session, f: TwinFlag) -> FlagOut:
    cp = db.get(ClinicPatient, f.clinic_patient_id)
    by = db.get(User, f.resolved_by) if f.resolved_by else None
    return FlagOut(
        id=f.id, clinic_patient_id=f.clinic_patient_id, patient_name=db.get(Patient, cp.patient_id).full_name, rule=f.rule,
        rule_label=RULE_LABELS.get(f.rule.split(":", 1)[0], f.rule), severity=f.severity, status=f.status, summary=f.summary,
        evidence=f.evidence or {}, opened_at=f.opened_at, last_seen_at=f.last_seen_at, resolved_at=f.resolved_at,
        resolved_by_name=by.full_name if by else None, resolution_note=f.resolution_note,
        suggestion=suggestion_out(db, s) if (s := pending_for_flag(db, f.id)) else None,
        explanation=f.explanation,
    )


IST = ZoneInfo("Asia/Kolkata")

# Patient-facing wording (the console uses the clinical labels in CODES).
PATIENT_LABELS = {
    "knee_flexion": ("Knee bend", "How far your knee bends. Higher is better."),
    "knee_extension_lag": ("Knee straightening", "How far short of fully straight. 0° means fully straight."),
    "knee_girth": ("Knee swelling", "Measured around the knee. Lower means less swelling."),
}


def recovery_out(db: Session, cp: ClinicPatient, plan: CarePlan, clinic_name: str) -> RecoveryOut:
    """The patient's view: confirmed clinic readings (no camera estimates or held readings) and their check-ins."""
    t = twin_out(db, cp, plan)
    readings = [m for m in t.measurements if m.trusted and m.source.value == "clinic" and m.code in PATIENT_LABELS]
    return RecoveryOut(
        available=True, condition=plan.condition, clinic_name=clinic_name, surgery_date=t.surgery_date, weeks_since_surgery=t.weeks_since_surgery,
        measures=[
            RecoveryMeasureOut(
                code=m.code, label=PATIENT_LABELS[m.code][0], hint=PATIENT_LABELS[m.code][1], side=m.side, unit=m.unit, higher_is_better=m.higher_is_better,
                latest=m.latest.value if m.latest else None, latest_on=m.latest.measured_at.astimezone(IST).date() if m.latest else None,
                baseline=m.baseline, target=m.target, by_week=m.by_week, status=m.status, progress_pct=m.progress_pct,
            )
            for m in t.measures if m.code in PATIENT_LABELS
        ],
        readings=[RecoveryReadingOut(code=m.code, side=m.side, value=m.value, measured_on=m.measured_at.astimezone(IST).date()) for m in reversed(readings)],
        checkins=[RecoveryDayOut(day=c.day, pain=c.pain, stiffness=c.stiffness) for c in reversed(t.checkins)],
    )
