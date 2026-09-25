"""Staff management: team, attendance, leave and payroll.

The owner manages everything; every member can check in and request leave for themselves.
"""

import calendar
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser, require_clinic_member
from app.models.clinic import Branch, ClinicMember, MembershipRole, PhysioProfile
from app.models.engagement import Notification
from app.models.hr import Attendance, AttendanceStatus, LeaveRequest, LeaveStatus, LeaveType, Payslip, PayslipStatus
from app.models.user import User, UserRole
from app.schemas.business import AttendanceDay, AttendanceIn, LeaveIn, LeaveOut, PayrollOut, PayslipOut, StaffIn, StaffOut, StaffUpdate
from app.services import audit

router = APIRouter(prefix="/clinic", tags=["staff"])

Member = Annotated[ClinicMember, Depends(require_clinic_member())]
Owner = Annotated[ClinicMember, Depends(require_clinic_member(MembershipRole.OWNER))]
TZ = ZoneInfo("Asia/Kolkata")


def _today() -> date:
    return datetime.now(TZ).date()


def _member(db: Session, clinic_id: uuid.UUID, member_id: uuid.UUID) -> ClinicMember:
    m = db.get(ClinicMember, member_id)
    if m is None or m.clinic_id != clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team member not found")
    return m


def _staff_out(db: Session, m: ClinicMember, day: date | None = None) -> StaffOut:
    user = db.get(User, m.user_id)
    branch = db.get(Branch, m.branch_id) if m.branch_id else None
    att = db.scalar(select(Attendance).where(Attendance.member_id == m.id, Attendance.day == (day or _today())))
    return StaffOut(
        id=m.id, user_id=user.id, full_name=user.full_name, phone=user.phone, role=m.role, job_title=m.job_title, department=m.department,
        employee_code=m.employee_code, monthly_salary_paise=m.monthly_salary_paise, branch_id=m.branch_id, branch_name=branch.name if branch else None,
        joined_on=m.joined_on, is_active=m.is_active, today=att.status if att else None, check_in=att.check_in if att else None,
    )


# ── Team ────────────────────────────────────────────────────────────────────


@router.get("/staff", response_model=list[StaffOut])
def list_staff(member: Owner, db: DB, include_inactive: bool = False) -> list[StaffOut]:
    stmt = select(ClinicMember).where(ClinicMember.clinic_id == member.clinic_id)
    if not include_inactive:
        stmt = stmt.where(ClinicMember.is_active.is_(True))
    return [_staff_out(db, m) for m in db.scalars(stmt.order_by(ClinicMember.role, ClinicMember.created_at))]


@router.post("/staff", response_model=StaffOut, status_code=status.HTTP_201_CREATED)
def add_staff(body: StaffIn, member: Owner, user: CurrentUser, db: DB, request: Request) -> StaffOut:
    """Add a team member. They sign in with an OTP to their mobile number."""
    if body.branch_id and db.scalar(select(Branch.clinic_id).where(Branch.id == body.branch_id)) != member.clinic_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown branch")
    person = db.scalar(select(User).where(User.phone == body.phone))
    if person is None:
        person = User(full_name=body.full_name, phone=body.phone, role=UserRole.STAFF)
        db.add(person)
        db.flush()
    elif person.role == UserRole.PATIENT:
        raise HTTPException(status.HTTP_409_CONFLICT, "This number already has a patient account. Use a different number for staff.")
    elif person.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status.HTTP_409_CONFLICT, "This number belongs to a platform administrator")
    if db.scalar(select(ClinicMember.id).where(ClinicMember.clinic_id == member.clinic_id, ClinicMember.user_id == person.id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Already on your team")

    m = ClinicMember(
        clinic_id=member.clinic_id, user_id=person.id, role=body.role, branch_id=body.branch_id, job_title=body.job_title,
        department=body.department, monthly_salary_paise=body.monthly_salary_paise, joined_on=body.joined_on or _today(),
        employee_code=body.employee_code or _next_code(db, member.clinic_id),
    )
    db.add(m)
    if body.role == MembershipRole.PHYSIO and body.registration_no and not db.scalar(select(PhysioProfile.id).where(PhysioProfile.user_id == person.id)):
        # Stored for prescriptions; not listed publicly until a Super Admin verifies it.
        db.add(PhysioProfile(user_id=person.id, registration_no=body.registration_no, qualification=body.job_title))
    db.flush()
    audit.record(db, action="create", entity="clinic_member", entity_id=m.id, actor_user_id=user.id, clinic_id=member.clinic_id, summary=f"{body.full_name} · {body.role.value}", request=request)
    db.commit()
    return _staff_out(db, m)


def _next_code(db: Session, clinic_id: uuid.UUID) -> str:
    n = db.scalar(select(func.count()).select_from(ClinicMember).where(ClinicMember.clinic_id == clinic_id)) or 0
    return f"EMP-{n + 1:03d}"


@router.put("/staff/{member_id}", response_model=StaffOut)
def update_staff(member_id: uuid.UUID, body: StaffUpdate, member: Owner, user: CurrentUser, db: DB, request: Request) -> StaffOut:
    m = _member(db, member.clinic_id, member_id)
    if m.role == MembershipRole.OWNER and (body.role or body.is_active is False):
        raise HTTPException(status.HTTP_409_CONFLICT, "The clinic owner's role can't be changed here")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    audit.record(db, action="update", entity="clinic_member", entity_id=m.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return _staff_out(db, m)


# ── Attendance ──────────────────────────────────────────────────────────────


@router.get("/attendance", response_model=AttendanceDay)
def attendance(member: Owner, db: DB, day: date | None = None) -> AttendanceDay:
    day = day or _today()
    rows = [_staff_out(db, m, day) for m in db.scalars(select(ClinicMember).where(ClinicMember.clinic_id == member.clinic_id, ClinicMember.is_active.is_(True)).order_by(ClinicMember.created_at))]
    count = lambda s: sum(1 for r in rows if r.today == s)  # noqa: E731
    return AttendanceDay(day=day, present=count(AttendanceStatus.PRESENT), half_day=count(AttendanceStatus.HALF_DAY), on_leave=count(AttendanceStatus.ON_LEAVE),
                         absent=count(AttendanceStatus.ABSENT), unmarked=sum(1 for r in rows if r.today is None), rows=rows)


def _upsert_attendance(db: Session, member_id: uuid.UUID, day: date, st: AttendanceStatus, check_in=None, check_out=None) -> Attendance:
    att = db.scalar(select(Attendance).where(Attendance.member_id == member_id, Attendance.day == day))
    if att is None:
        att = Attendance(member_id=member_id, day=day, status=st)
        db.add(att)
    att.status = st
    if check_in is not None:
        att.check_in = check_in
    if check_out is not None:
        att.check_out = check_out
    return att


@router.put("/attendance", response_model=StaffOut)
def mark_attendance(body: AttendanceIn, member: Owner, db: DB) -> StaffOut:
    m = _member(db, member.clinic_id, body.member_id)
    if body.day > _today():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Can't mark attendance for a future day")
    _upsert_attendance(db, m.id, body.day, body.status, body.check_in, body.check_out)
    db.commit()
    return _staff_out(db, m, body.day)


@router.post("/attendance/check-in", response_model=StaffOut)
def check_in(member: Member, db: DB) -> StaffOut:
    """A team member checks themselves in (from the practice console or the app)."""
    now = datetime.now(TZ)
    att = db.scalar(select(Attendance).where(Attendance.member_id == member.id, Attendance.day == now.date()))
    if att and att.check_in:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Already checked in at {att.check_in:%H:%M}")
    _upsert_attendance(db, member.id, now.date(), AttendanceStatus.PRESENT, now.time().replace(second=0, microsecond=0))
    db.commit()
    return _staff_out(db, member, now.date())


# ── Leave ───────────────────────────────────────────────────────────────────


def _leave_out(db: Session, lr: LeaveRequest) -> LeaveOut:
    m = db.get(ClinicMember, lr.member_id)
    return LeaveOut(id=lr.id, member_id=m.id, name=db.get(User, m.user_id).full_name, leave_type=lr.leave_type, from_date=lr.from_date, to_date=lr.to_date,
                    days=float(lr.days), reason=lr.reason, status=lr.status, created_at=lr.created_at)


def _working_days(start: date, end: date) -> list[date]:
    """Mon–Sat are working days (clinics usually open six days a week)."""
    return [start + timedelta(days=i) for i in range((end - start).days + 1) if (start + timedelta(days=i)).weekday() != 6]


@router.get("/leave", response_model=list[LeaveOut])
def list_leave(member: Owner, db: DB, status_: Annotated[LeaveStatus | None, Query(alias="status")] = None) -> list[LeaveOut]:
    stmt = select(LeaveRequest).join(ClinicMember, ClinicMember.id == LeaveRequest.member_id).where(ClinicMember.clinic_id == member.clinic_id)
    if status_:
        stmt = stmt.where(LeaveRequest.status == status_)
    return [_leave_out(db, lr) for lr in db.scalars(stmt.order_by(LeaveRequest.status, LeaveRequest.from_date.desc()).limit(200))]


@router.get("/leave/mine", response_model=list[LeaveOut])
def my_leave(member: Member, db: DB) -> list[LeaveOut]:
    return [_leave_out(db, lr) for lr in db.scalars(select(LeaveRequest).where(LeaveRequest.member_id == member.id).order_by(LeaveRequest.from_date.desc()).limit(50))]


@router.post("/leave", response_model=LeaveOut, status_code=status.HTTP_201_CREATED)
def request_leave(body: LeaveIn, member: Member, db: DB) -> LeaveOut:
    days = 0.5 if body.half_day else float(len(_working_days(body.from_date, body.to_date)))
    if days == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Those dates have no working days")
    lr = LeaveRequest(member_id=member.id, leave_type=body.leave_type, from_date=body.from_date, to_date=body.to_date, days=days, reason=body.reason)
    db.add(lr)
    owner = db.scalar(select(ClinicMember.user_id).where(ClinicMember.clinic_id == member.clinic_id, ClinicMember.role == MembershipRole.OWNER).limit(1))
    if owner and owner != member.user_id:
        name = db.get(User, member.user_id).full_name
        db.add(Notification(user_id=owner, kind="leave_request", title=f"Leave request from {name}", body=f"{body.leave_type.value} · {body.from_date:%d %b} – {body.to_date:%d %b} ({days:g} days)"))
    db.commit()
    return _leave_out(db, lr)


@router.post("/leave/{leave_id}/{decision}", response_model=LeaveOut)
def decide_leave(leave_id: uuid.UUID, decision: str, member: Owner, user: CurrentUser, db: DB, request: Request) -> LeaveOut:
    if decision not in ("approve", "reject"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown action")
    lr = db.get(LeaveRequest, leave_id)
    if lr is None or db.get(ClinicMember, lr.member_id).clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Leave request not found")
    if lr.status != LeaveStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Already {lr.status.value}")
    lr.status = LeaveStatus.APPROVED if decision == "approve" else LeaveStatus.REJECTED
    lr.decided_by = user.id
    lr.decided_at = datetime.now(UTC)
    if lr.status == LeaveStatus.APPROVED:
        for d in _working_days(lr.from_date, lr.to_date):
            _upsert_attendance(db, lr.member_id, d, AttendanceStatus.HALF_DAY if float(lr.days) == 0.5 else AttendanceStatus.ON_LEAVE)
    requester = db.get(ClinicMember, lr.member_id).user_id
    db.add(Notification(user_id=requester, kind="leave_decision", title=f"Leave {lr.status.value}", body=f"{lr.from_date:%d %b} – {lr.to_date:%d %b}"))
    audit.record(db, action=decision, entity="leave_request", entity_id=lr.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
    db.commit()
    return _leave_out(db, lr)


# ── Payroll ─────────────────────────────────────────────────────────────────


def _period(month: str) -> date:
    try:
        y, m = (int(x) for x in month.split("-"))
        return date(y, m, 1)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Month must be YYYY-MM")


def _unpaid_days(db: Session, member_id: uuid.UUID, period: date) -> float:
    """Absent days + half-days (½) + approved unpaid leave, within the month."""
    last = date(period.year, period.month, calendar.monthrange(period.year, period.month)[1])
    att = db.execute(select(Attendance.status, func.count()).where(Attendance.member_id == member_id, Attendance.day >= period, Attendance.day <= last).group_by(Attendance.status)).all()
    counts = {s: n for s, n in att}
    unpaid_leave = 0.0
    for lr in db.scalars(select(LeaveRequest).where(LeaveRequest.member_id == member_id, LeaveRequest.status == LeaveStatus.APPROVED,
                                                    LeaveRequest.leave_type == LeaveType.UNPAID, LeaveRequest.to_date >= period, LeaveRequest.from_date <= last)):
        unpaid_leave += 0.5 if float(lr.days) == 0.5 else len(_working_days(max(lr.from_date, period), min(lr.to_date, last)))
    return counts.get(AttendanceStatus.ABSENT, 0) + 0.5 * counts.get(AttendanceStatus.HALF_DAY, 0) + unpaid_leave


def _compute(db: Session, m: ClinicMember, period: date) -> tuple[int, int, float]:
    gross = m.monthly_salary_paise or 0
    unpaid = _unpaid_days(db, m.id, period)
    per_day = gross / calendar.monthrange(period.year, period.month)[1]
    deductions = min(gross, round(per_day * unpaid))
    return gross, deductions, unpaid


@router.get("/payroll", response_model=PayrollOut)
def payroll(member: Owner, db: DB, month: str | None = None) -> PayrollOut:
    period = _period(month) if month else _today().replace(day=1)
    members = list(db.scalars(select(ClinicMember).where(ClinicMember.clinic_id == member.clinic_id).order_by(ClinicMember.created_at)))
    slips = {p.member_id: p for p in db.scalars(select(Payslip).where(Payslip.clinic_id == member.clinic_id, Payslip.period == period))}
    rows = []
    for m in members:
        slip = slips.get(m.id)
        if slip is None and (not m.is_active or not m.monthly_salary_paise):
            continue
        name = db.get(User, m.user_id).full_name
        if slip:
            _, _, unpaid = _compute(db, m, period)
            rows.append(PayslipOut(id=slip.id, member_id=m.id, name=name, employee_code=m.employee_code, role=m.job_title or m.role.value, department=m.department,
                                   gross_paise=slip.gross_paise, deductions_paise=slip.deductions_paise, net_paise=slip.net_paise, unpaid_days=unpaid,
                                   status=slip.status, paid_at=slip.paid_at))
        else:
            gross, ded, unpaid = _compute(db, m, period)
            rows.append(PayslipOut(id=None, member_id=m.id, name=name, employee_code=m.employee_code, role=m.job_title or m.role.value, department=m.department,
                                   gross_paise=gross, deductions_paise=ded, net_paise=gross - ded, unpaid_days=unpaid, status=None, paid_at=None))
    pending = [r for r in rows if r.status != PayslipStatus.PAID]
    return PayrollOut(period=period, total_net_paise=sum(r.net_paise for r in rows), pending_net_paise=sum(r.net_paise for r in pending), pending_count=len(pending), rows=rows)


@router.post("/payroll/run", response_model=PayrollOut)
def run_payroll(member: Owner, user: CurrentUser, db: DB, request: Request, month: str | None = None) -> PayrollOut:
    """Generate (or refresh unpaid) payslips for every salaried active member."""
    period = _period(month) if month else _today().replace(day=1)
    for m in db.scalars(select(ClinicMember).where(ClinicMember.clinic_id == member.clinic_id, ClinicMember.is_active.is_(True), ClinicMember.monthly_salary_paise > 0)):
        gross, ded, unpaid = _compute(db, m, period)
        slip = db.scalar(select(Payslip).where(Payslip.member_id == m.id, Payslip.period == period))
        if slip and slip.status == PayslipStatus.PAID:
            continue
        if slip is None:
            slip = Payslip(clinic_id=member.clinic_id, member_id=m.id, period=period, gross_paise=gross, net_paise=gross)
            db.add(slip)
        slip.gross_paise, slip.deductions_paise, slip.net_paise = gross, ded, gross - ded
        slip.note = f"{unpaid:g} unpaid day(s)" if unpaid else None
    try:
        audit.record(db, action="run", entity="payroll", actor_user_id=user.id, clinic_id=member.clinic_id, summary=period.strftime("%B %Y"), request=request)
        db.commit()
    except IntegrityError:
        db.rollback()
    return payroll(member, db, period.strftime("%Y-%m"))


@router.post("/payroll/{payslip_id}/pay", response_model=PayslipOut)
def pay_slip(payslip_id: uuid.UUID, member: Owner, user: CurrentUser, db: DB, request: Request) -> PayslipOut:
    slip = db.get(Payslip, payslip_id)
    if slip is None or slip.clinic_id != member.clinic_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payslip not found")
    if slip.status != PayslipStatus.PAID:
        slip.status = PayslipStatus.PAID
        slip.paid_at = datetime.now(UTC)
        m = db.get(ClinicMember, slip.member_id)
        db.add(Notification(user_id=m.user_id, kind="salary_paid", title="Salary paid", body=f"{slip.period:%B %Y} · ₹{slip.net_paise / 100:,.0f}"))
        audit.record(db, action="pay", entity="payslip", entity_id=slip.id, actor_user_id=user.id, clinic_id=member.clinic_id, request=request)
        db.commit()
    m = db.get(ClinicMember, slip.member_id)
    _, _, unpaid = _compute(db, m, slip.period)
    return PayslipOut(id=slip.id, member_id=m.id, name=db.get(User, m.user_id).full_name, employee_code=m.employee_code, role=m.job_title or m.role.value,
                      department=m.department, gross_paise=slip.gross_paise, deductions_paise=slip.deductions_paise, net_paise=slip.net_paise,
                      unpaid_days=unpaid, status=slip.status, paid_at=slip.paid_at)
