"""Warm transfer: what staff hear, and what counts as a transfer number."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from callsentry.agents.voice_agent import CallState
from callsentry.api.routes.settings import SettingsPatch
from callsentry.api.routes.webhooks import whisper_text
from callsentry.models import Call


def test_whisper_names_the_caller_and_reason():
    state = CallState(call_id="c", business_id="b", caller_number="+13855550100")
    state.collected.update(name="Dana", pest="wasps")
    call = Call(caller_number="+13855550100", escalation_reason="caller asked for a manager")
    text = whisper_text(state, call)
    assert text.startswith("Transfer from the AI receptionist: Dana at 1 3 8 5")
    assert "calling about wasps" in text
    assert "Reason: caller asked for a manager." in text


def test_whisper_without_state_still_speaks():
    assert whisper_text(None, None) == (
        "Transfer from the AI receptionist: a caller. Connecting you now."
    )


@pytest.mark.parametrize(
    ("raw", "stored"),
    [("(385) 555-0100", "+13855550100"), ("+44 20 7946 0958", "+442079460958"), ("", "")],
)
def test_transfer_number_is_normalised(raw: str, stored: str):
    assert SettingsPatch(escalation_phone=raw).escalation_phone == stored


def test_bad_values_are_rejected():
    with pytest.raises(ValidationError):
        SettingsPatch(escalation_phone="call me")
    with pytest.raises(ValidationError):
        SettingsPatch(timezone="Mars/Olympus")
    assert SettingsPatch(timezone="America/Denver").timezone == "America/Denver"
