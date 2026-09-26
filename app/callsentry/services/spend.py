"""Daily spending cap on paid providers.

Every paid interaction already lands in the cost ledger. This keeps today's
cloud total in memory (seeded from the ledger at boot, then incremented as
rows are written), and the provider registry refuses cloud providers once it
reaches DAILY_SPEND_CAP_USD. The live demo has a public phone number and an
upload button; the cap bounds what a stranger can spend.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.config import get_settings

_day: date = datetime.now(UTC).date()
_spent: float = 0.0


def _roll() -> None:
    global _day, _spent
    today = datetime.now(UTC).date()
    if today != _day:
        _day, _spent = today, 0.0


def add(cost_usd: float) -> None:
    global _spent
    _roll()
    _spent += max(0.0, float(cost_usd))


def spent_today() -> float:
    _roll()
    return round(_spent, 4)


def cap() -> float:
    return float(get_settings().daily_spend_cap_usd or 0)


def exceeded() -> bool:
    limit = cap()
    return limit > 0 and spent_today() >= limit


async def refresh(session: AsyncSession) -> float:
    """Reload today's cloud spend from the ledger."""
    global _day, _spent
    from callsentry.models import CostEntry

    today = datetime.now(UTC).date()
    start = datetime(today.year, today.month, today.day, tzinfo=UTC)
    total = await session.scalar(
        select(func.coalesce(func.sum(CostEntry.cost_usd), 0)).where(
            CostEntry.created_at >= start, CostEntry.tier == "cloud"
        )
    )
    _day, _spent = today, float(total or 0)
    return _spent
