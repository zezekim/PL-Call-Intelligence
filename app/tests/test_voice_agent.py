"""Business-hours logic, compliance disclosures, and conversation guards."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from callsentry.agents.voice_agent import (
    CallState,
    _is_affirmative,
    is_open,
    opening_line,
    spoken_hours,
)


def _at(business, *, day: int, hour: int, minute: int = 0) -> datetime:
    """A datetime in the business's own timezone. 2026-07-20 is a Monday."""
    return datetime(2026, 7, 20 + day, hour, minute, tzinfo=ZoneInfo(business.timezone))


@pytest.mark.parametrize(
    ("day", "hour", "expected"),
    [
        (0, 12, True),   # Monday midday
        (0, 9, True),    # exactly opening time
        (0, 8, False),   # before opening
        (0, 17, False),  # exactly closing time is closed
        (0, 18, False),  # after closing
        (4, 16, True),   # Friday afternoon
        (5, 12, False),  # Saturday - configured closed
        (6, 12, False),  # Sunday - configured closed
    ],
)
def test_is_open(business, day, hour, expected):
    assert is_open(business, at=_at(business, day=day, hour=hour)) is expected


def test_is_open_fails_open_on_malformed_hours(business):
    """A config typo should not silently make a business unreachable."""
    business.business_hours = {"mon": ["nine", "five"]}
    assert is_open(business, at=_at(business, day=0, hour=12)) is True


def test_opening_line_discloses_ai_and_recording(business):
    line = opening_line(business, after_hours=False)
    assert "AI assistant" in line
    assert "recorded" in line
    assert business.name in line


def test_after_hours_opening_states_hours(business):
    line = opening_line(business, after_hours=True)
    assert "AI assistant" in line
    assert "closed" in line.lower()
    assert "Monday through Friday" in line


def test_greeting_override_is_respected(business):
    business.greeting_override = "Custom greeting - AI assistant, recorded line."
    assert opening_line(business, after_hours=False) == business.greeting_override


def test_spoken_hours_handles_appointment_only(business):
    business.business_hours = {d: None for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}
    assert spoken_hours(business) == "by appointment only"


@pytest.mark.parametrize(
    "text", ["yes", "Yeah", "that works", "sounds good", "Sure.", "book it", "perfect!"]
)
def test_affirmative_detection(text):
    assert _is_affirmative(text)


@pytest.mark.parametrize("text", ["no", "not really", "what else do you have", "hmm"])
def test_non_affirmative_detection(text):
    assert not _is_affirmative(text)


def test_history_is_bounded(business):
    """Long calls must not grow the prompt without limit."""
    state = CallState(call_id="c", business_id=str(business.id), caller_number="+1555")
    for i in range(200):
        state.remember("user", f"turn {i}")
        state.remember("assistant", f"reply {i}")
    assert len(state.history) <= 24


def test_merge_entities_does_not_overwrite_known_values():
    state = CallState(call_id="c", business_id="b", caller_number="+1555")
    state.merge_entities({"name": "Alice", "email": ""})
    state.merge_entities({"name": "", "email": "alice@example.com"})
    # A later blank must not erase a name we already captured.
    assert state.collected == {"name": "Alice", "email": "alice@example.com"}


def test_spoken_hours_groups_days_and_says_times_naturally(business):
    business.business_hours = {
        "mon": ["08:00", "18:00"], "tue": ["08:00", "18:00"], "wed": ["08:00", "18:00"],
        "thu": ["08:00", "18:00"], "fri": ["08:00", "18:00"], "sat": ["09:00", "14:00"],
        "sun": None,
    }
    assert spoken_hours(business) == (
        "Monday through Friday, 8 AM to 6 PM, and Saturday, 9 AM to 2 PM"
    )


def test_spoken_hours_minutes_and_single_day(business):
    business.business_hours = {"mon": ["07:30", "12:15"]}
    assert spoken_hours(business) == "Monday, 7:30 AM to 12:15 PM"


def test_welcome_back_comes_right_after_the_greeting(business):
    line = opening_line(business, after_hours=False, returning_name="Bianca Lee")
    assert line.startswith(f"Hi, thanks for calling {business.name}. Welcome back, Bianca.")
    assert "AI assistant" in line


def test_repeating_the_same_line_ends_the_call_instead_of_looping(business):
    from callsentry.agents.voice_agent import TurnResponse, _finish

    state = CallState(call_id="c", business_id="b", caller_number="+1")
    state.remember("assistant", "I'll have someone call you back.")
    state.remember("user", "Okay.")
    result = _finish(state, TurnResponse(text="I'll have someone call you back."))
    assert result.end_call is True
    assert "goodbye" in result.text.lower()


async def test_unanswerable_request_takes_a_message_once(business):
    from callsentry.agents import voice_agent

    business.escalation_phone = None
    state = CallState(call_id="c", business_id="b", caller_number="+1")
    state.collected["name"] = "Bianca"
    first = await voice_agent._escalate(business, state, reason="no KB answer")
    assert state.taking_message is True
    assert "transfer" not in first.text.lower()
    assert "pass along" in first.text


def test_call_state_round_trips_booking_and_message_flags():
    from callsentry.services import callstate

    state = CallState(call_id="c", business_id="b", caller_number="+1",
                      booked="Monday between 8 AM and 10 AM", taking_message=True)
    loaded = callstate._load(callstate._dump(state))
    assert loaded.booked == state.booked and loaded.taking_message is True


def test_speakable_drops_a_cut_off_sentence_and_formatting():
    from callsentry.agents.voice_agent import speakable

    cut = (
        "Yes, we can treat both on one visit. The service covers inside and out. "
        "Exact pricing gets confirmed by"
    )
    assert speakable(cut) == (
        "Yes, we can treat both on one visit. The service covers inside and out."
    )
    formatted = speakable("**Sure** - we can help.\n\nWant to book?")
    assert formatted == "Sure - we can help. Want to book?"
    long = "One. Two. Three. Four."
    assert speakable(long) == "One. Two. Three."
    # A single unfinished sentence is still better than silence.
    assert speakable("We can help with") == "We can help with"


@pytest.mark.parametrize("text", ["Never mind. Bye.", "okay bye", "No thanks.", "That's all"])
def test_leaving_is_not_taken_as_a_message(text):
    from callsentry.agents.voice_agent import _is_leaving

    assert _is_leaving(text)


@pytest.mark.parametrize(
    "text",
    ["Tell them the ants are back in the kitchen", "Nothing works on these ants, call me back"],
)
def test_real_messages_are_kept(text):
    from callsentry.agents.voice_agent import _is_leaving

    assert not _is_leaving(text)


def test_kb_answer_sees_the_recent_conversation():
    from callsentry.agents.kb_agent import _messages

    history = [
        {"role": "assistant", "content": "Hi, how can I help?"},
        {"role": "user", "content": "Ants all over the house, and rodents."},
        {"role": "assistant", "content": "Sorry to hear that."},
    ]
    messages = _messages("Can you do it in one session?", history)
    assert messages[0]["role"] == "user" and "rodents" in messages[0]["content"]
    assert messages[-1] == {"role": "user", "content": "Can you do it in one session?"}
