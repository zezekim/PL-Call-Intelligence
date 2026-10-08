"""A manager's fixes to a transcript: the words, who said them, a line that
is really two people, and a line the transcriber missed.

Line ids stay stable through edits (a new line takes the next free id), so
the evidence on the current grade still points at the right words until the
call is scored again. Every fix keeps what was there before: the transcribed
wording on `original_text`, and only lines a manager added can be deleted.
"""

from __future__ import annotations

from callsentry.intel.transcript import CUSTOMER, REP, Segment

ROLES = (REP, CUSTOMER)
MAX_TEXT = 2000


class EditError(ValueError):
    pass


def _find(segments: list[Segment], seg_id: int) -> Segment:
    for s in segments:
        if s.id == seg_id:
            return s
    raise EditError("line not found")


def _clean(text: str) -> str:
    text = " ".join(text.split())
    if not text:
        raise EditError("text is empty")
    if len(text) > MAX_TEXT:
        raise EditError("text is too long")
    return text


def _role(role: str) -> str:
    if role not in ROLES:
        raise EditError("role must be rep or customer")
    return role


def _ordered(segments: list[Segment]) -> list[Segment]:
    return sorted(segments, key=lambda s: (s.start, s.id))


def _next_id(segments: list[Segment]) -> int:
    return max((s.id for s in segments), default=0) + 1


def set_text(segments: list[Segment], seg_id: int, text: str) -> list[Segment]:
    s = _find(segments, seg_id)
    text = _clean(text)
    if text != s.text and s.original_text is None and not s.added:
        s.original_text = s.text
    s.text = text
    if s.original_text == text:
        s.original_text = None
    return segments


def set_role(segments: list[Segment], seg_id: int, role: str) -> list[Segment]:
    s = _find(segments, seg_id)
    s.role = s.manual_role = _role(role)
    return segments


def split(
    segments: list[Segment], seg_id: int, at: int, role: str, start: float | None = None
) -> list[Segment]:
    """Cut a line at character `at`; the rest becomes a new line for `role`.

    Without a time, the new line starts where the cut falls in proportion to
    the line's length, which is close enough to play from.
    """
    s = _find(segments, seg_id)
    head, tail = s.text[:at].strip(), s.text[at:].strip()
    if not head or not tail:
        raise EditError("split point must be inside the line")
    if start is None:
        start = s.start + (s.end - s.start) * at / max(1, len(s.text))
    if not s.start <= start <= max(s.end, s.start):
        raise EditError("the new line must start within the original line")
    if s.original_text is None and not s.added:
        s.original_text = s.text
    new = Segment(
        id=_next_id(segments), start=round(start, 2), end=s.end, text=tail,
        speaker=s.speaker, role=_role(role), manual_role=role, added=False,
    )
    s.text, s.end = head, round(start, 2)
    return _ordered([*segments, new])


def insert(
    segments: list[Segment], start: float, role: str, text: str, end: float | None = None
) -> list[Segment]:
    if start < 0:
        raise EditError("time must not be negative")
    new = Segment(
        id=_next_id(segments), start=round(start, 2),
        end=round(end if end is not None and end > start else start + 2.0, 2),
        text=_clean(text), role=_role(role), manual_role=role, added=True,
    )
    return _ordered([*segments, new])


def delete(segments: list[Segment], seg_id: int) -> list[Segment]:
    s = _find(segments, seg_id)
    if not s.added:
        raise EditError("only lines you added can be deleted")
    return [x for x in segments if x.id != seg_id]


def apply_manual_roles(segments: list[Segment]) -> None:
    """A manager's word on who said a line outlasts re-scoring."""
    for s in segments:
        if s.manual_role:
            s.role = s.manual_role
