"""Speaker-labelled transcript segments and evidence checking.

The model never produces timestamps. It cites segment ids from a numbered
transcript, and every quote it gives is checked against the text of the
segment it cites. A timestamp in the UI therefore always points at audio the
quote actually came from, and an unverifiable quote is flagged rather than
shown as fact.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from typing import Any

REP = "rep"
CUSTOMER = "customer"
UNKNOWN = "unknown"

# A quote must match a window of the cited segments at least this closely.
# Speech-to-text and paraphrase drift make exact matching too strict; below
# ~0.8 the "quote" is usually the model's own wording.
QUOTE_MATCH_THRESHOLD = 0.8


@dataclass
class Segment:
    id: int
    start: float
    end: float
    text: str
    # Raw diarization label from the transcriber ("0", "1", "ch0" ...), and
    # the role it resolves to once the rep is identified.
    speaker: str = ""
    role: str = UNKNOWN

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Segment:
        return cls(
            id=int(data["id"]),
            start=float(data.get("start", 0.0)),
            end=float(data.get("end", 0.0)),
            text=str(data.get("text", "")),
            speaker=str(data.get("speaker", "")),
            role=str(data.get("role", UNKNOWN)),
        )


def renumber(segments: list[Segment]) -> list[Segment]:
    """Sort by start time and assign stable ids from 1."""
    ordered = sorted((s for s in segments if s.text.strip()), key=lambda s: (s.start, s.end))
    for index, segment in enumerate(ordered, start=1):
        segment.id = index
    return ordered


def merge_adjacent(segments: list[Segment], *, max_gap: float = 1.0) -> list[Segment]:
    """Join consecutive segments from the same speaker into one turn.

    Transcribers split on pauses; a reader (and the model) wants turns.
    """
    merged: list[Segment] = []
    for segment in segments:
        prev = merged[-1] if merged else None
        if (
            prev is not None
            and prev.speaker == segment.speaker
            and segment.start - prev.end <= max_gap
        ):
            prev.text = f"{prev.text} {segment.text}".strip()
            prev.end = max(prev.end, segment.end)
            continue
        merged.append(
            Segment(segment.id, segment.start, segment.end, segment.text.strip(),
                    segment.speaker, segment.role)
        )
    return renumber(merged)


def clock(seconds: float) -> str:
    total = max(0, int(seconds))
    return f"{total // 60:02d}:{total % 60:02d}"


def exact_speakers(segments: list[Segment]) -> bool:
    """True when speaker labels are recording channels - one person per channel.

    Channel labels are exact. Voice-separation labels on mono phone audio are
    not: they are shown to the model as hints and roles are attributed per
    sentence from the conversation.
    """
    labels = {s.speaker for s in segments}
    return len(labels) > 1 and all(label.startswith("ch") for label in labels)


def _label(speaker: str) -> str:
    if not speaker:
        return "?"
    return f"SPEAKER {speaker}" if speaker.startswith("ch") else f"VOICE {speaker}?"


def render(segments: list[Segment], *, by_role: bool) -> str:
    """Numbered transcript for the model: `[12] 01:23 REP: text`."""
    lines = []
    for s in segments:
        who = s.role.upper() if by_role else _label(s.speaker)
        lines.append(f"[{s.id}] {clock(s.start)} {who}: {s.text}")
    return "\n".join(lines)


def plain_text(segments: list[Segment]) -> str:
    """Human transcript stored on the call for search and export."""
    names = {REP: "Rep", CUSTOMER: "Customer", UNKNOWN: "Speaker"}
    return "\n".join(f"{names.get(s.role, 'Speaker')}: {s.text}" for s in segments)


def apply_roles(segments: list[Segment], roles: dict[str, str]) -> None:
    for s in segments:
        s.role = roles.get(s.speaker, UNKNOWN)


# --- Evidence ------------------------------------------------------------------

_NON_WORD = re.compile(r"[^a-z0-9' ]+")


def _normalise(text: str) -> str:
    return " ".join(_NON_WORD.sub(" ", text.lower()).split())


def quote_score(quote: str, haystack: str) -> float:
    """Best similarity of `quote` against any same-length word window of `haystack`."""
    q = _normalise(quote).split()
    h = _normalise(haystack).split()
    if not q or not h:
        return 0.0
    if " ".join(q) in " ".join(h):
        return 1.0
    width = len(q)
    best = 0.0
    target = " ".join(q)
    for start in range(0, max(1, len(h) - width + 1)):
        window = " ".join(h[start : start + width])
        best = max(best, SequenceMatcher(None, target, window).ratio())
        if best >= 0.99:
            break
    return best


def resolve_evidence(
    raw: list[dict[str, Any]], segments: list[Segment]
) -> list[dict[str, Any]]:
    """Attach timestamps and a verified flag to model-cited evidence.

    Each entry cites a segment id and a quote. The quote is searched in the
    cited segment and its neighbours (a sentence can straddle a turn split).
    """
    by_id = {s.id: s for s in segments}
    out: list[dict[str, Any]] = []
    for entry in raw or []:
        try:
            seg_id = int(entry.get("segment_id", 0))
        except (TypeError, ValueError):
            seg_id = 0
        quote = str(entry.get("quote") or "").strip()
        segment = by_id.get(seg_id)
        if segment is None:
            out.append({"segment_id": seg_id, "quote": quote, "start": None,
                        "role": None, "verified": False})
            continue
        neighbourhood = " ".join(
            by_id[i].text for i in (seg_id - 1, seg_id, seg_id + 1) if i in by_id
        )
        score = quote_score(quote, neighbourhood) if quote else 0.0
        out.append(
            {
                "segment_id": seg_id,
                "quote": quote,
                "start": round(segment.start, 2),
                "role": segment.role,
                "verified": score >= QUOTE_MATCH_THRESHOLD,
            }
        )
    return out
