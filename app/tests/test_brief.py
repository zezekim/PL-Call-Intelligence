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
    assert action["label"] == "Call Pat back"
    assert action["why"] == "Pat was given a price ($649) and hasn't decided yet."
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


def _card(key: str, status: str) -> dict:
    return {"key": key, "label": key.title(), "status": status}


TODO = [{"title": "Try to win back Dana"}]
COACH = {"focus": {"plain": "Say thank you", "missed": 18, "of": 21}}


def test_headline_gives_the_verdict_and_next_step_without_numbers():
    cards = [_card("sales", "good"), _card("retention", "bad"), _card("service", "watch"),
             _card("quality", "bad")]
    result = brief.headline(cards, COACH, TODO)
    assert result["status"] == "bad"
    assert result["title"] == (
        "Customers who call to cancel are not being kept. Also, a few customer problems "
        "are not fixed on the call."
    )
    assert result["detail"] == (
        "Start with: Try to win back Dana. This week, teach the team to “say thank you”."
    )
    assert not any(ch.isdigit() for ch in result["title"])


def test_areas_with_too_few_calls_are_not_judged():
    # One cancellation call is not a trend: its card is "none", not "bad".
    assert brief._judge("save_rate", 0.0, 1) == "none"
    assert brief._judge("save_rate", 0.0, 3) == "bad"
    cards = [_card("sales", "good"), _card("retention", "none"), _card("service", "good"),
             _card("quality", "bad")]
    result = brief.headline(cards, COACH, TODO)
    assert result["title"] == "Customers are being looked after, but calls are skipping key steps."
    assert result["status"] == "bad"


def test_headline_when_everything_is_on_target():
    cards = [_card(k, "good") for k in ("sales", "retention", "service", "quality")]
    assert brief.headline(cards, None, [])["title"] == "Things are going well."


def test_headline_with_no_judged_areas():
    cards = [_card(k, "none") for k in ("sales", "retention", "service", "quality")]
    result = brief.headline(cards, None, [])
    assert result["status"] == "none"
    assert result["title"].startswith("There are not enough calls yet")


def test_every_scorecard_step_has_a_plain_name():
    from callsentry.intel.rubrics import SCORECARDS

    keys = {item.key for sc in SCORECARDS.values() for item in sc.items}
    assert keys <= set(brief.PLAIN_STEPS)


def test_with_one_call_the_focus_is_what_that_call_was_coached_on():
    row = _row([_item("validate", False), _item("thank", False), _item("close", True)])
    row.analysis.coaching = {"coaching": [{"item_keys": ["thank"], "try_saying": "Thanks!"}]}
    stats = brief.step_stats([row])
    assert brief.focus_step(stats) is None
    assert brief.coached_step([row], stats).key == "thank"


def test_coaching_tip_prefers_one_mainly_about_the_step():
    row = _row([_item("thank", False)])
    row.analysis.coaching = {"coaching": [
        {"item_keys": ["validate", "thank"], "try_saying": "Sorry about the ants!"},
        {"item_keys": ["thank"], "try_saying": "Thanks for calling us."},
    ]}
    stat = brief.step_stats([row])["Thank"]
    assert brief._tip_for([row], stat)["try_saying"] == "Thanks for calling us."



def test_goals_come_from_settings(monkeypatch):
    from callsentry.config import get_settings

    settings = get_settings()
    assert brief.goal_text("save_rate", "kept") == "Goal: at least 6 out of 10 kept"
    assert brief.goal_text("resolution_rate", "fixed") == "Goal: at least 85 out of 100 fixed"
    monkeypatch.setattr(settings, "goal_save_rate", 70.0)
    assert brief.TARGETS["save_rate"].status(60) == "watch"
    assert brief.TARGETS["save_rate"].status(50) == "bad"
    assert brief.goal_text("save_rate", "kept") == "Goal: at least 7 out of 10 kept"
