"""Call intelligence: the parts that are silent when wrong.

Grading thresholds, automatic awards, evidence verification and schema shape
all produce a plausible-looking result when broken, so each is pinned here.
"""

from __future__ import annotations

from typing import Any

import pytest

from callsentry.intel import analyze, rubrics
from callsentry.intel.ingest import external_ref
from callsentry.intel.rubrics import ALL_CALLS, RETENTION, SALES, CallType, Grade
from callsentry.intel.transcribe import parse_deepgram
from callsentry.intel.transcript import (
    CUSTOMER,
    REP,
    Segment,
    merge_adjacent,
    quote_score,
    render,
    resolve_evidence,
)

# --- Scorecards ----------------------------------------------------------------


def test_scorecard_sizes_match_the_manuals():
    assert ALL_CALLS.max_score == 12
    assert RETENTION.max_score == 12
    assert SALES.max_score == 17


@pytest.mark.parametrize(
    ("scorecard", "score", "grade"),
    [
        (ALL_CALLS, 12, Grade.GOLD),
        (ALL_CALLS, 11, Grade.GREEN),
        (ALL_CALLS, 10, Grade.BELOW),
        (RETENTION, 12, Grade.GOLD),
        (RETENTION, 11, Grade.GREEN),
        (RETENTION, 0, Grade.BELOW),
        (SALES, 17, Grade.GOLD),
        (SALES, 16, Grade.GREEN),
        (SALES, 14, Grade.GREEN),
        (SALES, 13, Grade.BELOW),
    ],
)
def test_grade_thresholds(scorecard, score, grade):
    assert scorecard.grade(score) is grade


def test_item_keys_are_unique_per_scorecard():
    for scorecard in rubrics.SCORECARDS.values():
        keys = [i.key for i in scorecard.items]
        assert len(keys) == len(set(keys)), scorecard.key


def test_every_scored_call_type_has_a_scorecard_and_lens():
    for call_type in CallType:
        if call_type is CallType.NOT_SCORABLE:
            assert rubrics.scorecard_for(call_type) is None
        else:
            assert rubrics.scorecard_for(call_type) is not None
            assert call_type in rubrics.LENS_BY_CALL_TYPE


def _all(status: str, scorecard: rubrics.Scorecard) -> dict[str, dict[str, Any]]:
    return {i.key: {"status": status, "reason": "", "evidence": []} for i in scorecard.items}


def test_missing_judgement_is_a_miss_not_a_free_point():
    judgements = _all("met", ALL_CALLS)
    del judgements["thank_customer"]
    _, score = rubrics.tally(ALL_CALLS, judgements)
    assert score == 11


def test_not_needed_only_awards_items_the_manual_allows():
    judgements = _all("not_needed", ALL_CALLS)
    items, score = rubrics.tally(ALL_CALLS, judgements)
    assert score == 0
    assert all(i.status == "missed" for i in items)


def test_unknown_status_is_a_miss():
    judgements = _all("met", ALL_CALLS)
    judgements["validate"]["status"] = "partially"
    _, score = rubrics.tally(ALL_CALLS, judgements)
    assert score == 11


# --- Manual rules ----------------------------------------------------------------

OBJECTION_KEYS = ("objection_agree", "objection_restate", "objection_resolve",
                  "objection_reclose")


def test_sales_without_objections_gets_the_four_objection_points():
    judgements = _all("met", SALES)
    for key in OBJECTION_KEYS:
        judgements[key]["status"] = "missed"
    analyze.apply_manual_rules(CallType.SALES, judgements, {"sales": {"objections": []}})
    items, score = rubrics.tally(SALES, judgements)
    assert score == 17
    assert all(i.auto_awarded for i in items if i.key in OBJECTION_KEYS)


def test_sales_with_objections_cannot_skip_handling_them():
    judgements = _all("met", SALES)
    for key in OBJECTION_KEYS:
        judgements[key]["status"] = "not_needed"
    triage = {"sales": {"objections": [{"objection": "too expensive", "segment_id": 9}]}}
    analyze.apply_manual_rules(CallType.SALES, judgements, triage)
    _, score = rubrics.tally(SALES, judgements)
    assert score == 13


def test_retention_repeat_awarded_when_first_offer_accepted():
    judgements = _all("met", RETENTION)
    judgements["repeat"]["status"] = "missed"
    triage = {"retention": {"first_offer_accepted": True, "cancel_reason": "price"}}
    analyze.apply_manual_rules(CallType.RETENTION, judgements, triage)
    _, score = rubrics.tally(RETENTION, judgements)
    assert score == 12


def test_retention_repeat_required_when_first_offer_declined():
    judgements = _all("met", RETENTION)
    judgements["repeat"]["status"] = "not_needed"
    triage = {"retention": {"first_offer_accepted": False, "cancel_reason": "price"}}
    analyze.apply_manual_rules(CallType.RETENTION, judgements, triage)
    _, score = rubrics.tally(RETENTION, judgements)
    assert score == 11


def test_retention_repeat_not_expected_when_customer_is_moving():
    judgements = _all("met", RETENTION)
    judgements["repeat"]["status"] = "missed"
    triage = {"retention": {"first_offer_accepted": False, "cancel_reason": "moving"}}
    analyze.apply_manual_rules(CallType.RETENTION, judgements, triage)
    _, score = rubrics.tally(RETENTION, judgements)
    assert score == 12


# --- Transcript and evidence ---------------------------------------------------


def _segments() -> list[Segment]:
    return [
        Segment(1, 0.0, 3.0, "Thanks for calling Summit Pest, this is Michelle.", "0", REP),
        Segment(2, 3.5, 8.0, "Hi, we've got ants all over the kitchen.", "1", CUSTOMER),
        Segment(3, 8.5, 14.0, "Oh no, I'm so sorry about those ants in your kitchen, "
                "I can definitely take care of that for you.", "0", REP),
    ]


def test_verbatim_quote_is_verified_and_timestamped():
    [ev] = resolve_evidence(
        [{"segment_id": 3, "quote": "I'm so sorry about those ants in your kitchen"}],
        _segments(),
    )
    assert ev["verified"] is True
    assert ev["start"] == 8.5
    assert ev["role"] == REP


def test_quote_tolerates_transcription_punctuation_and_case():
    assert quote_score("i can DEFINITELY take care of that", _segments()[2].text) == 1.0


def test_invented_quote_is_not_verified():
    [ev] = resolve_evidence(
        [{"segment_id": 3, "quote": "we will waive your next three payments for free"}],
        _segments(),
    )
    assert ev["verified"] is False


def test_quote_citing_a_missing_segment_is_not_verified():
    [ev] = resolve_evidence([{"segment_id": 99, "quote": "anything"}], _segments())
    assert ev["verified"] is False
    assert ev["start"] is None


def test_quote_cited_one_segment_off_still_verifies():
    [ev] = resolve_evidence(
        [{"segment_id": 2, "quote": "this is Michelle"}], _segments()
    )
    assert ev["verified"] is True


def test_merge_joins_same_speaker_turns_only():
    segs = [
        Segment(0, 0.0, 1.0, "Hello,", "0"),
        Segment(0, 1.2, 2.0, "this is Sam.", "0"),
        Segment(0, 2.5, 3.0, "Hi Sam.", "1"),
        Segment(0, 9.0, 10.0, "Still there?", "1"),
    ]
    merged = merge_adjacent(segs)
    assert [s.text for s in merged] == ["Hello, this is Sam.", "Hi Sam.", "Still there?"]
    assert [s.id for s in merged] == [1, 2, 3]


def test_render_numbers_lines_for_citation():
    text = render(_segments(), by_role=True)
    assert text.splitlines()[0].startswith("[1] 00:00 REP: ")
    assert render(_segments(), by_role=False).splitlines()[1].startswith("[2] 00:03 SPEAKER 1:")


def test_roles_from_speaker_map():
    segs = _segments()
    for s in segs:
        s.role = "unknown"
    analyze.assign_roles(
        segs,
        {"speaker_roles": [{"speaker": "0", "role": "rep"}, {"speaker": "1", "role": "customer"}]},
        diarized=True,
    )
    assert [s.role for s in segs] == [REP, CUSTOMER, REP]


def test_roles_from_segment_ids_when_not_diarized():
    segs = _segments()
    analyze.assign_roles(segs, {"rep_segment_ids": [1, 3]}, diarized=False)
    assert [s.role for s in segs] == [REP, CUSTOMER, REP]


# --- Transcription parsing -----------------------------------------------------


def test_deepgram_diarized_utterances():
    data = {"results": {"utterances": [
        {"start": 4.0, "end": 5.0, "transcript": "Hi there.", "speaker": 1, "channel": 0},
        {"start": 0.1, "end": 3.0, "transcript": "Summit Pest, this is Jo.", "speaker": 0,
         "channel": 0},
        {"start": 6.0, "end": 6.5, "transcript": "  ", "speaker": 1, "channel": 0},
    ]}}
    segs = parse_deepgram(data, multichannel=False)
    assert [(s.id, s.speaker, s.text) for s in segs] == [
        (1, "0", "Summit Pest, this is Jo."),
        (2, "1", "Hi there."),
    ]


def test_deepgram_multichannel_uses_channel_as_speaker():
    data = {"results": {"utterances": [
        {"start": 0.0, "end": 1.0, "transcript": "Hello.", "speaker": 0, "channel": 1},
    ]}}
    [seg] = parse_deepgram(data, multichannel=True)
    assert seg.speaker == "ch1"


# --- Schemas -------------------------------------------------------------------


def _check_strict(schema: dict[str, Any], path: str = "$") -> None:
    """Structured outputs require every object to be closed and fully required."""
    if schema.get("type") == "object":
        assert schema.get("additionalProperties") is False, path
        assert set(schema.get("required", [])) == set(schema["properties"]), path
        for key, sub in schema["properties"].items():
            _check_strict(sub, f"{path}.{key}")
    if schema.get("type") == "array":
        _check_strict(schema["items"], f"{path}[]")


def test_triage_schema_is_strict():
    _check_strict(analyze.TRIAGE_SCHEMA)


@pytest.mark.parametrize("scorecard", list(rubrics.SCORECARDS.values()))
def test_scoring_schema_is_strict_and_limited_to_scorecard_keys(scorecard):
    schema = analyze._scoring_schema(scorecard)
    _check_strict(schema)
    keys = schema["properties"]["items"]["items"]["properties"]["key"]["enum"]
    assert keys == [i.key for i in scorecard.items]


def test_outcome_follows_the_lens():
    triage = {"sales": {"outcome": "sold"}, "retention": {"outcome": "saved"},
              "service": {"resolution": "resolved"}}
    assert analyze.outcome_for(CallType.SALES, triage) == "sold"
    assert analyze.outcome_for(CallType.RETENTION, triage) == "saved"
    assert analyze.outcome_for(CallType.BILLING, triage) == "resolved"
    assert analyze.outcome_for(CallType.NOT_SCORABLE, triage) is None


# --- Ingest --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "ref"),
    [("CALL 014.mp3", "CALL-014"), ("call_7.wav", "CALL-7"), ("my recording.mp3", None)],
)
def test_external_ref_from_filename(name, ref):
    assert external_ref(name) == ref
