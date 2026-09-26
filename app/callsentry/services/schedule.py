"""Built-in appointment windows, used when no Cal.com calendar is connected.

Pest control books arrival windows, not exact times. Openings are the
business's open days, in two-hour windows, minus windows already booked. Like
the Cal.com path, only real openings are ever offered.
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.models import Appointment, AppointmentStatus, Business
from callsentry.services.calcom import Slot

WINDOW_STARTS = (time(8), time(10), time(13), time(15))
WINDOW_HOURS = 2
_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _open_window(business: Business, day: datetime, start: time) -> bool:
    hours = (business.business_hours or {}).get(_DAYS[day.weekday()])
    if not hours:
        return False
    try:
        opens = time.fromisoformat(str(hours[0]))
        closes = time.fromisoformat(str(hours[1]))
    except (ValueError, IndexError, TypeError):
        return True
    return opens <= start and (
        datetime.combine(day.date(), start) + timedelta(hours=WINDOW_HOURS)
    ).time() <= closes


def windows(business: Business, *, after: datetime, days: int = 14) -> list[Slot]:
    tz = ZoneInfo(business.timezone)
    local_after = after.astimezone(tz)
    out: list[Slot] = []
    for offset in range(days + 1):
        day = (local_after + timedelta(days=offset)).replace(hour=0, minute=0, second=0,
                                                              microsecond=0)
        for start in WINDOW_STARTS:
            if not _open_window(business, day, start):
                continue
            begin = datetime.combine(day.date(), start, tzinfo=tz)
            if begin <= local_after:
                continue
            out.append(Slot(begin.astimezone(UTC),
                            (begin + timedelta(hours=WINDOW_HOURS)).astimezone(UTC)))
    return out


async def find_slot(
    session: AsyncSession, business: Business, *, preferred: datetime
) -> Slot | None:
    now = datetime.now(UTC)
    taken = set(
        (
            await session.scalars(
                select(Appointment.scheduled_at).where(
                    Appointment.business_id == business.id,
                    Appointment.status == AppointmentStatus.CONFIRMED,
                    Appointment.scheduled_at >= now,
                )
            )
        ).all()
    )
    # Same-day work needs a little lead time.
    candidates = [s for s in windows(business, after=now + timedelta(hours=2))
                  if s.start not in taken]
    if not candidates:
        return None
    return min(candidates, key=lambda s: abs((s.start - preferred).total_seconds()))
