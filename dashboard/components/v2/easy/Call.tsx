"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, type Analysis, type CallDetail, type FollowUp, type ScoreItem } from "@/lib/api";
import {
  CALL_TYPE_PLAIN,
  GRADE_PLAIN,
  OUTCOME_PLAIN,
  OUTCOME_STATUS,
  plural,
  spokenLength,
  stepMeaning,
  stepName,
} from "@/lib/easy";
import { CALL_TYPES, clock, dateTime } from "@/lib/format";
import { IN_PROGRESS, useApi, useTitle } from "@/lib/hooks";
import { ErrorNote, Loading, Modal, Spinner } from "@/components/ui";
import { ListenPanel, type AudioControl, type Marker, useAudio } from "@/components/v2/compact/listen";
import { BigLink, Panel, Reveal, Section, StatusBadge, StatusIcon, bigButton } from "@/components/v2/kit";

export function CallEasy() {
  return (
    <Suspense fallback={<Loading />}>
      <CallPage />
    </Suspense>
  );
}

function CallPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { data: call, error, loading, reload } = useApi<CallDetail>(`/intel/calls/${id}`, {
    poll: (c) => IN_PROGRESS.has(c.processing_status),
  });
  const name = call?.analysis?.customer_name ?? null;
  useTitle(call ? `Call with ${name ?? "a customer"}` : null);
  const audio = useAudio();

  // A link to a moment (?t=seconds) opens the call ready at that moment.
  const startAt = Number(params.get("t"));
  useEffect(() => {
    if (!call || !Number.isFinite(startAt) || startAt <= 0) return;
    const seg = [...call.segments].reverse().find((s) => s.start <= startAt + 0.5);
    audio.setTime(startAt);
    if (audio.ref.current) audio.ref.current.currentTime = startAt;
    if (seg) audio.seek(startAt, seg.id);
    // Only when the call first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.id]);

  if (loading && !call) return <Loading />;
  if (error && !call) return <ErrorNote message={error} />;
  if (!call) return null;

  const a = call.analysis;
  const processing = IN_PROGRESS.has(call.processing_status);
  const expired = !call.audio_url && !!call.recording_expires_at && new Date(call.recording_expires_at) < new Date();
  const markers: Marker[] = [
    ...(a?.coaching.coaching ?? [])
      .filter((t) => t.start !== null)
      .map((t) => ({ at: t.start as number, tone: "bad" as const, label: t.title, segmentId: t.segment_id })),
    ...(a?.coaching.strengths ?? [])
      .filter((s) => s.start !== null)
      .map((s) => ({ at: s.start as number, tone: "good" as const, label: s.title, segmentId: s.segment_id })),
  ];

  return (
    <div className="space-y-12">
      <BigLink href="/v2/calls" kind="secondary">
        ← Back to all calls
      </BigLink>

      <Summary call={call} />

      {processing && (
        <Panel className="flex items-center gap-4">
          <Spinner className="h-6 w-6" />
          <p className="text-[22px] font-semibold">We are still listening to this call. This page will update by itself.</p>
        </Panel>
      )}
      {call.processing_status === "failed" && (
        <Panel className="space-y-4">
          <p className="flex items-center gap-3 text-[22px] font-semibold">
            <StatusIcon status="bad" size={28} /> We could not read this recording.
          </p>
          <p className="text-[18px] text-ink/80">{call.processing_error}</p>
          <Recheck callId={call.id} label="Try again" transcript={call.segments.length ? "keep" : "redo"} onDone={reload} />
        </Panel>
      )}
      {a && a.call_type_confidence < 0.7 && !call.call_type_overridden && (
        <TypeCheck call={call} analysis={a} onDone={reload} />
      )}

      <ListenPanel
        src={call.audio_url ? api.url(call.audio_url) : null}
        duration={call.duration_seconds}
        segments={call.segments}
        repName={call.rep_name}
        customerName={name}
        audio={audio}
        markers={markers}
        expired={expired}
        large
      />

      {a && (a.coaching.coaching ?? []).length > 0 && <Coaching analysis={a} audio={audio} />}
      {a && a.items.length > 0 && <Checklist analysis={a} audio={audio} callId={call.id} onChange={reload} />}
      {call.follow_ups.length > 0 && <Promises items={call.follow_ups} />}
      <MoreOptions call={call} onChanged={reload} />
    </div>
  );
}

// --- Who, what, and how it went ---------------------------------------------------

function Summary({ call }: { call: CallDetail }) {
  const a = call.analysis;
  const name = a?.customer_name;
  const type = CALL_TYPE_PLAIN[call.call_type ?? ""] ?? "a call";
  const outcome = call.outcome && OUTCOME_PLAIN[call.outcome];
  return (
    <header>
      <h1 className="text-[40px] font-bold leading-tight tracking-title">
        Call with {name ?? "a customer"}
      </h1>
      <p className="mt-3 max-w-3xl text-[22px] leading-relaxed">
        {name ?? "The customer"} called about: <span className="font-semibold">{type.toLowerCase()}</span>.
        {call.rep_name && (
          <>
            {" "}
            Answered by <span className="font-semibold">{call.rep_name}</span>
          </>
        )}{" "}
        on {dateTime(call.occurred_at ?? call.created_at)}. The call lasted {spokenLength(call.duration_seconds)}.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {outcome && <StatusBadge large status={OUTCOME_STATUS[call.outcome!] ?? "none"} label={`Result: ${outcome}`} />}
        {a?.grade && (
          <StatusBadge
            large
            status={a.grade === "below" ? "bad" : "good"}
            label={`Call steps: ${GRADE_PLAIN[a.grade].toLowerCase()} (${a.score} of ${a.score_max} done)`}
          />
        )}
      </div>
      {a?.summary && (
        <Panel className="mt-6">
          <h2 className="text-[22px] font-bold">What happened</h2>
          <p className="mt-2 text-[20px] leading-relaxed">{a.summary}</p>
        </Panel>
      )}
    </header>
  );
}

// --- What to learn from it --------------------------------------------------------------

function Coaching({ analysis: a, audio }: { analysis: Analysis; audio: AudioControl }) {
  const strengths = a.coaching.strengths ?? [];
  const tips = a.coaching.coaching ?? [];
  return (
    <Section title={`What ${a.rep_name ?? "the team member"} can learn`}>
      <div className="space-y-4">
        {strengths.slice(0, 1).map((s, i) => (
          <Panel key={`s${i}`} className="bg-good-soft">
            <p className="flex items-center gap-3 text-[18px] font-semibold">
              <StatusIcon status="good" size={24} /> Done well
            </p>
            <p className="mt-2 text-[22px] font-bold">{s.title}</p>
            <p className="mt-1 text-[19px] leading-relaxed">{s.detail}</p>
            {s.start !== null && (
              <button className={`${bigButton.secondary} mt-4`} onClick={() => audio.seek(s.start as number, s.segment_id)}>
                ▶ Hear it ({clock(s.start)})
              </button>
            )}
          </Panel>
        ))}
        {tips.map((t, i) => (
          <Panel key={`t${i}`}>
            <p className="flex items-center gap-3 text-[18px] font-semibold">
              <StatusIcon status="bad" size={24} /> Do better next time
            </p>
            <p className="mt-2 text-[22px] font-bold">{t.title}</p>
            <p className="mt-1 text-[19px] leading-relaxed">{t.what_happened}</p>
            <div className="mt-4 rounded-[16px] bg-panel p-5">
              <p className="text-[18px] font-semibold text-ink/80">Try saying:</p>
              <p className="mt-1 text-[21px] leading-relaxed">{t.try_saying}</p>
            </div>
            {t.start !== null && (
              <button className={`${bigButton.secondary} mt-4`} onClick={() => audio.seek(t.start as number, t.segment_id)}>
                ▶ Hear what was said ({clock(t.start)})
              </button>
            )}
          </Panel>
        ))}
      </div>
    </Section>
  );
}

// --- The call steps ---------------------------------------------------------------------

function Checklist({
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
    <Section
      title="The call steps"
      intro={`Every call should follow the same steps. On this call, ${done.length} of ${a.items.length} steps were done.`}
    >
      {missed.length > 0 && (
        <>
          <h3 className="flex items-center gap-3 text-[22px] font-bold">
            <StatusIcon status="bad" size={26} /> Skipped ({missed.length})
          </h3>
          <ul className="mt-3 space-y-3">
            {missed.map((item) => (
              <Step key={item.key} item={item} audio={audio} callId={callId} onChange={onChange} />
            ))}
          </ul>
        </>
      )}
      <div className="mt-6">
        <Reveal
          open={showDone}
          onToggle={() => setShowDone((s) => !s)}
          more={`Show the ${plural(done.length, "step")} that ${done.length === 1 ? "was" : "were"} done`}
          less="Hide the steps that were done"
        />
      </div>
      {showDone && (
        <ul className="mt-4 space-y-3">
          {done.map((item) => (
            <Step key={item.key} item={item} audio={audio} callId={callId} onChange={onChange} />
          ))}
        </ul>
      )}
    </Section>
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
  const [open, setOpen] = useState(false);
  const evidence = item.evidence.find((e) => e.start !== null);
  const disputed = item.agreement === "disputed" && !item.override;
  return (
    <li>
      <Panel className="!p-5">
        <div className="flex flex-wrap items-start gap-4">
          <StatusIcon status={item.awarded ? "good" : "bad"} size={28} />
          <div className="min-w-0 flex-1">
            <p className="text-[21px] font-bold">{stepName(item.key, item.label)}</p>
            <p className="text-[18px] text-ink/80">{stepMeaning(item.key)}</p>
            {disputed && (
              <p className="mt-2">
                <StatusBadge status="watch" label="Not sure. Please decide." />
              </p>
            )}
            {item.override && (
              <p className="mt-2 text-[17px]">You changed this. It was marked “{item.model_status === "met" ? "done" : "skipped"}” before.</p>
            )}
          </div>
          <button
            className={bigButton.secondary}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Why?"}
          </button>
        </div>
        {open && (
          <div className="mt-4 space-y-4 border-t-2 border-line pt-4">
            <p className="text-[19px] leading-relaxed">{item.reason}</p>
            {evidence && (
              <button
                className="block w-full rounded-[14px] bg-panel px-4 py-3 text-left text-[19px] hover:bg-fill"
                onClick={() => audio.seek(evidence.start as number, evidence.segment_id)}
              >
                “{evidence.quote}”
                <span className="mt-1 block text-[17px] font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4">▶ Hear it ({clock(evidence.start)})</span>
              </button>
            )}
            <Decide item={item} callId={callId} onChange={onChange} />
          </div>
        )}
      </Panel>
    </li>
  );
}

function Decide({ item, callId, onChange }: { item: ScoreItem; callId: string; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function save(status: "met" | "missed" | null) {
    setBusy(true);
    try {
      await api.put(`/intel/calls/${callId}/items/${item.key}/override`, { status, note: "" });
      await onChange();
    } finally {
      setBusy(false);
    }
  }
  if (item.override) {
    return (
      <button className={bigButton.secondary} disabled={busy} onClick={() => save(null)}>
        Undo my change
      </button>
    );
  }
  return (
    <div>
      <p className="text-[18px] font-semibold">Do you agree?</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button className={bigButton.good} disabled={busy} onClick={() => save("met")}>
          ✓ It was done
        </button>
        <button className={bigButton.danger} disabled={busy} onClick={() => save("missed")}>
          ✕ It was skipped
        </button>
      </div>
    </div>
  );
}

// --- Promises, bigger and simpler than the v1 checklist ----------------------------------

function Promises({ items }: { items: FollowUp[] }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  return (
    <Section title="Things we promised on this call" intro="Tick each one when it is done.">
      <ul className="space-y-3">
        {items.map((f) => {
          const isDone = done[f.id] ?? f.status === "done";
          return (
            <li key={f.id}>
              <label className="flex min-h-[64px] cursor-pointer items-start gap-4 rounded-[18px] border-2 border-line bg-surface px-5 py-4">
                <input
                  type="checkbox"
                  className="mt-1 h-7 w-7 shrink-0 accent-good"
                  checked={isDone}
                  onChange={async (e) => {
                    const next = e.target.checked;
                    setDone((d) => ({ ...d, [f.id]: next }));
                    try {
                      await api.patch(`/intel/follow-ups/${f.id}`, { status: next ? "done" : "open" });
                    } catch {
                      setDone((d) => ({ ...d, [f.id]: !next }));
                    }
                  }}
                />
                <span className="min-w-0">
                  <span className={`block text-[20px] leading-snug ${isDone ? "line-through opacity-70" : ""}`}>{f.action}</span>
                  {f.due && <span className="mt-1 block text-[17px] text-ink/80">When: {f.due}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// --- Less common actions, together at the bottom --------------------------------------

function MoreOptions({ call, onChanged }: { call: CallDetail; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="More options">
      <Reveal open={open} onToggle={() => setOpen((o) => !o)} more="Show more options" less="Hide more options" />
      {open && (
        <div className="mt-4 flex flex-wrap gap-3">
          {call.analysis && (
            <Recheck callId={call.id} label="Check this call again" transcript="keep" onDone={onChanged} />
          )}
          {call.analysis && (
            <button className={bigButton.secondary} onClick={() => setTypeOpen(true)}>
              Change what kind of call this was
            </button>
          )}
          <button className={bigButton.secondary} onClick={() => window.print()}>
            Print this page
          </button>
          <Link href={`/calls/${call.id}`} className={bigButton.secondary}>
            Open in the old version
          </Link>
          <button className={bigButton.danger} onClick={() => setConfirmDelete(true)}>
            Delete this call
          </button>
        </div>
      )}
      <TypeDialog call={call} open={typeOpen} onClose={() => setTypeOpen(false)} onDone={onChanged} />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this call?">
        <p className="text-[18px]">The recording and everything we wrote about it will be gone for good.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button className={bigButton.secondary} onClick={() => setConfirmDelete(false)}>
            No, keep it
          </button>
          <button
            className={`${bigButton.danger} !bg-[#a3001a] !text-white`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api.delete(`/intel/calls/${call.id}`);
              router.replace("/v2/calls");
            }}
          >
            {busy && <Spinner className="h-4 w-4" />}
            Yes, delete it
          </button>
        </div>
      </Modal>
    </Section>
  );
}

function Recheck({
  callId,
  label,
  transcript,
  onDone,
}: {
  callId: string;
  label: string;
  transcript: "keep" | "redo";
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-2">
      <button
        className={bigButton.secondary}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.post(`/intel/calls/${callId}/reprocess`, { transcript });
            await onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : "That did not work. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner className="h-4 w-4" />}
        {label}
      </button>
      {error && <span className="text-[17px] text-bad">{error}</span>}
    </span>
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
  useEffect(() => setValue(call.call_type ?? ""), [call.call_type, open]);
  return (
    <Modal open={open} onClose={onClose} title="What kind of call was this?">
      <p className="mb-4 text-[18px]">We will check the call again using the steps for this kind of call.</p>
      <div className="grid gap-2">
        {CALL_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setValue(t.value)}
            aria-pressed={value === t.value}
            className={`min-h-[52px] rounded-[14px] border-2 px-4 text-left text-[18px] font-semibold ${
              value === t.value ? "border-accent bg-accent-soft" : "border-line hover:bg-panel"
            }`}
          >
            {value === t.value ? "● " : "○ "}
            {CALL_TYPE_PLAIN[t.value] ?? t.label}
          </button>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button className={bigButton.secondary} onClick={onClose}>
          Cancel
        </button>
        <button
          className={bigButton.primary}
          disabled={busy || !value}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post(`/intel/calls/${call.id}/reprocess`, { transcript: "keep", call_type: value });
              onClose();
              await onDone();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner className="h-4 w-4" />}
          Save and check again
        </button>
      </div>
    </Modal>
  );
}

function TypeCheck({ call, analysis, onDone }: { call: CallDetail; analysis: Analysis; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-[22px] bg-warn-soft p-6" role="region" aria-label="Please check the kind of call">
      <p className="flex items-center gap-3 text-[22px] font-bold">
        <StatusIcon status="watch" size={26} /> Please check: what kind of call was this?
      </p>
      <p className="mt-2 text-[20px] leading-relaxed">
        We think it was: <span className="font-semibold">{(CALL_TYPE_PLAIN[analysis.call_type] ?? analysis.call_type_label).toLowerCase()}</span>
        . We were not sure, and it changes which steps we check.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className={bigButton.good}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post(`/intel/calls/${call.id}/reprocess`, { transcript: "keep", call_type: analysis.call_type });
              await onDone();
            } finally {
              setBusy(false);
            }
          }}
        >
          ✓ Yes, that is right
        </button>
        <button className={bigButton.secondary} onClick={() => setOpen(true)}>
          No, change it
        </button>
      </div>
      <TypeDialog call={call} open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </div>
  );
}
