"""Import every model so Base.metadata is complete (Alembic autogenerate relies on this)."""

from app.db.base import Base
from app.models.billing import Invoice, InvoiceItem, Payment
from app.models.clinic import Branch, Clinic, ClinicMember, PhysioProfile, Subscription
from app.models.clinical import (
    CarePlan,
    CarePlanExercise,
    Consultation,
    ExerciseLog,
    Medication,
    MedicationLog,
    Prescription,
    TestOrder,
)
from app.models.engagement import Conversation, HealthTip, Message, Notification, PointsLedger, Review
from app.models.exercise import Exercise, ExerciseMedia, ExerciseTranslation
from app.models.hr import Attendance, LeaveRequest, Payslip
from app.models.patient import ClinicPatient, MedicalBackground, Patient
from app.models.platform import AuditLog, PlatformSetting
from app.models.scheduling import Appointment, Availability, QueueToken
from app.models.twin import (
    CarePlanTarget,
    Consent,
    DailyCheckin,
    Measurement,
    PlanSuggestion,
    TwinFlag,
    ValidationPair,
    WhatsAppMessage,
    WhatsAppSession,
)
from app.models.user import DeviceToken, OtpRequest, RefreshToken, User

__all__ = [name for name in dir() if not name.startswith("_")]
