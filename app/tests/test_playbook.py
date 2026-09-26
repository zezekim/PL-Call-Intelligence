"""The receptionist playbook must carry technique, never people or prices."""

from __future__ import annotations

from callsentry.intel import playbook
from callsentry.models import CallAnalysis


def _analysis(customer, rep, company):
    return CallAnalysis(customer_name=customer, rep_name=rep, triage={"company_name": company})


def test_blocklist_collects_names_but_not_generic_trade_words():
    blocked = playbook.blocklist([_analysis("Nina Deng", "Kristen", "Brumley Pest Control")])
    assert {"nina", "deng", "kristen", "brumley"} <= blocked
    assert "pest" not in blocked and "control" not in blocked


def test_entries_with_personal_or_pricing_details_are_dropped():
    blocked = {"maureen", "brumley"}
    assert playbook.is_clean("I'm so sorry about the [pest] in your [room].", blocked)
    assert not playbook.is_clean("Maureen was worried about the price.", blocked)
    assert not playbook.is_clean("Brumley offers a free inspection.", blocked)
    assert not playbook.is_clean("The initial service is $199.", blocked)
    assert not playbook.is_clean("Call us back at 385-336-0152.", blocked)
    assert not playbook.is_clean("Send it to jane@example.com.", blocked)
    assert not playbook.is_clean("We'll be at 616 North Fort Hood Street.", blocked)
    assert not playbook.is_clean("The tech comes at 9 am.", blocked)


def test_render_keeps_clean_entries_and_counts_removed_ones():
    data = {
        "caller_questions": [
            {"question": "Do you treat [pest]?", "how_to_answer": "Confirm, then offer a visit."},
            {"question": "Is Kristen there?", "how_to_answer": "Offer a callback."},
        ],
        "phrases": [
            {"step": "validate", "example": "That sounds frustrating, I can help."},
            {"step": "close", "example": "It's just $49 a month."},
        ],
        "objections": [{"objection": "I need to ask my spouse.",
                        "response": "Agree, restate, offer to send details."}],
        "booking_details": ["Service address", "Where the activity is"],
        "avoid": ["Processing a cancel without an offer."],
    }
    text, removed = playbook.render_markdown(data, {"kristen"})
    assert removed == 2
    assert "Kristen" not in text and "$49" not in text
    assert "Do you treat [pest]?" in text
    assert "## Before booking, collect" in text
    assert "That sounds frustrating" in text


def test_persona_includes_published_playbook_and_caller_note(business):
    from callsentry.agents import voice_agent

    state = voice_agent.CallState(call_id="c", business_id="b", caller_number="+1",
                                  returning_note="They called before, on May 2.")
    text = voice_agent._persona(business, playbook="## Objections\n- Price", state=state)
    assert "Validate." in text and "Understand." in text
    assert "## Objections" in text
    assert "They called before, on May 2." in text
    assert "{extra}" not in text


def test_call_state_round_trips_returning_note():
    from callsentry.agents.voice_agent import CallState
    from callsentry.services import callstate

    state = CallState(call_id="c", business_id="b", caller_number="+1", returning_note="note")
    assert callstate._load(callstate._dump(state)).returning_note == "note"
