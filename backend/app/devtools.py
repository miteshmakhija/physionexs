"""Demo data for development and integration tests. Every demo account uses the DEMO_DOMAIN email domain."""

from datetime import time

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import (
    Appointment,
    AuditLog,
    Availability,
    Branch,
    CarePlan,
    CarePlanExercise,
    Clinic,
    ClinicMember,
    ClinicPatient,
    Consultation,
    Exercise,
    ExerciseLog,
    MedicalBackground,
    Medication,
    MedicationLog,
    Notification,
    OtpRequest,
    Patient,
    Payment,
    PhysioProfile,
    PointsLedger,
    Prescription,
    QueueToken,
    RefreshToken,
    Subscription,
    TestOrder,
    User,
)
from app.models.clinic import MembershipRole, SubscriptionStatus, VerificationStatus
from app.models.user import UserRole

DEMO_DOMAIN = "demo.physionexs.com"
DEMO_PASSWORD = "demo-physio-123"

DEMO_PHYSIOS = [
    {
        "name": "Dr. Ananya Sharma", "phone": "+919000000101", "qual": "MPT (Ortho)", "reg": "IAP-DEMO-1001",
        "clinic": "Sunrise Physiotherapy & Sports Clinic", "branch": "Sunrise · Baner", "area": "Baner", "city": "Pune",
        "lat": 18.559, "lng": 73.786, "bio": "Sports and orthopaedic rehab — ACL, MCL and post-surgical knees.",
        "college": "Seth GS Medical College, Mumbai", "exp": 11, "specs": ["Knee", "Sports injury", "Post-surgical"],
        "langs": ["English", "Hindi", "Marathi"], "fee": 80_000, "online": 60_000,
    },
    {
        "name": "Dr. Rohan Mehta", "phone": "+919000000102", "qual": "MPT (Neuro)", "reg": "IAP-DEMO-1002",
        "clinic": "NeuroMove Rehab", "branch": "NeuroMove · Koregaon Park", "area": "Koregaon Park", "city": "Pune",
        "lat": 18.536, "lng": 73.894, "bio": "Stroke, Parkinson's and balance rehabilitation.",
        "college": "KEM Hospital, Pune", "exp": 8, "specs": ["Neuro", "Balance", "Stroke"],
        "langs": ["English", "Hindi"], "fee": 90_000, "online": None,
    },
    {
        "name": "Dr. Priya Nair", "phone": "+919000000103", "qual": "BPT, MIAP", "reg": "IAP-DEMO-1003",
        "clinic": "BackWell Spine Clinic", "branch": "BackWell · Kothrud", "area": "Kothrud", "city": "Pune",
        "lat": 18.507, "lng": 73.807, "bio": "Back and neck pain, posture correction and ergonomics.",
        "college": "Manipal College of Health Professions", "exp": 6, "specs": ["Back pain", "Neck", "Posture"],
        "langs": ["English", "Malayalam", "Hindi"], "fee": 70_000, "online": 50_000,
    },
]


def seed_demo(db: Session) -> list[User]:
    created = []
    for d in DEMO_PHYSIOS:
        email = f"{d['reg'].lower()}@{DEMO_DOMAIN}"
        if db.scalar(select(User.id).where(User.email == email)):
            continue
        user = User(full_name=d["name"], email=email, phone=d["phone"], password_hash=hash_password(DEMO_PASSWORD), role=UserRole.PHYSIO)
        db.add(user)
        db.flush()
        db.add(
            PhysioProfile(
                user_id=user.id, qualification=d["qual"], registration_no=d["reg"], council="IAP",
                verification_status=VerificationStatus.APPROVED, bio=d["bio"], college=d["college"],
                experience_years=d["exp"], specializations=d["specs"], languages=d["langs"],
                offers_in_clinic=True, offers_online=d["online"] is not None,
                fee_in_clinic_paise=d["fee"], fee_online_paise=d["online"],
            )
        )
        clinic = Clinic(name=d["clinic"], slug=d["reg"].lower(), owner_user_id=user.id, phone=d["phone"])
        db.add(clinic)
        db.flush()
        branch = Branch(clinic_id=clinic.id, name=d["branch"], area=d["area"], city=d["city"], latitude=d["lat"], longitude=d["lng"], hours="Mon–Sat · 9 AM–7 PM", lead_user_id=user.id)
        db.add(branch)
        db.flush()
        db.add(ClinicMember(clinic_id=clinic.id, user_id=user.id, branch_id=branch.id, role=MembershipRole.OWNER, job_title="Physiotherapist"))
        db.add(Subscription(clinic_id=clinic.id, status=SubscriptionStatus.ACTIVE))
        for weekday in range(6):  # Mon–Sat
            db.add(Availability(physio_user_id=user.id, branch_id=branch.id, weekday=weekday, start_time=time(9), end_time=time(13), slot_minutes=30))
            db.add(Availability(physio_user_id=user.id, branch_id=branch.id, weekday=weekday, start_time=time(15), end_time=time(19), slot_minutes=30))
        created.append(user)
    db.commit()
    return created


def purge_users(db: Session, user_ids: list, phones: list[str] = ()) -> None:
    """Hard-delete users and everything hanging off them (dev/test only)."""
    if not user_ids and not phones:
        return
    clinic_ids = list(db.scalars(select(Clinic.id).where(Clinic.owner_user_id.in_(user_ids))))
    patient_ids = list(db.scalars(select(Patient.id).where(or_(Patient.user_id.in_(user_ids), Patient.phone.in_(list(phones))))))
    appt_filter = or_(Appointment.clinic_id.in_(clinic_ids), Appointment.patient_id.in_(patient_ids), Appointment.physio_user_id.in_(user_ids))
    payment_ids = list(db.scalars(select(Appointment.payment_id).where(appt_filter, Appointment.payment_id.is_not(None))))
    cp_ids = list(db.scalars(select(ClinicPatient.id).where(or_(ClinicPatient.clinic_id.in_(clinic_ids), ClinicPatient.patient_id.in_(patient_ids)))))
    plan_ids = list(db.scalars(select(CarePlan.id).where(CarePlan.clinic_patient_id.in_(cp_ids))))
    med_ids = list(db.scalars(select(Medication.id).where(Medication.care_plan_id.in_(plan_ids))))
    pe_ids = list(db.scalars(select(CarePlanExercise.id).where(CarePlanExercise.care_plan_id.in_(plan_ids))))
    db.execute(delete(MedicationLog).where(or_(MedicationLog.medication_id.in_(med_ids), MedicationLog.patient_id.in_(patient_ids))))
    db.execute(delete(ExerciseLog).where(or_(ExerciseLog.plan_exercise_id.in_(pe_ids), ExerciseLog.patient_id.in_(patient_ids))))
    db.execute(delete(Prescription).where(Prescription.clinic_patient_id.in_(cp_ids)))
    db.execute(delete(TestOrder).where(TestOrder.clinic_patient_id.in_(cp_ids)))
    db.execute(delete(Consultation).where(Consultation.clinic_patient_id.in_(cp_ids)))
    db.execute(delete(Medication).where(Medication.id.in_(med_ids)))
    db.execute(delete(CarePlanExercise).where(CarePlanExercise.id.in_(pe_ids)))
    db.execute(delete(CarePlan).where(CarePlan.id.in_(plan_ids)))
    db.execute(delete(MedicalBackground).where(MedicalBackground.clinic_patient_id.in_(cp_ids)))
    branch_ids = list(db.scalars(select(Branch.id).where(Branch.clinic_id.in_(clinic_ids))))
    db.execute(delete(QueueToken).where(or_(QueueToken.branch_id.in_(branch_ids), QueueToken.patient_id.in_(patient_ids))))
    db.execute(delete(Exercise).where(Exercise.owner_clinic_id.in_(clinic_ids)))
    db.execute(delete(Appointment).where(appt_filter))
    db.execute(delete(PointsLedger).where(PointsLedger.patient_id.in_(patient_ids)))
    db.execute(delete(Payment).where(or_(Payment.id.in_(payment_ids), Payment.clinic_id.in_(clinic_ids), Payment.patient_id.in_(patient_ids))))
    db.execute(delete(ClinicPatient).where(or_(ClinicPatient.clinic_id.in_(clinic_ids), ClinicPatient.patient_id.in_(patient_ids))))
    db.execute(delete(Availability).where(Availability.physio_user_id.in_(user_ids)))
    db.execute(delete(ClinicMember).where(or_(ClinicMember.clinic_id.in_(clinic_ids), ClinicMember.user_id.in_(user_ids))))
    db.execute(delete(Subscription).where(Subscription.clinic_id.in_(clinic_ids)))
    db.execute(delete(Branch).where(Branch.clinic_id.in_(clinic_ids)))
    db.execute(delete(Clinic).where(Clinic.id.in_(clinic_ids)))
    db.execute(delete(PhysioProfile).where(PhysioProfile.user_id.in_(user_ids)))
    db.execute(delete(Patient).where(Patient.id.in_(patient_ids)))
    db.execute(delete(Notification).where(Notification.user_id.in_(user_ids)))
    db.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(user_ids)))
    db.execute(delete(AuditLog).where(or_(AuditLog.actor_user_id.in_(user_ids), AuditLog.clinic_id.in_(clinic_ids))))
    db.execute(delete(OtpRequest).where(OtpRequest.phone.in_(list(phones))))
    db.execute(delete(User).where(User.id.in_(user_ids)))
    db.commit()


def purge_demo(db: Session) -> int:
    users = list(db.scalars(select(User).where(User.email.like(f"%@{DEMO_DOMAIN}"))))
    purge_users(db, [u.id for u in users], [u.phone for u in users if u.phone])
    return len(users)
