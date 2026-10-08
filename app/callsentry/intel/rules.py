"""A business's own scoring rules, made from a manager's corrections.

Scoring is a judgement call, and owners differ on where a step's line sits.
A correction a manager wants to keep becomes a rule in plain words, and
every later grading of that scorecard is told it. The scorecard notes the
code enforces (automatic objection points, the save-attempt exemptions)
still apply on top, so a rule can't award what the manual forbids.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.intel.rubrics import Scorecard
from callsentry.models import ScoringRule

MAX_TEXT = 300


@dataclass(frozen=True)
class Rule:
    id: str
    step_key: str
    text: str


async def active(session: AsyncSession, business_id: uuid.UUID) -> dict[str, list[Rule]]:
    """Active rules by scorecard key."""
    rows = await session.scalars(
        select(ScoringRule)
        .where(ScoringRule.business_id == business_id, ScoringRule.active.is_(True))
        .order_by(ScoringRule.created_at)
    )
    out: dict[str, list[Rule]] = {}
    for r in rows:
        out.setdefault(r.scorecard_key, []).append(Rule(str(r.id), r.step_key, r.text))
    return out


def for_scorecard(scorecard: Scorecard, rules: list[Rule]) -> list[Rule]:
    """Rules for steps this scorecard still has."""
    keys = {i.key for i in scorecard.items}
    return [r for r in rules if r.step_key in keys]


def prompt_section(scorecard: Scorecard, rules: list[Rule]) -> str:
    if not rules:
        return ""
    lines = [
        "## This company's own rules",
        "The company's manager set these after correcting earlier grades. They say where "
        "this company draws the line on a step, and take priority over the general grading "
        "guidance above. Apply a rule only when the situation it describes happens on this "
        "call; otherwise grade the step as usual. When a rule decides a step, say so in its "
        "reason.",
    ]
    for r in rules:
        item = scorecard.item(r.step_key)
        lines.append(f"- `{r.step_key}` ({item.label if item else r.step_key}): {r.text}")
    return "\n".join(lines)
