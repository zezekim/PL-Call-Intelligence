"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api, type Analysis, type CallDetail, type ScoreItem } from "@/lib/api";
import {
  CALL_TYPES,
  OUTCOME_TONE,
  clock,
  dateTime,
} from "@/lib/format";
import { IN_PROGRESS, useApi, useTitle } from "@/lib/hooks";
import { CALL_TYPE_PLAIN, GRADE_PLAIN, OUTCOME_PLAIN, spokenMinutes, stepName } from "@/lib/easy";
import { FollowUpList } from "@/components/follow-up-list";
import { AlertIcon, BackIcon, CheckIcon, ChevronIcon, CrossIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { CallButton, personLabel, repWords } from "@/components/v2/customer";
import { Avatar, Card, ErrorNote, Modal, Spinner } from "@/components/ui";
import { ListenPanel, type AudioControl, type Marker, useAudio } from "@/components/v2/listen";
import { TranscriptEditor } from "@/components/v2/transcript-editor";
import { CallSkeleton, MoreMenu, MoreToggle, PageError, StatusPill } from "@/components/v2/kit";
import { failMessage, useToast } from "@/components/v2/toast";
import type { Status } from "@/lib/v2";
import { cleanPests, firstSentence, listWords, personName } from "@/lib/v2";

export default function CallRoute() {
  return (
    <Suspense fallback={<CallSkeleton />}>
      <CallPage />
    </Suspense>
  );
}

const GRADE_STATUS: Record<string, Status> = { gold: "good", green: "good", below: "bad" };
const OUTCOME_STATUS: Record<string, Status> = { good: "good", warn: "watch", bad: "bad", none: "none" };

function CallPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { data: call, error, status, loading, reload, setData } = useApi<CallDetail>(`/intel/calls/${id}`, {
    poll: (c) => IN_PROGRESS.has(c.processing_status),
  });
  const [fixing, setFixing] = useState(false);
  const [chosen, setChosen] = useState<Tab | null>(null);
  useTitle(call ? `Call with ${personName(call.analysis?.customer_name) ?? "a customer"}` : "Call");
  const audio = useAudio();

  // A link to a moment (?t=seconds) opens the call ready at that moment.
  const startAt = Number(params.get("t"));
  useEffect(() => {
    if (!call || !Number.isFinite(startAt) || startAt <= 0) return;
    const seg = [...call.segments].reverse().find((s) => s.start <= startAt + 0.5);
    audio.setTime(startAt);
    const el = audio.ref.current;
    if (el) el.currentTime = startAt;
    if (seg) audio.seek(startAt, seg.id);
    // Only when the call first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.id]);

  if (loading && !call) return <CallSkeleton />;
  if (error && !call) {
    return <PageError status={status} thing="call" onRetry={() => void reload()} back={{ href: "/v2/calls", label: "Back to all calls" }} />;
  }
  if (!call) return null;

  const a = call.analysis;
  const processing = IN_PROGRESS.has(call.processing_status);
  const expired = !call.audio_url && !!call.recording_expires_at && new Date(call.recording_expires_at) < new Date();
  const markers: Marker[] = [
    ...(a?.coaching.coaching ?? [])
      .filter((t) => t.start !== null)
      .map((t) => ({ at: t.start as number, tone: "bad" as const, label: t.title })),
    ...(a?.coaching.strengths ?? [])
      .filter((s) => s.start !== null)
      .map((s) => ({ at: s.start as number, tone: "good" as const, label: s.title })),
  ];

  const hasTips = !!a && (a.coaching.coaching ?? []).length > 0;
  const tabs: { value: Tab; label: string }[] = [
    ...(hasTips ? [{ value: "learn" as const, label: "How to do better" }] : []),
    { value: "listen", label: "Listen and read" },
    ...(a && a.items.length ? [{ value: "steps" as const, label: "Every step" }] : []),
    ...(call.follow_ups.length ? [{ value: "promises" as const, label: `What we promised (${call.follow_ups.length})` }] : []),
    ...(a ? [{ value: "details" as const, label: "Details" }] : []),
  ];
  // A link to a moment opens the words; otherwise what to learn comes first.
  const fallback: Tab = startAt > 0 || !hasTips ? "listen" : "learn";
  const tab: Tab = chosen && tabs.some((t) => t.value === chosen) ? chosen : fallback;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/v2/calls" className="-ml-1 inline-flex min-h-[44px] items-center gap-0.5 text-[16px] text-link hover:underline">
          <BackIcon className="h-4 w-4" /> Back to all calls
        </Link>
        <CallActions call={call} onChanged={reload} />
      </div>

      <Verdict call={call} audio={audio} onListen={() => setChosen("listen")} />

      {processing && (
        <Card className="flex items-center gap-3 px-5 py-4">
          <Spinner className="h-4 w-4" />
          <p className="text-[16px]">We are still listening to this call. This page will update by itself.</p>
        </Card>
      )}
      {call.processing_status === "failed" && (
        <Card className="space-y-3 p-5">
          <ErrorNote message={call.processing_error ?? "We could not read this recording."} />
          <Rerun callId={call.id} transcript={call.segments.length ? "keep" : "redo"} onDone={reload} />
        </Card>
      )}
      {call.transcript_stale && !processing && (
        <StaleGrade callId={call.id} onDone={async () => {
          setFixing(false);
          await reload();
        }} />
      )}
      {a && a.call_type_confidence < 0.7 && !call.call_type_overridden && (
        <TypeCheck call={call} analysis={a} onDone={reload} />
      )}

      {/* One part of the call at a time, picked with big buttons. The player
          stays mounted on every tab, so a call keeps playing while you read. */}
      <CallTabs
        tabs={tabs}
        value={tab}
        onChange={setChosen}
      />
      {audio.playing && tab !== "listen" && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-accent-soft/70 px-4 py-2.5 print:hidden" aria-live="polite">
          <span className="text-[17px] font-medium">Playing {clock(audio.time)}</span>
          <button className="btn-secondary min-h-[44px]" onClick={audio.toggle}>
            <PauseIcon className="h-4 w-4" />
            Pause
          </button>
          <button className="min-h-[44px] text-[16px] font-medium text-link" onClick={() => setChosen("listen")}>
            Show the words
          </button>
        </div>
      )}

      <div className={tab === "listen" ? "" : "hidden print:block"}>
        <ListenPanel
          src={call.audio_url ? api.url(call.audio_url) : null}
          duration={call.duration_seconds}
          segments={call.segments}
          repName={call.rep_name}
          customerName={personName(call.analysis?.customer_name)}
          audio={audio}
          markers={markers}
          expired={expired}
          fixing={fixing}
          onFix={processing ? undefined : setFixing}
          fixer={
            <TranscriptEditor
              callId={call.id}
              segments={call.segments}
              repName={call.rep_name}
              customerName={personName(call.analysis?.customer_name)}
              audio={audio}
              onSaved={setData}
            />
          }
        />
      </div>
      {tab === "learn" && a && <Coaching analysis={a} audio={audio} />}
      {tab === "steps" && a && <Scorecard analysis={a} audio={audio} callId={call.id} onChange={reload} />}
      {tab === "promises" && (
        <Card className="p-5">
          <h2 className="mb-3 text-[18px] font-semibold tracking-title">Things we promised</h2>
          <FollowUpList items={call.follow_ups} />
        </Card>
      )}
      {tab === "details" && a && <Details analysis={a} />}
    </div>
  );
}

type Tab = "learn" | "listen" | "steps" | "promises" | "details";

/** Big, plain tab buttons: one part of the call at a time. */
function CallTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: Tab; label: string }[];
  value: Tab;
  onChange: (t: Tab) => void;
}) {
  if (tabs.length < 2) return null;
  return (
    <div role="tablist" aria-label="Parts of the call" className="flex flex-wrap gap-2 print:hidden">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={`min-h-[48px] rounded-2xl border px-4 text-[17px] font-semibold transition-colors ${
            t.value === value ? "border-accent bg-accent text-white" : "border-control bg-surface text-ink hover:bg-surface-hover"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// --- The verdict: what happened, and how it went -----------------------------------

function Verdict({ call, audio, onListen }: { call: CallDetail; audio: AudioControl; onListen: () => void }) {
  const a = call.analysis;
  const title = `Call with ${personName(a?.customer_name) ?? "a customer"}`;
  const outcomeTone = call.outcome ? OUTCOME_TONE[call.outcome] ?? "none" : "none";
  const best = a?.coaching.strengths?.[0];
  const fix = a?.coaching.coaching?.[0];
  const needed = a?.score_max && a.grade === "below" ? greenAt(a) : null;
  const who = call.rep_name ? repWords(call.rep_name) : "they";

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[15px]">
            <span className="font-medium">{CALL_TYPE_PLAIN[call.call_type ?? ""] ?? "Call"}</span>
            {call.outcome && call.outcome !== "not_applicable" && (
              <StatusPill status={OUTCOME_STATUS[outcomeTone]} label={OUTCOME_PLAIN[call.outcome] ?? call.outcome} />
            )}
          </div>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-title">{title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] text-muted">
            {call.rep_name && (
              <span className="inline-flex items-center gap-1.5 text-ink">
                <Avatar name={call.rep_name} size={20} />
                {personLabel(call.rep_name)} took this call
              </span>
            )}
            <span>{dateTime(call.occurred_at ?? call.created_at)}</span>
            {spokenMinutes(call.duration_seconds) && <span>{spokenMinutes(call.duration_seconds)}</span>}
          </p>
          {a?.summary && <Summary text={a.summary} />}
        </div>

        {a?.score_max ? (
          <div className="flex shrink-0 flex-wrap items-center gap-3 sm:block sm:text-right">
            <p className="text-[16px] font-medium text-ink/80">How {who} did</p>
            <div className="flex sm:mt-1.5 sm:justify-end">
              <StatusPill status={GRADE_STATUS[a.grade ?? ""] ?? "none"} label={a.grade ? GRADE_PLAIN[a.grade] : "Not checked"} />
            </div>
            <p className="text-[15px] text-muted sm:mt-1.5">
              {needed ? `${needed} more step${needed === 1 ? "" : "s"} to be good` : "call steps done"}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2 print:hidden">
        {call.audio_url && (
          <button
            className="btn-primary min-h-[52px] rounded-2xl px-5 text-[18px]"
            onClick={() => {
              onListen();
              audio.toggle();
            }}
          >
            {audio.playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
            {audio.playing ? "Pause" : "Play the call"}
          </button>
        )}
        {call.customer_phone && (
          <CallButton phone={call.customer_phone} pretty={call.customer_phone_pretty} name={personName(a?.customer_name)} />
        )}
      </div>

      {(best || fix) && (
        <div className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-2 sm:gap-y-0">
          {best && (
            <Moment tone="good" label={`What ${who} did well`} title={best.title} at={best.start} seg={best.segment_id} audio={audio} />
          )}
          {fix && (
            <Moment tone="bad" label={`What ${who} should do next time`} title={fix.title} at={fix.start} seg={fix.segment_id} audio={audio} />
          )}
        </div>
      )}
    </Card>
  );
}

/** One sentence says what happened; the full account is one tap away. */
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { first, more } = firstSentence(text);
  return (
    <p className="mt-4 max-w-3xl text-[17px] leading-relaxed">
      {open || !more ? text : first}
      {more && (
        <button className="ml-1.5 text-[16px] font-medium text-link hover:underline print:hidden" onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"}
        </button>
      )}
    </p>
  );
}

/** Everything you might do to a call, folded into one ••• menu. */
function CallActions({ call, onChanged }: { call: CallDetail; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const toast = useToast();
  const [typeOpen, setTypeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = IN_PROGRESS.has(call.processing_status);
  const a = call.analysis;

  async function checkAgain() {
    try {
      await api.post(`/intel/calls/${call.id}/reprocess`, { transcript: "keep" });
      toast({ message: "Checking this call again. It takes about a minute." });
      await onChanged();
    } catch {
      toast({ message: failMessage(), tone: "error" });
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/intel/calls/${call.id}`);
      toast({ message: "Call deleted" });
      router.replace("/v2/calls");
    } catch {
      setBusy(false);
      setConfirmDelete(false);
      toast({ message: failMessage(), tone: "error" });
    }
  }

  return (
    <>
      <MoreMenu
        label="Call actions"
        items={[
          { label: "Check this call again", onSelect: () => void checkAgain(), disabled: !a || working },
          { label: "Change the kind of call", onSelect: () => setTypeOpen(true), disabled: !a || working },
          { label: "Print", onSelect: () => window.print(), disabled: !a },
          { label: "Delete call…", onSelect: () => setConfirmDelete(true), danger: true, separated: true },
        ]}
      />
      <TypeDialog call={call} open={typeOpen} onClose={() => setTypeOpen(false)} onDone={onChanged} />
      <Modal open={confirmDelete} onClose={() => !busy && setConfirmDelete(false)} title="Delete this call?">
        <p className="text-[16px] text-muted">The recording and everything we wrote about it will be gone for good.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn bg-bad text-white hover:opacity-90" disabled={busy} onClick={() => void remove()}>
            {busy && <Spinner className="h-3.5 w-3.5" />}
            Delete
          </button>
        </div>
      </Modal>
    </>
  );
}

/** Steps short of Green on this call's scorecard, from its own cut-off. */
function greenAt(a: Analysis): number | null {
  if (!a.green_at || a.score === null) return null;
  return Math.max(0, a.green_at - a.score);
}

function Moment({
  tone,
  label,
  title,
  at,
  seg,
  audio,
}: {
  tone: "good" | "bad";
  label: string;
  title: string;
  at: number | null;
  seg: number;
  audio: AudioControl;
}) {
  const Icon = tone === "good" ? CheckIcon : CrossIcon;
  return (
    // Label, title and link sit on shared rows (subgrid), so the two cards
    // line up side by side even when one title wraps.
    <button
      className={`group grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 rounded-2xl px-4 py-3 text-left transition-colors sm:row-span-3 sm:grid-rows-subgrid sm:gap-y-0 ${
        tone === "good" ? "bg-good-soft hover:brightness-[0.98]" : "bg-bad-soft hover:brightness-[0.98]"
      }`}
      onClick={() => at !== null && audio.seek(at, seg)}
      disabled={at === null}
    >
      <span
        className={`row-span-3 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-white ${
          tone === "good" ? "bg-good" : "bg-bad"
        }`}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className={`block text-[15px] font-semibold ${tone === "good" ? "text-good" : "text-bad"}`}>{label}</span>
      <span className="block text-[16px] font-medium leading-snug">{title}</span>
      {at !== null ? (
        <span className="mt-1 inline-flex items-center gap-1 self-end text-[15px] text-link group-hover:underline">
          <PlayIcon className="h-2.5 w-2.5" /> Hear that part
        </span>
      ) : (
        <span aria-hidden />
      )}
    </button>
  );
}

// --- Coaching ------------------------------------------------------------------------

function Coaching({ analysis: a, audio }: { analysis: Analysis; audio: AudioControl }) {
  const tips = a.coaching.coaching ?? [];
  const [all, setAll] = useState(false);
  const shown = all ? tips : tips.slice(0, 1);
  return (
    <Card className="p-5">
      <h2 className="text-[18px] font-semibold tracking-title">How {a.rep_name ? repWords(a.rep_name) : "they"} can do better</h2>
      <ol className="mt-4 space-y-4">
        {shown.map((tip, i) => (
          <li key={i} className={i ? "border-t border-line pt-4" : ""}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-[16px] font-semibold leading-snug tracking-tightish">
                {tips.length > 1 && `${i + 1}. `}
                {tip.title}
              </p>
              {tip.start !== null && (
                <button
                  onClick={() => audio.seek(tip.start as number, tip.segment_id)}
                  className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3.5 text-[16px] font-medium text-link hover:underline"
                >
                  <PlayIcon className="h-2.5 w-2.5" />
                  Hear it
                </button>
              )}
            </div>
            <p className="mt-1 text-[16px] leading-relaxed text-ink/80">{tip.what_happened}</p>
            <div className="mt-2.5 rounded-xl bg-panel px-4 py-3">
              <p className="text-[16px] font-semibold">Say this instead:</p>
              <p className="mt-0.5 text-[16px] leading-relaxed [overflow-wrap:anywhere]">{tip.try_saying}</p>
            </div>
          </li>
        ))}
      </ol>
      {tips.length > 1 && (
        <MoreToggle className="mt-4" open={all} onToggle={() => setAll((x) => !x)} count={tips.length - 1} noun={tips.length === 2 ? "tip" : "tips"} />
      )}
    </Card>
  );
}

// --- Scorecard: what was missed first, what was done folded away -------------------

function Scorecard({
  analysis: a,
  audio,
  callId,
  onChange,
}: {
  analysis: Analysis;
  audio: AudioControl;
  callId: string;
  onChange: () => Promise<void>;
}) {
  const [showDone, setShowDone] = useState(false);
  const missed = a.items.filter((i) => !i.awarded);
  const done = a.items.filter((i) => i.awarded);
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-semibold tracking-title">The call steps</h2>
        <span className="tnum text-[16px] text-muted">
          {a.score} of {a.score_max} done
        </span>
      </div>

      {missed.length > 0 && (
        <>
          <p className="mt-4 text-[15px] font-semibold text-bad">Skipped ({missed.length})</p>
          <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-xl bg-panel">
            {missed.map((item) => (
              <Step key={item.key} item={item} audio={audio} callId={callId} onChange={onChange} />
            ))}
          </ul>
        </>
      )}

      {done.length > 0 && (
      <button
        className="mt-4 flex w-full items-center justify-between text-left text-[15px] font-semibold text-good"
        onClick={() => setShowDone((s) => !s)}
        aria-expanded={showDone}
      >
        {showDone ? `Done (${done.length})` : `Show the ${done.length} step${done.length === 1 ? "" : "s"} done`}
        <ChevronIcon className={`h-4 w-4 text-faint transition-transform ${showDone ? "rotate-90" : ""}`} />
      </button>
      )}
      {showDone && (
        <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-xl bg-panel">
          {done.map((item) => (
            <Step key={item.key} item={item} audio={audio} callId={callId} onChange={onChange} />
          ))}
        </ul>
      )}
      {a.evidence_verified_pct !== null && (
        <p className="mt-4 text-[15px] text-muted">
          Tap a step to see why. Each one is backed by words from the call.
        </p>
      )}
    </Card>
  );
}

function Step({
  item,
  audio,
  callId,
  onChange,
}: {
  item: ScoreItem;
  audio: AudioControl;
  callId: string;
  onChange: () => Promise<void>;
}) {
  // One line per step; the reason and the moment open on tap. Steps that need
  // the owner's decision start open, since they ask for something.
  const [open, setOpen] = useState(item.agreement === "disputed" && !item.override);
  const evidence = item.evidence.find((e) => e.start !== null);
  return (
    <li>
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-ink/[0.02]"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-white ${
            item.awarded ? "bg-good" : "bg-bad"
          }`}
        >
          {item.awarded ? <CheckIcon className="h-3 w-3" /> : <CrossIcon className="h-2.5 w-2.5" />}
        </span>
        <span className="flex-1 text-[16px]">{stepName(item.key, item.label)}</span>
        {item.override && <span className="text-[15px] text-muted">You changed this</span>}
        {item.agreement === "disputed" && !item.override && (
          <span className="chip bg-warn-soft text-warn" title="We were not sure. Please decide.">
            Please decide
          </span>
        )}
        <ChevronIcon className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2.5 px-3 pb-3.5 pl-[38px] text-[16px]">
          <p className="leading-relaxed text-ink/80">{item.reason}</p>
          {(item.rules ?? []).map((r) => (
            <p key={r} className="rounded-xl bg-accent-soft/60 px-3 py-2 text-[15px] leading-snug">
              <span className="font-medium">Your rule:</span> {r}{" "}
              <Link href="/settings#scoring-rules" className="whitespace-nowrap text-link hover:underline">
                Change
              </Link>
            </p>
          ))}
          {evidence && (
            <button
              onClick={() => audio.seek(evidence.start as number, evidence.segment_id)}
              className="block w-full rounded-xl bg-surface px-3 py-2 text-left transition-colors [overflow-wrap:anywhere] hover:bg-accent-soft"
            >
              <span className="text-[15px]">“{evidence.quote}”</span>
              <span className="mt-0.5 flex items-center gap-1 text-[15px] text-link">
                <PlayIcon className="h-2.5 w-2.5" /> Hear it ({clock(evidence.start)})
              </span>
            </button>
          )}
          <Override item={item} callId={callId} onChange={onChange} />
        </div>
      )}
    </li>
  );
}

function Override({ item, callId, onChange }: { item: ScoreItem; callId: string; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [keep, setKeep] = useState(false);
  const [rule, setRule] = useState("");
  async function save(status: "met" | "missed" | null) {
    setBusy(true);
    try {
      const asRule = status !== null && keep && rule.trim() ? rule.trim() : null;
      await api.put(`/intel/calls/${callId}/items/${item.key}/override`, { status, note, rule: asRule });
      setEditing(false);
      setNote("");
      setKeep(false);
      setRule("");
      await onChange();
      toast({
        message:
          status === null
            ? "Change undone"
            : asRule
              ? "Saved. Future calls will be checked your way."
              : `Marked as ${status === "met" ? "done" : "skipped"}`,
      });
    } catch {
      toast({ message: failMessage(), tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  if (item.override) {
    return (
      <p className="text-[15px] text-muted">
        {item.override.by} marked this as {item.override.status === "met" ? "done" : "skipped"}
        {item.override.note ? `: “${item.override.note}”` : ""}.{" "}
        <button className="text-link hover:underline" disabled={busy} onClick={() => save(null)}>
          Undo
        </button>
      </p>
    );
  }
  const target = item.awarded ? "missed" : "met";
  if (!editing) {
    return (
      <button className="text-[15px] text-link hover:underline" onClick={() => setEditing(true)}>
        Not right? Mark it as {target === "met" ? "done" : "skipped"}
      </button>
    );
  }
  const needsRule = keep && !rule.trim();
  return (
    <div className="space-y-2.5">
      <input
        className="input w-full py-1.5 text-[15px]"
        placeholder="Why? (optional)"
        aria-label="Reason for the change"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
      />
      <label className="flex cursor-pointer items-start gap-2 text-[15px]">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-accent"
          checked={keep}
          onChange={(e) => setKeep(e.target.checked)}
        />
        <span>
          Check future calls this way too
          <span className="block text-[15px] text-muted">So the same thing isn&apos;t marked wrong again.</span>
        </span>
      </label>
      {keep && (
        <textarea
          className="input w-full py-1.5 text-[15px]"
          rows={2}
          placeholder={
            target === "met"
              ? "When does this count as done? e.g. “Thanks for calling” counts as thanking the customer."
              : "When should this not count? e.g. Reading the price off the screen isn't explaining the plan."
          }
          aria-label="Rule for future calls"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          maxLength={300}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary px-3 py-1 text-[15px]" disabled={busy || needsRule} onClick={() => save(target)}>
          {busy && <Spinner className="h-3 w-3" />}
          Mark it as {target === "met" ? "done" : "skipped"}
        </button>
        <button className="btn-ghost px-3 py-1 text-[15px]" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- The facts, compact ---------------------------------------------------------------

function Details({ analysis: a }: { analysis: Analysis }) {
  const t = a.triage;
  const rows = useMemo(() => {
    const out: [string, string][] = [];
    if (a.lens === "sales") {
      if (t.sales.service_discussed) out.push(["What they wanted", t.sales.service_discussed]);
      if (t.sales.price_quoted) out.push(["Price given", t.sales.price_quoted]);
      if (t.sales.objections.length) out.push(["Their worries", t.sales.objections.map((o) => o.objection).join("; ")]);
      if (t.sales.lost_reason) out.push(["Why they didn't say yes", t.sales.lost_reason]);
    }
    if (a.lens === "retention" && t.retention.root_cause) out.push(["Why they want to cancel", t.retention.root_cause]);
    if (a.lens === "service" && t.service.request) out.push(["What they needed", t.service.request]);
    const pests = listWords(cleanPests(t.pests));
    if (pests) out.push(["Pests", pests[0].toUpperCase() + pests.slice(1)]);
    if (t.appointment.booked) out.push(["Visit booked", t.appointment.when || "Yes"]);
    return out;
  }, [a, t]);
  if (!rows.length) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-[18px] font-semibold tracking-title">Details</h2>
      <dl className="space-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 text-[16px]">
            <dt className="text-muted">{k}</dt>
            <dd className="leading-snug [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// --- Actions ----------------------------------------------------------------------------

/** The transcript was fixed after the grade was made: offer to grade it again. */
function StaleGrade({ callId, onDone }: { callId: string; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-accent-soft px-5 py-4 print:hidden">
      <p className="text-[16px]">
        <span className="font-semibold">You fixed the transcript.</span>{" "}
        <span className="text-ink/80">Check the call again so the steps and coaching use your fixes. Your step changes are kept.</span>
      </p>
      <button
        className="btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/intel/calls/${callId}/reprocess`, { transcript: "keep" });
            toast({ message: "Checking this call again. It takes about a minute." });
            await onDone();
          } catch {
            toast({ message: failMessage(), tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner className="h-3.5 w-3.5" />}
        Check again
      </button>
    </div>
  );
}

function Rerun({
  callId,
  transcript,
  onDone,
}: {
  callId: string;
  transcript: "keep" | "redo";
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post(`/intel/calls/${callId}/reprocess`, { transcript });
          await onDone();
        } catch {
          toast({ message: failMessage(), tone: "error" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Spinner className="h-3.5 w-3.5" />}
      Try again
    </button>
  );
}

function TypeDialog({
  call,
  open,
  onClose,
  onDone,
}: {
  call: CallDetail;
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [value, setValue] = useState(call.call_type ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(call.call_type ?? ""), [call.call_type, open]);
  return (
    <Modal open={open} onClose={onClose} title="What kind of call was this?">
      <p className="mb-4 text-[16px] text-muted">We will check the call again using the steps for this kind of call.</p>
      <div className="grid grid-cols-2 gap-2">
        {CALL_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setValue(t.value)}
            className={`rounded-xl border px-3 py-2.5 text-left text-[16px] font-medium transition-colors ${
              value === t.value ? "border-accent bg-accent-soft/50 ring-1 ring-accent" : "border-line hover:bg-panel"
            }`}
          >
            {CALL_TYPE_PLAIN[t.value] ?? t.label}
          </button>
        ))}
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={busy || !value}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.post(`/intel/calls/${call.id}/reprocess`, { transcript: "keep", call_type: value });
              onClose();
              await onDone();
            } catch {
              setError(failMessage());
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner className="h-3.5 w-3.5" />}
          Save and check again
        </button>
      </div>
    </Modal>
  );
}

function TypeCheck({ call, analysis, onDone }: { call: CallDetail; analysis: Analysis; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warn-soft px-5 py-4 print:hidden">
      <div className="flex items-start gap-2.5 text-[16px]">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <p>
          <span className="font-semibold">
            We think this call was: {(CALL_TYPE_PLAIN[analysis.call_type] ?? analysis.call_type_label).toLowerCase()}. Is
            that right?
          </span>{" "}
          <span className="text-ink/80">It changes which steps we check.</span>
        </p>
      </div>
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post(`/intel/calls/${call.id}/reprocess`, { transcript: "keep", call_type: analysis.call_type });
              await onDone();
            } catch {
              toast({ message: failMessage(), tone: "error" });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner className="h-3.5 w-3.5" />}
          Yes
        </button>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          No, change it
        </button>
      </div>
      <TypeDialog call={call} open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </div>
  );
}
