"""Done for you: drafts, links, the morning text and its replies.

A wrong draft goes to a real customer's phone, so the wording rules are
pinned here: who it's from, what it mentions, and the opt-out line.
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

import pytest

from callsentry.intel import actions, brief, morning, phones
from callsentry.models import Business, Call, CallAnalysis, CallSource, OwnerAction

# --- Phones and money --------------------------------------------------------------


@pytest.mark.parametrize(("raw", "want"), [
    ("(555) 123-4567", "+15551234567"),
    ("555.123.4567", "+15551234567"),
    ("1 555 123 4567", "+15551234567"),
    ("+44 20 7946 0958", "+442079460958"),
    ("unknown", None),
    ("12345", None),
    ("", None),
])
def test_phone_numbers_normalise(raw, want):
    assert phones.normalize(raw) == want


def test_number_said_on_the_call_wins_over_caller_id():
    call = Call(source=CallSource.TWILIO, caller_number="+15550000000")
    said = CallAnalysis(triage={"customer_phone": "555 123 4567"})
    assert phones.for_call(call, said) == "+15551234567"
    assert phones.for_call(call, CallAnalysis(triage={})) == "+15550000000"
    # An uploaded recording has no caller id.
    assert phones.for_call(Call(source="upload", caller_number=""), None) is None


@pytest.mark.parametrize(("price", "yearly"), [
    ("$49 a month", 588), ("$49/mo", 588), ("$120 per quarter", 480),
    ("$540 a year", 540), ("$350 one-time", 350), ("about two hundred", None), (None, None),
])
def test_quotes_are_valued_over_a_year(price, yearly):
    assert brief.yearly_value(price) == yearly


def test_money_line_leads_with_what_is_slipping():
    line = brief.money_line({"open_yearly": 3000, "at_risk_yearly": 2100, "at_risk_count": 3})
    assert line == ("$2,100 a year in quotes is slipping: "
                    "3 customers waiting too long for a call back.")
    assert brief.money_line({"open_yearly": 540}) == (
        "$540 a year in quotes is waiting on an answer.")
    assert brief.money_line({}) is None


# --- Drafts ------------------------------------------------------------------------


def _item(situation="quoted", **ctx):
    return {
        "key": "lead:1:2", "title": "Call Sarah back", "why": "Sarah was given a price.",
        "priority": 90, "href": "/v2/pipeline", "value": 588,
        "context": {"situation": situation, "customer": "Sarah Jones", "phone": "+15551234567",
                    "rep": "Mike", "rep_id": "r1", "lead_id": None, "call_id": None,
                    "about": "the ants", "price": 49.0, **ctx},
    }


def test_customer_text_is_from_the_rep_and_names_the_quote():
    body = actions.customer_text(_item()["context"], "ABC Pest")
    assert body.startswith("Hi Sarah, it's Mike from ABC Pest.")
    assert "$49 quote for the ants" in body
    assert body.endswith("Reply STOP to opt out.")


def test_receptionist_calls_text_from_the_business_and_are_never_sent_to_the_ai():
    item = _item(rep="AI Receptionist", rep_id=None)
    body = actions.customer_text(item["context"], "ABC Pest")
    assert body.startswith("Hi Sarah, it's ABC Pest.")
    options = actions.options_for(item, "ABC Pest", {})
    assert [o["kind"] for o in options] == [actions.TEXT_CUSTOMER]


def test_no_name_no_invented_name():
    body = actions.customer_text(_item(customer="")["context"], "ABC Pest")
    assert body.startswith("Hi, it's Mike from ABC Pest.")


def test_sales_work_asks_the_rep_to_call_first_checkins_text_first():
    reps = {"r1": ("Mike", "+15557654321")}
    sales = actions.options_for(_item(), "ABC Pest", reps)
    best = max(sales, key=lambda o: o["priority"])
    assert best["kind"] == actions.REMIND_REP and best["label"] == "Ask Mike to call"
    assert best["to_phone"] == "+15557654321"
    assert "(555) 123-4567" in best["body"] and "Try opening with" in best["body"]
    checkin = actions.options_for(_item("checkin"), "ABC Pest", reps)
    assert max(checkin, key=lambda o: o["priority"])["kind"] == actions.TEXT_CUSTOMER


def test_rep_without_a_mobile_still_gets_an_option_to_fill_in():
    options = actions.options_for(_item(), "ABC Pest", {"r1": ("Mike", None)})
    remind = next(o for o in options if o["kind"] == actions.REMIND_REP)
    assert remind["to_phone"] is None


@pytest.mark.parametrize("situation", ["quoted", "follow_up", "new", "confirm", "winback",
                                       "checkin", "promise"])
def test_every_draft_fits_in_two_texts(situation):
    body = actions.customer_text(_item(situation)["context"], "ABC Pest Control of Springfield")
    assert len(body) <= 306 and "None" not in body


def test_coaching_text_carries_the_words_and_the_link():
    body = actions.coach_text("Mike Smith", {"title": "Recap before the price",
                                             "try_saying": "So it's ants in the kitchen."},
                              "https://x/coach/t")
    assert body.startswith("Hi Mike, your one thing for this week: Recap before the price.")
    assert "“So it's ants in the kitchen.”" in body and body.endswith("https://x/coach/t")


# --- Coaching links ----------------------------------------------------------------


def test_coaching_link_round_trips_and_rejects_tampering_and_age():
    action_id = uuid.uuid4()
    token = actions.coach_token(action_id)
    assert actions.read_coach_token(token) == action_id
    hex_id, exp, sig = token.split(".")
    assert actions.read_coach_token(f"{uuid.uuid4().hex}.{exp}.{sig}") is None
    assert actions.read_coach_token(f"{hex_id}.{exp}.{sig[:-1]}x") is None
    assert actions.read_coach_token("garbage") is None
    later = time.time() + (actions.COACH_LINK_DAYS + 1) * 86400
    assert actions.read_coach_token(token, now=later) is None


# --- Autopilot hours -----------------------------------------------------------------


@pytest.mark.parametrize(("utc", "ok"), [
    (datetime(2026, 10, 7, 13, 30, tzinfo=UTC), True),   # Wed 9:30 New York
    (datetime(2026, 10, 7, 12, 30, tzinfo=UTC), False),  # Wed 8:30
    (datetime(2026, 10, 7, 23, 30, tzinfo=UTC), False),  # Wed 7:30pm
    (datetime(2026, 10, 11, 15, 0, tzinfo=UTC), False),  # Sunday
])
def test_autopilot_only_texts_in_the_daytime(utc, ok):
    business = Business(timezone="America/New_York")
    assert actions.daytime(business, utc) is ok


def test_autopilot_kinds_ignore_unknown_and_off():
    business = Business(autopilot={"text_customer": True, "coach_rep": False, "nuke": True})
    assert actions.enabled_kinds(business) == {"text_customer"}


# --- Morning text ----------------------------------------------------------------------


def _action(label, title, value=None):
    return OwnerAction(label=label, title=title, value_usd=value, body="", kind="text_customer",
                       item_key="k")


def test_morning_text_is_numbered_with_money_first():
    body = morning.compose("$2,100 a year in quotes is slipping.", [
        _action("Ask Mike to call", "Call Sarah back", 588),
        _action("Text Dan", "Check on Dan"),
    ], greeting=True)
    assert body.splitlines()[:2] == ["Good morning!", "$2,100 a year in quotes is slipping."]
    assert "1) Ask Mike to call: Call Sarah back ($588/yr)" in body
    assert "2) Text Dan: Check on Dan" in body
    assert body.endswith("Reply 1 or 2 and I'll do it. Reply ALL for all of them.")


def test_quiet_morning_says_so():
    assert morning.compose(None, [], greeting=True) == "Good morning!\nNothing needs you today."


@pytest.mark.parametrize(("text", "want"), [
    ("1", [1]), (" 3 ", [3]), ("1 and 3", [1, 3]), ("2,2", [2]), ("ALL", [1, 2, 3]),
    ("list", "list"), ("?", "list"), ("4", "help"), ("thanks!", "help"), ("0", "help"),
])
def test_owner_replies_pick_menu_items(text, want):
    assert morning.parse_choice(text, 3) == want


def test_an_option_ready_to_send_comes_before_one_missing_a_number():
    options = actions.options_for(_item(), "ABC Pest", {"r1": ("Mike", None)})
    assert max(options, key=lambda o: o["priority"])["kind"] == actions.TEXT_CUSTOMER


def test_a_lead_just_followed_up_is_not_counted_as_slipping():
    open_leads = [
        {"id": "a", "yearly": 588, "action": {"urgency": "overdue"}},
        {"id": "b", "yearly": 300, "action": {"urgency": "cold"}},
        {"id": "c", "yearly": 100, "action": {"urgency": "today"}},
    ]
    out = brief.without_handled({"open_yearly": 988}, open_leads, {"a"})
    assert (out["at_risk_yearly"], out["at_risk_count"], out["open_yearly"]) == (300, 1, 988)
