"""The weekly digest's content and when it counts as configured."""

from __future__ import annotations

from callsentry.config import get_settings
from callsentry.models import Business
from callsentry.services import digest

OVERVIEW = {
    "scorecard": {"calls": 12, "scored": 10, "avg_score_pct": 61.4, "needs_review": 0,
                  "disputed_calls": 2, "grades": {"gold": 1, "green": 3, "below": 6}},
    "sales": {"close_rate": 50.0},
    "retention": {"saved": 1, "cancelled": 2},
    "follow_ups": [{}, {}, {}],
    "training": [{"step": "Summary Statement", "missed": 7, "of": 10}],
}


def test_digest_lists_stats_attention_and_coaching():
    subject, text, html = digest.compose(Business(name="ABC <Pest>"), OVERVIEW)
    assert subject == "ABC <Pest>: 12 calls this week, average score 61%"
    assert "Cancels saved: 1 of 3" in text
    assert "3 open follow-ups" in text and "2 calls with disputed steps" in text
    # Zero counts are left out rather than listed.
    assert "call types to confirm" not in text
    assert "Summary Statement: missed on 7 of 10 calls" in text
    assert "ABC &lt;Pest&gt;" in html


def test_not_configured_until_smtp_and_recipients(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "")
    assert digest.configured() == "SMTP server is not set"
    monkeypatch.setattr(s, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(s, "digest_recipients", " , ")
    assert digest.configured() == "no recipients"
    monkeypatch.setattr(s, "digest_recipients", "a@example.com, b@example.com")
    monkeypatch.setattr(s, "smtp_username", "bot@example.com")
    assert digest.configured() is None
    assert digest.recipients() == ["a@example.com", "b@example.com"]
