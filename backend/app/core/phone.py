import re

_DIGITS = re.compile(r"\D")


def normalize_phone(raw: str, default_country_code: str = "91") -> str:
    """Normalise to E.164. Accepts '+91 98123 45678', '09812345678', '9812345678'."""
    has_plus = raw.strip().startswith("+")
    digits = _DIGITS.sub("", raw)
    if has_plus:
        result = "+" + digits
    elif len(digits) == 10:
        result = f"+{default_country_code}{digits}"
    elif len(digits) == 11 and digits.startswith("0"):
        result = f"+{default_country_code}{digits[1:]}"
    elif len(digits) == 12 and digits.startswith(default_country_code):
        result = "+" + digits
    else:
        raise ValueError("Enter a valid mobile number")
    if not 11 <= len(result) <= 16:
        raise ValueError("Enter a valid mobile number")
    return result
