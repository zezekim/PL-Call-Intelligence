"""Plain-language rewrites change the words only, never what they point at."""

from __future__ import annotations

from callsentry.intel.plainspeak import merge


def test_merge_keeps_moments_and_steps():
    original = {
        "overall_feedback": "Leverage consensus.",
        "strengths": [{"title": "Clear commitment", "detail": "Locked it in.", "segment_id": 9,
                       "start": 94.0, "quote": "Does that work?", "verified": True}],
        "coaching": [{"title": "Signal the shift", "item_keys": ["expectation_statement_2"],
                      "segment_id": 26, "start": 76.0, "what_happened": "x",
                      "try_saying": "y", "why_it_matters": "z"}],
    }
    plain = {
        "overall_feedback": "Check they agree.",
        "strengths": [{"title": "Got a clear yes", "detail": "You asked if the time worked."}],
        "coaching": [{"title": "Say what comes next", "what_happened": "a",
                      "try_saying": "b", "why_it_matters": "c"}],
    }
    merged = merge(original, plain)
    assert merged["plain"] is True
    assert merged["overall_feedback"] == "Check they agree."
    tip = merged["coaching"][0]
    assert tip["title"] == "Say what comes next"
    assert tip["item_keys"] == ["expectation_statement_2"]
    assert (tip["segment_id"], tip["start"]) == (26, 76.0)
    strength = merged["strengths"][0]
    assert strength["title"] == "Got a clear yes" and strength["quote"] == "Does that work?"


def test_merge_keeps_original_text_when_a_field_comes_back_empty():
    original = {"overall_feedback": "Keep", "strengths": [], "coaching": [
        {"title": "Old", "what_happened": "w", "try_saying": "t", "why_it_matters": "m"}]}
    merged = merge(original, {"overall_feedback": "", "strengths": [],
                              "coaching": [{"title": "", "what_happened": "New"}]})
    assert merged["overall_feedback"] == "Keep"
    assert merged["coaching"][0]["title"] == "Old"
    assert merged["coaching"][0]["what_happened"] == "New"
