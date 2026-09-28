"""Camera measurement validation (design B1, docs/digital-twin/B-camera-tracking.md).

The browser measures the angle (MediaPipe, on the device; no video leaves it) while the physio takes a goniometer
reading. Both are stored as measurements and linked as a validation pair:

- the camera reading is saved as untrusted (`trusted = False`, source `camera`), so it never feeds targets or flag
  rules and can't be "confirmed" into clinical data until camera accuracy has been accepted;
- the goniometer reading is a normal clinic measurement.

Bland–Altman agreement over the pairs is what the clinical lead uses to accept (or reject) camera measurement.
"""

import math
import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.patient import ClinicPatient, Patient
from app.models.twin import Measurement, ValidationPair
from app.schemas.twin import AgreementOut, ValidationOut, ValidationPairOut

CAMERA_METHOD = "camera_v1"


def agreement(diffs: list[float]) -> tuple[float, float] | None:
    """Mean difference (bias) and SD of camera − goniometer."""
    if len(diffs) < 2:
        return None
    bias = sum(diffs) / len(diffs)
    return bias, math.sqrt(sum((d - bias) ** 2 for d in diffs) / (len(diffs) - 1))


def validation_out(db: Session, pairs: list[ValidationPair], with_names: bool) -> ValidationOut:
    names: dict[uuid.UUID, str] = {}
    if with_names and pairs:
        names = dict(db.execute(
            select(ClinicPatient.id, Patient.full_name).join(Patient, Patient.id == ClinicPatient.patient_id)
            .where(ClinicPatient.id.in_({p.clinic_patient_id for p in pairs}))
        ).all())
    groups: dict[tuple[str, str], list[ValidationPair]] = defaultdict(list)
    for p in pairs:
        groups[(p.code, p.posture)].append(p)
    summary = []
    for (code, posture), rows in sorted(groups.items()):
        a = agreement([float(p.camera_value) - float(p.reference_value) for p in rows])
        a3 = agreement([float(p.camera_value_3d) - float(p.reference_value) for p in rows if p.camera_value_3d is not None])
        summary.append(AgreementOut(
            code=code, posture=posture, n=len(rows), patients=len({p.clinic_patient_id for p in rows}),
            bias=round(a[0], 1) if a else None, sd=round(a[1], 1) if a else None,
            lower=round(a[0] - 1.96 * a[1], 1) if a else None, upper=round(a[0] + 1.96 * a[1], 1) if a else None,
            bias_3d=round(a3[0], 1) if a3 else None, sd_3d=round(a3[1], 1) if a3 else None,
        ))
    return ValidationOut(
        summary=summary,
        pairs=[ValidationPairOut(
            id=p.id, patient_name=names.get(p.clinic_patient_id) if with_names else None, code=p.code, side=p.side, posture=p.posture,
            camera_value=float(p.camera_value), camera_value_3d=float(p.camera_value_3d) if p.camera_value_3d is not None else None,
            reference_value=float(p.reference_value), confidence=float(p.confidence), frames=p.frames, spread=float(p.spread),
            fps=float(p.fps) if p.fps is not None else None, model=p.model, lighting=p.lighting, clothing=p.clothing, note=p.note,
            created_at=p.created_at,
        ) for p in pairs],
    )


def is_camera(m: Measurement) -> bool:
    return m.method == CAMERA_METHOD
