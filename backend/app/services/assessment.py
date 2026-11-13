"""Structured physiotherapy assessment stored on a consultation (consultations.assessment_form).

The backend owns the red-flag wording and the sign-off rules; the rest of the form's sections are defined in
frontend/shared/assessment.ts and stored as-is under `sections`.
"""

FORM_VERSION = 1

VISIT_TYPES = {
    "initial": "Initial assessment",
    "follow_up": "Follow-up",
    "reassessment": "Reassessment",
}
# Visit types where red-flag screening must be complete before the note can be signed.
SCREENED_VISITS = {"initial", "reassessment"}

RED_FLAGS = {
    "weight_loss": "Unexplained weight loss",
    "fever": "Unexplained fever",
    "night_pain": "Severe or night pain",
    "major_trauma": "Recent major trauma",
    "cancer_history": "History of cancer",
    "progressive_neuro": "Progressive neurological symptoms",
    "bladder_bowel": "New bladder or bowel dysfunction",
    "unexplained_weakness": "Unexplained weakness",
    "sensation_loss": "Loss of sensation",
    "dizziness_syncope": "Dizziness or fainting",
    "chest_breathless": "Chest pain or breathlessness",
    "other": "Other concern",
}

RED_FLAG_ACTIONS = {
    "referred": "Referred on",
    "medical_review": "Medical review requested",
}


def positive_flags(form: dict | None) -> list[str]:
    """Red-flag codes answered "yes", in form order."""
    answers = (form or {}).get("red_flags") or {}
    return [code for code in RED_FLAGS if answers.get(code) == "yes"]


def sign_problems(form: dict | None) -> list[str]:
    """Why this assessment can't be signed yet; empty when it can."""
    if not form or form.get("visit_type") not in SCREENED_VISITS:
        return []
    answers = form.get("red_flags") or {}
    problems = []
    missing = [label for code, label in RED_FLAGS.items() if answers.get(code) not in ("yes", "no")]
    if missing:
        problems.append(f"Red-flag screening isn't complete: answer {', '.join(missing)}")
    if positive_flags(form) and form.get("red_flag_action") not in RED_FLAG_ACTIONS:
        problems.append("A red flag was identified: record the referral or medical review before signing")
    return problems


# Knee readings the recovery twin tracks, keyed by (section, field, row) in the assessment's `sections`.
# Degrees come from the ROM step's measured range; grades from the strength step's MRC grid.
KNEE_TWIN_READINGS = {
    ("rom", "degrees", "flexion"): "knee_flexion",
    ("rom", "degrees", "extension"): "knee_extension_lag",
    ("strength", "mrc", "extension"): "knee_extension_mrc",
    ("strength", "mrc", "flexion"): "knee_flexion_mrc",
}


def twin_readings(form: dict | None) -> list[tuple[str, str, float]]:
    """(code, side, value) for each knee reading in a knee assessment; empty for other regions."""
    sections = (form or {}).get("sections") or {}
    if (sections.get("visit") or {}).get("body_region") != "knee":
        return []
    out = []
    for (section, field, row), code in KNEE_TWIN_READINGS.items():
        cell = (((sections.get(section) or {}).get(field) or {}).get(row)) or {}
        for side in ("right", "left"):
            v = cell.get(side) if isinstance(cell, dict) else None
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                out.append((code, side, float(v)))
    return out
