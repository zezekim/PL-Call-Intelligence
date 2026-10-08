"""Phone numbers as the app stores them: E.164, US by default."""

from __future__ import annotations

import re

from callsentry.models import Call, CallAnalysis, CallSource

_SEPARATORS = re.compile(r"[\s().\-]")


def normalize(raw: str | None) -> str | None:
    """"(555) 123-4567", "555.123.4567" and "+1 555 123 4567" are one number.

    None for anything that isn't a whole phone number, including the
    placeholders recordings use ("unknown", "anonymous").
    """
    digits = _SEPARATORS.sub("", raw or "")
    if not re.fullmatch(r"\+?\d{10,15}", digits):
        return None
    if digits.startswith("+"):
        return digits
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def pretty(phone: str | None) -> str:
    """+15551234567 as (555) 123-4567; other countries as stored."""
    if phone and re.fullmatch(r"\+1\d{10}", phone):
        d = phone[2:]
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    return phone or ""


def for_call(call: Call, analysis: CallAnalysis | None) -> str | None:
    """The customer's number: what they said on the call, else what they called from."""
    said = normalize(((analysis.triage if analysis else None) or {}).get("customer_phone"))
    if said:
        return said
    if call.source == CallSource.TWILIO:
        return normalize(call.caller_number)
    return None
