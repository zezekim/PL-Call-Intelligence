"""The owner's brief: targets, next actions, coaching focus and the headline."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from callsentry.intel import brief
from callsentry.intel.insights import Row
from callsentry.models import Call, CallAnalysis, Lead, LeadStage

NOW = datetime(2026, 10, 1, 15, tzinfo=UTC)


@pytest.mark.parametrize(
    ("value", "status"),
    [(None, "none"), (72.0, "good"), (50.0, "good"), (40.0, "watch"), (10.0, "bad")],
)
def test_close_rate_is_judged_against_its_target(value, status):
    assert brief.TARGETS["close_rate"].status(value) == status


def _lead(stage: LeadStage, *, days_ago: int, price: str | None = None) -> Lead:
    return Lead(name="Pat", stage=stage.value, price_quoted=price,
                last_contact_at=NOW - timedelta(days=days_ago))


def test_decided_leads_have_no_next_step():
    for stage in (LeadStage.WON, LeadStage.LOST):
        assert brief.lead_action(_lead(stage, days_ago=1), {}, NOW) is None


def test_quoted_lead_gets_an_owner_action_with_urgency():
    action = brief.lead_action(_lead(LeadStage.QUOTED, days_ago=4, price="$649 initial"), {}, NOW)
    assert action["label"] == "Follow up on the quote"
    assert action["why"] == "Quoted $649, no decision yet"
    assert action["urgency"] == "overdue"
    assert brief.lead_action(_lead(LeadStage.QUOTED, days_ago=0), {}, NOW)["urgency"] == "upcoming"
    assert brief.lead_action(_lead(LeadStage.FOLLOW_UP, days_ago=20), {}, NOW)["urgency"] == "cold"


def test_only_sales_promises_by_the_office_count_as_pipeline_work():
    triage = {"follow_ups": [
        {"owner": "technician", "action": "Technician to treat the nest"},
        {"owner": "rep", "action": "Perform inspection and treat for ants"},
        {"owner": "customer", "action": "Call back with a decision"},
        {"owner": "office", "action": "Send the service agreement by email"},
    ]}
    assert brief.owner_promise(triage) == "Send the service agreement by email"
    assert brief.owner_promise({"follow_ups": triage["follow_ups"][:3]}) is None


@pytest.mark.parametrize(
    ("price", "value"),
    [("$649 initial; $59/month", 649.0), ("$1,280 prepaid", 1280.0), ("Complimentary", None),
     (None, None)],
)
def test_quoted_value(price, value):
    assert brief.quoted_value(price) == value


def _row(items: list[dict], *, pct_items: int | None = None) -> Row:
    call = Call(caller_number="", external_ref="CALL-1")
    call.created_at = NOW
    analysis = CallAnalysis(items=items, score=sum(1 for i in items if i["awarded"]),
                            score_max=pct_items or len(items), coaching={})
    return Row(call, analysis)


def _item(key: str, awarded: bool, **extra) -> dict:
    return {"key": key, "label": key.title(), "quadrant": "Verify", "awarded": awarded, **extra}


def test_focus_is_the_most_missed_step_and_ignores_automatic_awards():
    auto = _item("agree", True, auto_awarded=True)
    rows = [
        _row([_item("thank", False), _item("close", True), auto]),
        _row([_item("thank", False), _item("close", False), auto]),
        _row([_item("thank", True), _item("close", True), auto]),
    ]
    stats = brief.step_stats(rows)
    assert "Agree" not in stats
    assert brief.focus_step(stats).key == "thank"
    assert [s.key for s in brief.strong_steps(stats)] == ["close"]


def test_a_single_miss_is_not_enough_to_call_it_a_gap():
    stats = brief.step_stats([_row([_item("thank", False)])])
    assert brief.focus_step(stats) is None


def _card(label: str, value: float | None, status: str, target: float = 50) -> dict:
    return {"label": label, "metric_label": "Rate", "value": value, "status": status,
            "target": target, "detail": "1 of 20 calls meet standard"}


def test_headline_leads_with_the_worst_problem():
    cards = [_card("Sales", 55, "good"), _card("Retention", 0, "bad", 60),
             _card("Customer service", 90, "good"),
             {**_card("Call quality", 50, "bad"), "meeting": 1, "scored": 21}]
    coach = {"focus": {"step": "Thank the Customer", "missed": 18, "of": 21}}
    result = brief.headline(cards, coach)
    assert result["status"] == "bad"
    assert result["title"] == "Retention needs attention: rate is 0% against a 60% target."
    assert "Sales and customer service are on target." in result["detail"]
    assert result["detail"].endswith(
        "Only 1 of 21 calls meet the call standard; the step missed most is "
        "“Thank the Customer” (18 of 21 calls)."
    )


def test_headline_when_everything_is_on_target():
    cards = [_card(n, 90, "good") for n in ("Sales", "Retention", "Customer service")]
    cards.append(_card("Call quality", 90, "good"))
    result = brief.headline(cards, None)
    assert result == {"status": "good",
                      "title": "Sales, retention and service are all on target.", "detail": ""}


def test_with_one_call_the_focus_is_what_that_call_was_coached_on():
    row = _row([_item("validate", False), _item("thank", False), _item("close", True)])
    row.analysis.coaching = {"coaching": [{"item_keys": ["thank"], "try_saying": "Thanks!"}]}
    stats = brief.step_stats([row])
    assert brief.focus_step(stats) is None
    assert brief.coached_step([row], stats).key == "thank"
