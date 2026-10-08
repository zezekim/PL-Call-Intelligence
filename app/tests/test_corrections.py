"""A manager's corrections that outlive re-scoring: scoring rules made from a
step correction, and fixes to who said what in the transcript."""

from __future__ import annotations

import pytest

from callsentry.intel import analyze, rules, transcript_edit
from callsentry.intel.rubrics import ALL_CALLS
from callsentry.intel.transcript import (
    CUSTOMER,
    REP,
    Segment,
    exact_speakers,
    resolve_evidence,
)
from callsentry.intel.transcript_edit import EditError


def _segs() -> list[Segment]:
    return [
        Segment(1, 0.0, 4.0, "Thanks for calling Acme, this is Dana.", "0", REP),
        Segment(2, 4.0, 10.0, "Hi, I have ants. Okay, I can help with that.", "1", CUSTOMER),
        Segment(3, 10.0, 12.0, "Great, thank you.", "1", CUSTOMER),
    ]


# --- Transcript fixes -------------------------------------------------------------


def test_text_fix_keeps_the_transcribed_words():
    segs = transcript_edit.set_text(_segs(), 1, "Thanks for calling Acme,  this is Dana!")
    assert segs[0].text == "Thanks for calling Acme, this is Dana!"
    assert segs[0].original_text == "Thanks for calling Acme, this is Dana."
    # Putting the words back clears the edit.
    transcript_edit.set_text(segs, 1, "Thanks for calling Acme, this is Dana.")
    assert segs[0].original_text is None


def test_split_gives_the_rest_of_the_line_to_the_other_person():
    segs = _segs()
    at = segs[1].text.index("Okay")
    segs = transcript_edit.split(segs, 2, at, REP)
    assert [s.text for s in segs] == [
        "Thanks for calling Acme, this is Dana.",
        "Hi, I have ants.",
        "Okay, I can help with that.",
        "Great, thank you.",
    ]
    new = segs[2]
    assert new.id == 4 and new.role == REP and new.manual_role == REP
    # The new line starts inside the old one, and the old one ends there.
    assert 4.0 < new.start < 10.0 and segs[1].end == new.start
    assert segs[1].original_text == "Hi, I have ants. Okay, I can help with that."


@pytest.mark.parametrize("at", [0, 999])
def test_split_must_fall_inside_the_line(at):
    with pytest.raises(EditError):
        transcript_edit.split(_segs(), 2, at, REP)


def test_inserted_line_sorts_by_time_and_only_it_can_be_deleted():
    segs = transcript_edit.insert(_segs(), 9.0, REP, "Anything else?")
    assert [s.id for s in segs] == [1, 2, 4, 3]
    assert segs[2].added
    with pytest.raises(EditError):
        transcript_edit.delete(segs, 1)
    assert [s.id for s in transcript_edit.delete(segs, 4)] == [1, 2, 3]


def test_bad_edits_are_refused():
    with pytest.raises(EditError):
        transcript_edit.set_role(_segs(), 1, "manager")
    with pytest.raises(EditError):
        transcript_edit.set_text(_segs(), 99, "x")
    with pytest.raises(EditError):
        transcript_edit.set_text(_segs(), 1, "   ")


def test_unedited_lines_store_as_before_and_edits_round_trip():
    seg = _segs()[0]
    assert set(seg.to_dict()) == {"id", "start", "end", "text", "speaker", "role"}
    transcript_edit.set_role([seg], 1, CUSTOMER)
    again = Segment.from_dict(seg.to_dict())
    assert again.manual_role == CUSTOMER


def test_evidence_neighbours_follow_position_after_ids_stop_being_consecutive():
    segs = transcript_edit.split(_segs(), 2, _segs()[1].text.index("Okay"), REP)
    # Cite the shortened line 2 with words that moved to the new line 4.
    ev = resolve_evidence([{"segment_id": 2, "quote": "Okay, I can help with that"}], segs)
    assert ev[0]["verified"]


def test_an_added_line_does_not_make_channel_labels_inexact():
    segs = [Segment(1, 0, 1, "a", "ch0"), Segment(2, 1, 2, "b", "ch1")]
    segs = transcript_edit.insert(segs, 3, REP, "c")
    assert exact_speakers(segs)


# --- Scoring with rules and manual speakers ----------------------------------------


class _ScriptedLLM:
    """Triage answers with a scheduling call; scoring marks every step met."""

    def __init__(self, rep_ids):
        self.rep_ids = rep_ids
        self.systems: list[str] = []

    async def analyse_json(self, system, user, schema, *, effort, model=None, **_):
        from callsentry.services.llm import LLMResult

        self.systems.append(system)
        if "call_type" in schema["properties"]:
            out = {"call_type": "scheduling", "call_type_confidence": 0.9, "summary": "s",
                   "rep_name": "Dana", "not_scorable_reason": "none",
                   "rep_segment_ids": self.rep_ids, "speaker_roles": []}
        else:
            out = {"items": [{"key": i.key, "status": "met", "reason": "", "evidence": []}
                             for i in ALL_CALLS.items],
                   "coaching": [], "strengths": [], "overall_feedback": ""}
        return out, LLMResult(text="", provider="x", tier="cloud", model="m")


async def test_rules_reach_the_grader_and_are_shown_on_their_step(monkeypatch):
    from callsentry.config import get_settings

    monkeypatch.setattr(get_settings(), "intel_scoring_runs", 1)
    fake = _ScriptedLLM(rep_ids=[1])
    monkeypatch.setattr(analyze, "get_llm", lambda: fake)
    step = ALL_CALLS.items[0].key
    rule_set = {
        ALL_CALLS.key: [
            rules.Rule("r1", step, "A friendly hello counts here."),
            # A step this scorecard doesn't have is left out.
            rules.Rule("r2", "no_such_step", "ignored"),
        ],
        "sales": [rules.Rule("r3", step, "only for sales")],
    }
    result = await analyze.analyse(_segs(), diarized=False, rules=rule_set)

    scoring_system = fake.systems[-1]
    assert "This company's own rules" in scoring_system
    assert "A friendly hello counts here." in scoring_system
    assert "ignored" not in scoring_system and "only for sales" not in scoring_system
    assert result.triage["rules_applied"] == ["r1"]
    by_key = {i["key"]: i for i in result.items}
    assert by_key[step]["rules"] == ["A friendly hello counts here."]
    assert by_key[ALL_CALLS.items[1].key]["rules"] == []


async def test_no_rules_leaves_the_prompt_alone(monkeypatch):
    from callsentry.config import get_settings

    monkeypatch.setattr(get_settings(), "intel_scoring_runs", 1)
    fake = _ScriptedLLM(rep_ids=[1])
    monkeypatch.setattr(analyze, "get_llm", lambda: fake)
    await analyze.analyse(_segs(), diarized=False)
    assert "own rules" not in fake.systems[-1]


async def test_manager_speaker_fix_outlasts_rescoring(monkeypatch):
    from callsentry.config import get_settings

    monkeypatch.setattr(get_settings(), "intel_scoring_runs", 1)
    # The model still thinks only line 1 is the rep.
    monkeypatch.setattr(analyze, "get_llm", lambda: _ScriptedLLM(rep_ids=[1]))
    segs = transcript_edit.split(_segs(), 2, _segs()[1].text.index("Okay"), REP)
    await analyze.analyse(segs, diarized=False)
    assert [s.role for s in segs] == [REP, CUSTOMER, REP, CUSTOMER]
