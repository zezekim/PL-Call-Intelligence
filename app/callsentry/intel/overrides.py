"""A manager's corrections to individual scorecard steps.

The model's verdict is kept on each step as `model_status`; an override sits
on top of it and the total and grade are recomputed from the result. Overrides
are stored apart from the analysis, so re-scoring a call keeps them.
"""

from __future__ import annotations

from typing import Any

from callsentry.intel.rubrics import SCORECARDS


def apply(
    items: list[dict[str, Any]], overrides: dict[str, Any], scorecard_key: str | None
) -> tuple[list[dict[str, Any]], int | None, str | None]:
    out: list[dict[str, Any]] = []
    for raw in items:
        item = dict(raw)
        item.setdefault("model_status", item.get("status"))
        item.setdefault("model_awarded", item.get("awarded"))
        item["status"] = item["model_status"]
        item["awarded"] = item["model_awarded"]
        item.pop("override", None)
        override = overrides.get(item.get("key", ""))
        if override:
            item["status"] = override["status"]
            item["awarded"] = override["status"] == "met"
            item["override"] = override
        out.append(item)
    scorecard = SCORECARDS.get(scorecard_key or "")
    if scorecard is None:
        return out, None, None
    score = sum(1 for i in out if i.get("awarded"))
    return out, score, scorecard.grade(score).value
