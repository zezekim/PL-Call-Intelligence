from __future__ import annotations

from datetime import UTC, datetime, timedelta

from callsentry.agents.booking_agent import parse_preferred_time
from callsentry.services.calcom import Slot


def test_parse_empty_defaults_to_tomorrow_morning():
    result = parse_preferred_time("", timezone="America/New_York")
    assert result > datetime.now(UTC)
    assert result < datetime.now(UTC) + timedelta(days=2)


def test_parse_garbage_does_not_raise():
    """A bad STT transcription costs one clarifying turn, not a crash."""
    result = parse_preferred_time("asdkjhasd qwe", timezone="America/New_York")
    assert isinstance(result, datetime)
    assert result.tzinfo is not None


def test_parse_returns_future_time():
    """'Monday at 2' said on Tuesday means next Monday."""
    result = parse_preferred_time("Monday at 2pm", timezone="America/New_York")
    assert result > datetime.now(UTC)


def test_parse_always_returns_timezone_aware():
    for phrase in ("tomorrow at 3", "next Friday morning", "the 25th at noon", ""):
        assert parse_preferred_time(phrase, timezone="UTC").tzinfo is not None


def test_slot_human_renders_in_business_timezone():
    # 2026-07-23 14:30 UTC is 10:30 AM in New York (EDT).
    start = datetime(2026, 7, 23, 14, 30, tzinfo=UTC)
    spoken = Slot(start=start, end=start + timedelta(minutes=30)).human("America/New_York")
    assert "10:30 AM" in spoken
    assert "Thursday" in spoken


def test_builtin_windows_follow_business_hours():
    import uuid
    from datetime import UTC, datetime

    from callsentry.models import Business
    from callsentry.services import schedule

    business = Business(
        id=uuid.uuid4(), name="ABC Pest Control", timezone="America/Denver",
        business_hours={"mon": ["08:00", "18:00"], "tue": ["08:00", "18:00"],
                        "wed": None, "thu": None, "fri": None,
                        "sat": ["09:00", "14:00"], "sun": None},
    )
    # Monday 2026-09-28, 06:00 local.
    after = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)
    slots = schedule.windows(business, after=after, days=6)
    local = [s.start.astimezone(schedule.ZoneInfo("America/Denver")) for s in slots]
    assert {d.strftime("%a") for d in local} == {"Mon", "Tue", "Sat"}
    # Saturday closes at 14:00: only the 10:00-12:00 window fits after opening at 09:00.
    assert [d.hour for d in local if d.strftime("%a") == "Sat"] == [10]
    assert slots[0].human("America/Denver").endswith("between 8 AM and 10 AM")
