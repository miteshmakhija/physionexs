"""Structured assessment: red-flag screening rules (no database needed)."""

import pytest
from pydantic import ValidationError

from app.schemas.clinical import AssessmentFormIn
from app.services.assessment import RED_FLAGS, positive_flags, sign_problems, twin_readings

ALL_NO = {code: "no" for code in RED_FLAGS}


def test_follow_up_needs_no_screening():
    assert sign_problems({"visit_type": "follow_up", "red_flags": {}}) == []
    assert sign_problems(None) == []


@pytest.mark.parametrize("visit", ["initial", "reassessment"])
def test_screened_visit_must_answer_every_flag(visit):
    partial = dict(ALL_NO)
    partial.pop("fever")
    problems = sign_problems({"visit_type": visit, "red_flags": partial})
    assert len(problems) == 1 and "Unexplained fever" in problems[0]
    assert sign_problems({"visit_type": visit, "red_flags": ALL_NO}) == []


def test_positive_flag_needs_referral_or_review():
    form = {"visit_type": "initial", "red_flags": {**ALL_NO, "bladder_bowel": "yes", "fever": "yes"}}
    assert positive_flags(form) == ["fever", "bladder_bowel"]
    assert any("referral" in p for p in sign_problems(form))
    assert sign_problems({**form, "red_flag_action": "medical_review"}) == []


def test_twin_readings_only_for_knee():
    sections = {
        "visit": {"body_region": "knee"},
        "rom": {"degrees": {"flexion": {"right": 95, "left": 130}, "extension": {"right": 10}}},
        "strength": {"mrc": {"extension": {"right": 3}, "abduction": {"right": 4}}},
    }
    assert twin_readings({"sections": sections}) == [
        ("knee_flexion", "right", 95.0), ("knee_flexion", "left", 130.0), ("knee_extension_lag", "right", 10.0), ("knee_extension_mrc", "right", 3.0),
    ]
    assert twin_readings({"sections": {**sections, "visit": {"body_region": "hip"}}}) == []
    assert twin_readings({"sections": {"visit": {"body_region": "knee"}, "rom": {"degrees": {"flexion": {"right": "95", "left": True}}}}}) == []
    assert twin_readings(None) == []


def test_schema_rejects_unknown_flags_and_answers():
    with pytest.raises(ValidationError):
        AssessmentFormIn(visit_type="initial", red_flags={"made_up": "no"})
    with pytest.raises(ValidationError):
        AssessmentFormIn(visit_type="initial", red_flags={"fever": "maybe"})
    with pytest.raises(ValidationError):
        AssessmentFormIn(visit_type="initial", sections={"notes": "x" * 70_000})
    assert AssessmentFormIn(visit_type="initial", red_flags=ALL_NO).version == 1
