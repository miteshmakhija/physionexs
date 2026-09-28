"""The WhatsApp check-in conversation as a pure state machine (design C). No I/O here, so it's unit-tested directly.

Steps: invite → pain → stiffness → swelling → sleep → exercises → red → (red_which) → done. WhatsApp limits shape it:
at most 3 reply buttons (titles ≤ 20 chars) and 10 list rows (titles ≤ 24 chars), so 0–10 scores are typed numbers.
Messages carry no diagnosis or health details beyond the patient's own answers.
"""

import re
from dataclasses import dataclass, field

from app.services.checkins import RED_FLAGS


@dataclass
class Out:
    kind: str  # text, buttons, list
    body: str
    options: list[tuple[str, str, str | None]] = field(default_factory=list)  # (id, title, description)
    button: str | None = None  # list messages: the label of the button that opens the list


@dataclass
class Reply:
    """What the patient sent: a tapped button/list row (`choice`) or typed text."""

    choice: str | None = None
    text: str | None = None


# Short list titles for red flags (≤ 24 chars); the full wording goes in the row description.
RED_FLAG_TITLES = {
    "calf_pain": "Calf pain or swelling",
    "fever": "Fever or chills",
    "wound_redness": "Wound red or leaking",
    "chest_breathless": "Chest pain/breathless",
}

INVITE = Out("buttons", "Ready for your 30-second check-in?", [("start", "Start", None), ("skip", "Skip today", None)])


def prompt(step: str) -> Out:
    return {
        "pain": Out("text", "How is your pain right now? Reply with a number from 0 (no pain) to 10 (worst pain)."),
        "stiffness": Out("text", "How stiff is your knee? Reply with a number from 0 (not stiff) to 10 (very stiff)."),
        "swelling": Out("list", "Any swelling today?", [("none", "None", None), ("mild", "Mild", None), ("moderate", "Moderate", None), ("severe", "Severe", None)], "Choose"),
        "sleep": Out("buttons", "How did you sleep?", [("good", "Well", None), ("ok", "Okay", None), ("poor", "Poorly", None)]),
        "exercises": Out("buttons", "Did you do yesterday's exercises?", [("all", "All", None), ("some", "Some", None), ("none", "None", None)]),
        "red": Out("buttons", "Since yesterday, have you had any of these?\n• " + "\n• ".join(RED_FLAGS.values()), [("no", "No", None), ("yes", "Yes", None)]),
        "red_which": Out("list", "Which one? If more than one, choose the most worrying.",
                         [(k, RED_FLAG_TITLES[k], RED_FLAGS[k][:72]) for k in RED_FLAGS], "Choose"),
    }[step]


NEXT = {"pain": "stiffness", "stiffness": "swelling", "swelling": "sleep", "sleep": "exercises", "exercises": "red"}
CHOICES = {
    "swelling": {"none", "mild", "moderate", "severe"},
    "sleep": {"good", "ok", "poor"},
    "exercises": {"all", "some", "none"},
}
WORDS = {  # typed answers people commonly send instead of tapping
    "swelling": {"no": "none", "none": "none", "mild": "mild", "moderate": "moderate", "severe": "severe"},
    "sleep": {"well": "good", "good": "good", "ok": "ok", "okay": "ok", "poor": "poor", "poorly": "poor", "bad": "poor"},
    "exercises": {"all": "all", "yes": "all", "some": "some", "none": "none", "no": "none"},
    "red": {"no": "no", "none": "no", "yes": "yes"},
    "invite": {"start": "start", "yes": "start", "ok": "start", "hi": "start", "hello": "start", "skip": "skip"},
}


def score(text: str | None) -> int | None:
    m = re.fullmatch(r"\s*(\d{1,2})\s*(?:/\s*10)?\s*\.?\s*", text or "")
    if not m:
        return None
    v = int(m.group(1))
    return v if 0 <= v <= 10 else None


def _pick(step: str, r: Reply) -> str | None:
    if r.choice:
        return r.choice
    return WORDS.get(step, {}).get((r.text or "").strip().lower())


def handle(step: str, answers: dict, r: Reply) -> tuple[str, dict, list[Out]]:
    """Advance one step. Returns (next step, answers, messages to send). "done" means the check-in is complete."""
    answers = dict(answers)
    if step == "invite":
        pick = _pick("invite", r)
        if pick == "skip":
            return "skipped", answers, [Out("text", "No problem. We'll check in again tomorrow.")]
        if pick == "start":
            return "pain", answers, [prompt("pain")]
        return "invite", answers, [INVITE]

    if step in ("pain", "stiffness"):
        v = score(r.text)
        if v is None:
            return step, answers, [Out("text", "Please reply with a single number from 0 to 10.")]
        answers[step] = v
        return NEXT[step], answers, [prompt(NEXT[step])]

    if step in CHOICES:
        pick = _pick(step, r)
        if pick not in CHOICES[step]:
            return step, answers, [prompt(step)]
        answers[step] = pick
        return NEXT[step], answers, [prompt(NEXT[step])]

    if step == "red":
        pick = _pick("red", r)
        if pick == "no":
            answers["red_flags"] = []
            return "done", answers, []
        if pick == "yes":
            return "red_which", answers, [prompt("red_which")]
        return step, answers, [prompt(step)]

    if step == "red_which":
        if r.choice in RED_FLAGS:
            answers["red_flags"] = [r.choice]
            return "done", answers, []
        return step, answers, [prompt(step)]

    return step, answers, []
