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
    exact_speakers,
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
    assert render(_segments(), by_role=False).splitlines()[1].startswith("[2] 00:03 VOICE 1?:")


def test_only_channel_labels_are_exact():
    segs = _segments()
    assert not exact_speakers(segs)
    for s in segs:
        s.speaker = "ch0" if s.role == REP else "ch1"
    assert exact_speakers(segs)
    assert render(segs, by_role=False).splitlines()[0].startswith("[1] 00:00 SPEAKER ch0:")


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


@pytest.mark.parametrize("label", ["SPEAKER 0", "speaker 0", "0"])
def test_roles_accept_the_label_as_rendered(label):
    segs = _segments()
    analyze.assign_roles(segs, {"speaker_roles": [{"speaker": label, "role": "rep"}]},
                         diarized=True)
    assert segs[0].role == REP


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


def _paragraphs(*paras):
    return {"results": {"channels": [{"alternatives": [{"paragraphs": {"paragraphs": [
        {"speaker": spk, "sentences": [{"text": t, "start": a, "end": b} for t, a, b in sents]}
        for spk, sents in paras
    ]}}]}]}}


def test_deepgram_mono_uses_sentences_with_speaker_labels():
    data = _paragraphs(
        (0, [("Summit Pest, this is Jo.", 0.2, 2.0), ("How can I help?", 2.1, 3.0)]),
        (1, [("I want to cancel.", 3.5, 5.0)]),
    )
    segs = parse_deepgram(data, multichannel=False)
    assert [(s.speaker, s.text) for s in segs] == [
        ("0", "Summit Pest, this is Jo."), ("0", "How can I help?"), ("1", "I want to cancel."),
    ]


def test_deepgram_single_speaker_drops_labels_for_attribution():
    data = _paragraphs((0, [("Summit Pest, this is Jo.", 0.2, 2.0),
                            ("I want to cancel.", 3.5, 5.0)]))
    segs = parse_deepgram(data, multichannel=False)
    assert [s.speaker for s in segs] == ["", ""]


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


# --- Consensus across scoring runs -----------------------------------------------


def _run(statuses: dict[str, str], tag: str) -> dict[str, Any]:
    return {
        "items": [{"key": k, "status": v, "reason": f"{tag}:{k}", "evidence": []}
                  for k, v in statuses.items()],
        "overall_feedback": tag,
    }


def test_consensus_takes_the_majority_and_records_agreement():
    runs = [
        _run({"validate": "met", "close": "missed"}, "a"),
        _run({"validate": "met", "close": "met"}, "b"),
        _run({"validate": "missed", "close": "met"}, "c"),
    ]
    judgements, best = analyze.consensus(runs)
    assert judgements["validate"]["status"] == "met"
    assert judgements["validate"]["agreement"] == "2/3"
    assert judgements["close"]["status"] == "met"
    # Run b matches the majority on every item, so its coaching is used.
    assert best["overall_feedback"] == "b"


def test_consensus_reason_explains_the_majority_verdict():
    runs = [
        _run({"validate": "missed"}, "a"),
        _run({"validate": "met"}, "b"),
        _run({"validate": "met"}, "c"),
    ]
    judgements, _ = analyze.consensus(runs)
    assert judgements["validate"]["reason"] in ("b:validate", "c:validate")


def test_consensus_tie_is_a_miss():
    runs = [_run({"validate": "met"}, "a"), _run({"validate": "missed"}, "b")]
    judgements, _ = analyze.consensus(runs)
    assert judgements["validate"]["status"] == "missed"
    assert judgements["validate"]["agreement"] == "1/2"


def test_unanimous_single_run():
    judgements, _ = analyze.consensus([_run({"validate": "met"}, "a")])
    assert judgements["validate"]["agreement"] == "1/1"


# --- Enhanced scoring --------------------------------------------------------------


def test_verdict_only_schema_is_strict_and_can_be_limited_to_disputed_keys():
    schema = analyze._scoring_schema(SALES, coaching=False, keys=["validate", "close"])
    _check_strict(schema)
    assert set(schema["properties"]) == {"items"}
    assert schema["properties"]["items"]["items"]["properties"]["key"]["enum"] == [
        "validate", "close"]
    full = analyze._scoring_schema(SALES)
    assert {"coaching", "strengths", "overall_feedback"} <= set(full["properties"])


class _FakeLLM:
    """Answers scoring requests per model, recording what it was asked."""

    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    async def analyse_json(self, system, user, schema, *, effort, model=None, **_):
        from callsentry.services.llm import LLMResult

        self.calls.append((model, "Second round" in user))
        round_ = "final" if "Second round" in user else "first"
        items = [{"key": k, "status": v, "reason": f"{model}:{round_}:{k}", "evidence": []}
                 for k, v in self.answers[(model, round_)].items()]
        out = {"items": items}
        if "coaching" in schema["properties"]:
            out.update({"coaching": [], "strengths": [], "overall_feedback": model})
        return out, LLMResult(text="", provider="x", tier="cloud", model=model)


async def test_enhanced_scoring_deliberates_only_on_disagreements(monkeypatch):
    from callsentry.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "call_intel_model", "claude-a")
    monkeypatch.setattr(settings, "enhanced_second_model", "gpt-b")
    card = ALL_CALLS
    base = {i.key: "met" for i in card.items}
    b_first = {**base, "validate": "missed", "summary_statement": "missed"}
    fake = _FakeLLM({
        ("claude-a", "first"): base,
        ("gpt-b", "first"): b_first,
        # Validate: B is persuaded. Summary: both hold their ground.
        ("claude-a", "final"): {"validate": "met", "summary_statement": "met"},
        ("gpt-b", "final"): {"validate": "met", "summary_statement": "missed"},
    })
    monkeypatch.setattr(analyze, "get_llm", lambda: fake)
    result = analyze.Analysis(call_type="scheduling", call_type_confidence=1, lens="service",
                              outcome=None, rep_name=None, customer_name=None, summary="",
                              triage={})
    judgements, coached = await analyze._enhanced(result, "sys", "user", card)

    assert judgements["close"]["agreement"] == "both"
    assert judgements["validate"]["status"] == "met"
    assert judgements["validate"]["agreement"] == "settled"
    # Still split after deliberation: not awarded, and both positions kept.
    assert judgements["summary_statement"]["status"] == "missed"
    assert judgements["summary_statement"]["agreement"] == "disputed"
    assert [p["final"] for p in judgements["summary_statement"]["deliberation"]] == [
        "met", "missed"]
    # Coaching comes from the primary model; second round only for the two disputes.
    assert coached["overall_feedback"] == "claude-a"
    assert sum(1 for _, second in fake.calls if second) == 2
    assert result.models == "claude-a + gpt-b"


async def test_enhanced_scoring_needs_a_second_model(monkeypatch):
    from callsentry.config import get_settings

    monkeypatch.setattr(get_settings(), "enhanced_second_model", "")
    result = analyze.Analysis(call_type="sales", call_type_confidence=1, lens="sales",
                              outcome=None, rep_name=None, customer_name=None, summary="",
                              triage={})
    with pytest.raises(analyze.AnalysisFailed):
        await analyze._enhanced(result, "sys", "user", SALES)


@pytest.mark.parametrize(
    ("model", "keep"),
    [("gpt-5", True), ("gpt-4.1-mini", True), ("o3", True), ("gpt-4o-audio-preview", False),
     ("text-embedding-3-large", False), ("gpt-realtime", False), ("dall-e-3", False),
     ("gpt-4o-transcribe", False), ("gpt-live-1", False)],
)
def test_openai_model_filter(model, keep):
    from callsentry.services.llm import is_openai_text_model

    assert is_openai_text_model(model) is keep


def test_openai_price_uses_longest_prefix_and_safe_fallback():
    from callsentry.services.llm import OPENAI_FALLBACK_PRICE, openai_price, provider_for

    assert openai_price("gpt-5-mini-2026-01-01") == (0.25, 2.00)
    assert openai_price("gpt-5") == (1.25, 10.00)
    assert openai_price("some-future-model") == OPENAI_FALLBACK_PRICE
    assert provider_for("claude-sonnet-5") == "claude"
    assert provider_for("gpt-5") == "openai"
