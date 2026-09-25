import uuid
from datetime import date, datetime, time
from enum import StrEnum

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models._types import str_enum


class AttendanceStatus(StrEnum):
    PRESENT = "present"
    HALF_DAY = "half_day"
    ON_LEAVE = "on_leave"
    ABSENT = "absent"


class Attendance(UUIDPk, Timestamps, Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("member_id", "day"),)

    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_members.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[AttendanceStatus] = mapped_column(str_enum(AttendanceStatus))
    check_in: Mapped[time | None] = mapped_column(Time)
    check_out: Mapped[time | None] = mapped_column(Time)


class LeaveType(StrEnum):
    CASUAL = "casual"
    SICK = "sick"
    EARNED = "earned"
    UNPAID = "unpaid"


class LeaveStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class LeaveRequest(UUIDPk, Timestamps, Base):
    __tablename__ = "leave_requests"

    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_members.id", ondelete="CASCADE"), index=True)
    leave_type: Mapped[LeaveType] = mapped_column(str_enum(LeaveType))
    from_date: Mapped[date] = mapped_column(Date)
    to_date: Mapped[date] = mapped_column(Date)
    days: Mapped[float] = mapped_column(Numeric(4, 1))
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[LeaveStatus] = mapped_column(str_enum(LeaveStatus), default=LeaveStatus.PENDING, index=True)
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PayslipStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"


class Payslip(UUIDPk, Timestamps, Base):
    __tablename__ = "payslips"
    __table_args__ = (UniqueConstraint("member_id", "period"),)

    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinic_members.id", ondelete="CASCADE"))
    period: Mapped[date] = mapped_column(Date)  # first day of the month
    gross_paise: Mapped[int] = mapped_column(Integer)
    deductions_paise: Mapped[int] = mapped_column(Integer, default=0)
    net_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[PayslipStatus] = mapped_column(str_enum(PayslipStatus), default=PayslipStatus.PENDING)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(String(200))
