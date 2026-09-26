"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Analysis, type CallDetail, type ScoreItem, type Segment } from "@/lib/api";
import {
  CALL_TYPES,
  CANCEL_REASON,
  OFFER_LABEL,
  clock,
  dateTime,
  duration,
  titleCase,
} from "@/lib/format";
import { IN_PROGRESS, useApi } from "@/lib/hooks";
import {
  AlertIcon,
  BackIcon,
  CheckIcon,
  ChevronIcon,
  CrossIcon,
  PauseIcon,
  PlayIcon,
  QuoteIcon,
} from "@/components/icons";
import {
  Avatar,
  Card,
  CardHeader,
  ErrorNote,
  GradeBadge,
  Loading,
  Modal,
  OutcomeText,
  Spinner,
  TypeBadge,
} from "@/components/ui";

export default function CallPage() {
  const { id } = useParams<{ id: string }>();
  const { data: call, error, loading, reload, setData } = useApi<CallDetail>(`/intel/calls/${id}`, {
    poll: (c) => IN_PROGRESS.has(c.processing_status),
  });
  const audio = useAudio();

  if (loading && !call) return <Loading />;
  if (error && !call) return <ErrorNote message={error} />;
  if (!call) return null;

  const a = call.analysis;
  const processing = IN_PROGRESS.has(call.processing_status);

  return (
    <div className="space-y-5">
      <Link href="/calls/log" className="-ml-1 inline-flex items-center gap-0.5 text-[15px] text-link hover:underline">
        <BackIcon className="h-4 w-4" /> Call Log
      </Link>

      <Header call={call} onChanged={(c) => setData(c)} reload={reload} />

      {processing && <Processing status={call.processing_status} />}
      {call.processing_status === "failed" && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ErrorNote message={call.processing_error ?? "Processing failed."} />
            <RerunButton callId={call.id} label="Try again" transcript={call.segments.length ? "keep" : "redo"} onDone={reload} />
          </div>
        </Card>
      )}

      {a && a.call_type_confidence < 0.7 && !call.call_type_overridden && (
        <TypeCheck call={call} analysis={a} onDone={reload} />
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_372px]">
        <div className="min-w-0 space-y-5">
          {a && <Summary analysis={a} />}
          {a && a.items.length > 0 && <Coaching analysis={a} seek={audio.seek} />}
          {call.segments.length > 0 && (
            <Transcript segments={call.segments} current={audio.time} seek={audio.seek} repName={call.rep_name} />
          )}
        </div>

        <div className="no-scrollbar space-y-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pb-2">
          {call.audio_url && <Player src={api.url(call.audio_url)} audio={audio} duration={call.duration_seconds} />}
          {a && a.items.length > 0 && <Scorecard analysis={a} seek={audio.seek} />}
          {a && !a.items.length && (
            <Card className="p-5">
              <p className="font-medium">Not scored</p>
              <p className="mt-1 text-sm text-muted">
                {a.call_type === "not_scorable"
                  ? "There was no customer conversation to grade on this call."
                  : "This call type has no scorecard."}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Header ---------------------------------------------------------------------

function Header({
  call,
  reload,
}: {
  call: CallDetail;
  onChanged: (c: CallDetail) => void;
  reload: () => Promise<void>;
}) {
  const router = useRouter();
  const a = call.analysis;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = a?.customer_name ?? call.external_ref ?? call.original_filename ?? "Call";

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge label={call.call_type_label} />
            {call.call_type_overridden && <span className="text-[13px] text-muted">· set by manager</span>}
            <OutcomeText outcome={call.outcome} />
          </div>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-title">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-muted">
            {call.rep_name && (
              <span className="inline-flex items-center gap-2 text-ink">
                <Avatar name={call.rep_name} size={22} />
                {call.rep_name}
              </span>
            )}
            <span>{call.external_ref ?? call.original_filename}</span>
            <span>{duration(call.duration_seconds)}</span>
            <span>{dateTime(call.occurred_at ?? call.created_at)}</span>
            {a?.triage?.direction && a.triage.direction !== "unknown" && (
              <span>{titleCase(a.triage.direction)}</span>
            )}
          </div>
        </div>

        {a?.score_max ? (
          <div className="text-right">
            <p className="tnum text-[44px] font-semibold leading-none tracking-title">
              {a.score}
              <span className="text-[26px] font-medium text-faint">/{a.score_max}</span>
            </p>
            <div className="mt-2 flex justify-end">
              <GradeBadge grade={a.grade} size="lg" />
            </div>
            <p className="mt-1 text-[12px] text-muted">{a.scorecard_name}</p>
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
        {a && (
          <RerunButton
            callId={call.id}
            label="Re-score"
            transcript="keep"
            mode="standard"
            onDone={reload}
            disabled={IN_PROGRESS.has(call.processing_status)}
          />
        )}
        {a && (
          <RerunButton
            callId={call.id}
            label="Enhanced re-score"
            transcript="keep"
            mode="enhanced"
            title="Claude and OpenAI grade independently, then deliberate on disagreements"
            onDone={reload}
            disabled={IN_PROGRESS.has(call.processing_status)}
          />
        )}
        {a && <ChangeType call={call} onDone={reload} />}
        <button className="btn-danger ml-auto" onClick={() => setConfirmDelete(true)}>
          Delete call
        </button>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this call?">
        <p className="text-[14px] text-muted">
          The recording, transcript and score are removed permanently.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
          <button
            className="btn bg-bad text-white hover:bg-[#b0001a]"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api.delete(`/intel/calls/${call.id}`);
              router.replace("/calls/log");
            }}
          >
            {busy && <Spinner className="h-3.5 w-3.5" />}
            Delete
          </button>
        </div>
      </Modal>
    </Card>
  );
}

function RerunButton({
  callId,
  label,
  transcript,
  mode,
  title,
  onDone,
  disabled,
}: {
  callId: string;
  label: string;
  transcript: "keep" | "redo";
  mode?: "standard" | "enhanced";
  title?: string;
  onDone: () => Promise<void>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <button
      className="btn-secondary"
      disabled={busy || disabled}
      title={error ?? title ?? "Grade this call again from its transcript"}
      onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await api.post(`/intel/calls/${callId}/reprocess`, {
            transcript,
            ...(mode ? { scoring_mode: mode } : {}),
          });
          await onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not re-score");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Spinner className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function ChangeType({ call, onDone }: { call: CallDetail; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)} disabled={IN_PROGRESS.has(call.processing_status)}>
        Change call type
      </button>
      <TypeDialog call={call} open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </>
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
      <p className="mb-4 text-[14px] text-muted">
        The call is re-graded on the scorecard for the type you choose. Takes about a minute.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {CALL_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setValue(t.value)}
            className={`rounded-xl border px-3 py-2.5 text-left text-[14px] font-medium transition-colors ${
              value === t.value ? "border-accent bg-accent-soft/50 ring-1 ring-accent" : "border-line hover:bg-panel"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
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
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not re-grade");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner className="h-3.5 w-3.5" />}
          Re-grade
        </button>
      </div>
    </Modal>
  );
}

function TypeCheck({ call, analysis, onDone }: { call: CallDetail; analysis: Analysis; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-[#ffd8a8] bg-warn-soft px-5 py-4">
      <div className="flex items-start gap-2.5 text-[14px]">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <p>
          <span className="font-semibold">Is this a {analysis.call_type_label.toLowerCase()} call?</span>{" "}
          <span className="text-ink/80">{analysis.triage.call_type_reason}</span>
        </p>
      </div>
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          onClick={async () => {
            await api.post(`/intel/calls/${call.id}/reprocess`, {
              transcript: "keep",
              call_type: analysis.call_type,
            });
            await onDone();
          }}
        >
          Yes, confirm
        </button>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          Change type
        </button>
      </div>
      <TypeDialog call={call} open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </div>
  );
}

function Processing({ status }: { status: string }) {
  const steps = [
    { key: "transcribing", label: "Transcribing" },
    { key: "analyzing", label: "Classifying and scoring" },
  ];
  const index = status === "analyzing" || status === "queued_analysis" ? 1 : status === "transcribing" ? 0 : -1;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <Spinner className="h-5 w-5 text-muted" />
        <div>
          <p className="font-medium">{index < 0 ? "Waiting in line" : steps[index].label}</p>
          <p className="text-[14px] text-muted">This page updates on its own. Longer calls take a few minutes.</p>
        </div>
      </div>
    </Card>
  );
}

// --- Summary & details ------------------------------------------------------------

function Summary({ analysis: a }: { analysis: Analysis }) {
  const t = a.triage;
  const details: { label: string; value: React.ReactNode }[] = [];
  if (a.lens === "sales") {
    if (t.sales.service_discussed) details.push({ label: "Service discussed", value: t.sales.service_discussed });
    if (t.sales.price_quoted) details.push({ label: "Price quoted", value: t.sales.price_quoted });
    if (t.sales.objections.length)
      details.push({ label: "Objections", value: t.sales.objections.map((o) => o.objection).join("; ") });
    if (t.sales.lost_reason) details.push({ label: "Why not closed", value: t.sales.lost_reason });
  }
  if (a.lens === "retention") {
    details.push({ label: "Reason for cancelling", value: CANCEL_REASON[t.retention.cancel_reason] ?? t.retention.cancel_reason });
    if (t.retention.root_cause) details.push({ label: "Root cause", value: t.retention.root_cause });
    details.push({
      label: "Save offers made",
      value: t.retention.offers_made.length
        ? t.retention.offers_made.map((o) => OFFER_LABEL[o] ?? o).join(", ")
        : "None",
    });
  }
  if (a.lens === "service") {
    if (t.service.request) details.push({ label: "Request", value: t.service.request });
    if (t.service.actions_taken.length) details.push({ label: "What was done", value: t.service.actions_taken.join("; ") });
  }
  if (t.pests.length) details.push({ label: "Pests", value: t.pests.join(", ") });
  if (t.appointment.booked) details.push({ label: "Appointment", value: t.appointment.when || "Booked" });
  if (t.customer_wins.length) details.push({ label: "What matters to them", value: t.customer_wins.join(", ") });

  return (
    <Card className="p-6">
      <CardHeader title="What happened" />
      <p className="text-[16px] leading-relaxed">{a.summary}</p>
      {details.length > 0 && (
        <dl className="mt-6 grid gap-x-8 gap-y-4 border-t border-line pt-5 sm:grid-cols-2">
          {details.map((d) => (
            <div key={d.label}>
              <dt className="text-[12px] text-muted">{d.label}</dt>
              <dd className="mt-0.5 text-[14px] leading-snug [overflow-wrap:anywhere]">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {t.follow_ups.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="eyebrow mb-2">Follow-ups</p>
          <ul className="space-y-2 text-[14px]">
            {t.follow_ups.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-muted" />
                <span>
                  {f.action}
                  <span className="text-muted"> · {[titleCase(f.owner), f.due].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// --- Coaching ---------------------------------------------------------------------

function Coaching({ analysis: a, seek }: { analysis: Analysis; seek: (t: number) => void }) {
  const c = a.coaching;
  return (
    <Card accent className="p-6">
      <CardHeader eyebrow="Coaching" title={`Feedback for ${a.rep_name ?? "the rep"}`} />
      {c.overall_feedback && <p className="text-[16px] leading-relaxed">{c.overall_feedback}</p>}
      <div className="mt-6 space-y-3">
        {(c.coaching ?? []).map((tip, i) => (
          <div key={i} className="rounded-2xl bg-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[15px] font-semibold tracking-tightish">
                {i + 1}. {tip.title}
              </p>
              {tip.start !== null && <TimeLink t={tip.start} seek={seek} />}
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink/80">{tip.what_happened}</p>
            <div className="mt-3 rounded-xl border-l-[3px] border-accent bg-white px-4 py-3 text-[14px]">
              <div>
                <p className="text-[12px] font-medium text-muted">Try saying</p>
                <p className="mt-0.5 leading-relaxed [overflow-wrap:anywhere]">{tip.try_saying}</p>
              </div>
            </div>
            {tip.why_it_matters && <p className="mt-2.5 text-[13px] text-muted">{tip.why_it_matters}</p>}
          </div>
        ))}
      </div>
      {(c.strengths ?? []).length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">What went well</p>
          <ul className="space-y-2">
            {(c.strengths ?? []).map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[14px] leading-snug">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good" />
                <span className="flex-1">
                  <span className="font-medium">{s.title}.</span> {s.detail}
                </span>
                {s.start !== null && <TimeLink t={s.start} seek={seek} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// --- Scorecard --------------------------------------------------------------------

function Scorecard({ analysis: a, seek }: { analysis: Analysis; seek: (t: number) => void }) {
  const groups = useMemo(() => {
    const out: { quadrant: string; items: ScoreItem[] }[] = [];
    a.items.forEach((item) => {
      const last = out[out.length - 1];
      if (last && last.quadrant === item.quadrant) last.items.push(item);
      else out.push({ quadrant: item.quadrant, items: [item] });
    });
    return out;
  }, [a.items]);

  return (
    <Card className="p-5">
      <CardHeader
        eyebrow="Scorecard"
        title={a.scorecard_name ?? "Scorecard"}
        action={
          <span className="tnum text-[15px] font-semibold">
            {a.score}/{a.score_max}
          </span>
        }
      />
      <div className="space-y-4">
        {groups.map((g) => {
          const got = g.items.filter((i) => i.awarded).length;
          return (
            <div key={g.quadrant}>
              <div className="mb-1 flex items-center justify-between">
                <p className="eyebrow">{g.quadrant}</p>
                <p className="tnum text-xs text-muted">
                  {got}/{g.items.length}
                </p>
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-xl bg-panel">
                {g.items.map((item) => (
                  <ItemRow key={item.key} item={item} seek={seek} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="mt-4 space-y-1 text-[12px] text-muted">
        {a.evidence_verified_pct !== null && (
          <p>{a.evidence_verified_pct.toFixed(0)}% of quoted evidence found word-for-word in the transcript.</p>
        )}
        <p>
          {a.scoring_mode === "enhanced" ? "Enhanced scoring" : "Standard scoring"} · {a.model}
        </p>
      </div>
    </Card>
  );
}

function ItemRow({ item, seek }: { item: ScoreItem; seek: (t: number) => void }) {
  const [open, setOpen] = useState(false);
  const split = item.agreement && /^[12]\/3$/.test(item.agreement);
  return (
    <li>
      <button className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.02]" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {item.awarded ? (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#34c759] text-white">
            <CheckIcon className="h-3 w-3" />
          </span>
        ) : (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#ff3b30] text-white">
            <CrossIcon className="h-2.5 w-2.5" />
          </span>
        )}
        <span className="flex-1 text-[14px]">{item.label}</span>
        {item.auto_awarded && <span className="text-[12px] text-muted">Auto</span>}
        {split && !item.auto_awarded && (
          <span className="chip bg-warn-soft text-warn" title="Independent grading passes disagreed on this step">
            Borderline
          </span>
        )}
        {item.agreement === "settled" && !item.auto_awarded && (
          <span className="chip bg-accent-soft text-accent" title="The two models disagreed, then agreed after deliberating">
            Settled
          </span>
        )}
        {item.agreement === "disputed" && !item.auto_awarded && (
          <span className="chip bg-warn-soft text-warn" title="The two models still disagreed after deliberating; not awarded">
            Disputed
          </span>
        )}
        <ChevronIcon className={`h-4 w-4 shrink-0 text-faint transition ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3.5 pl-[38px] text-[14px]">
          <p className="text-ink/80">{item.reason}</p>
          {item.deliberation && (
            <div className="space-y-2 rounded-xl bg-white p-3">
              <p className="text-xs font-medium text-muted">How the models deliberated</p>
              {item.deliberation.map((d) => (
                <div key={d.model} className="text-xs">
                  <span className="font-medium">{d.model}</span>
                  <span className="text-muted">
                    {" "}
                    · {d.first === d.final ? `held ${d.final}` : `${d.first} → ${d.final}`}
                  </span>
                  <p className="mt-0.5 text-ink/80">{d.reason}</p>
                </div>
              ))}
            </div>
          )}
          {item.evidence.map((e, i) => (
            <button
              key={i}
              onClick={() => e.start !== null && seek(e.start)}
              className="block w-full rounded-xl bg-white px-3 py-2 text-left transition-colors [overflow-wrap:anywhere] hover:bg-accent-soft"
              disabled={e.start === null}
            >
              <span className="tnum mr-2 text-[12px] font-medium text-link">{e.start !== null ? clock(e.start) : "-"}</span>
              <span>“{e.quote}”</span>
              {!e.verified && (
                <span className="ml-2 text-xs text-warn">not found verbatim</span>
              )}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

// --- Audio ------------------------------------------------------------------------

interface AudioControl {
  ref: React.RefObject<HTMLAudioElement | null>;
  time: number;
  playing: boolean;
  seek: (t: number) => void;
  toggle: () => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
}

function useAudio(): AudioControl {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const seek = useCallback((t: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = Math.max(0, t - 0.3);
    void el.play();
  }, []);
  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);
  return { ref, time, playing, seek, toggle, setTime, setPlaying };
}

function Player({ src, audio, duration: total }: { src: string; audio: AudioControl; duration: number }) {
  const [length, setLength] = useState(total);
  const [rate, setRate] = useState(1);
  const progress = length ? Math.min(100, (audio.time / length) * 100) : 0;

  return (
    <Card className="px-4 py-3.5">
      <audio
        ref={audio.ref}
        src={src}
        preload="metadata"
        onTimeUpdate={(e) => audio.setTime(e.currentTarget.currentTime)}
        onPlay={() => audio.setPlaying(true)}
        onPause={() => audio.setPlaying(false)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)}
      />
      <div className="flex items-center gap-3">
        <button
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-colors hover:bg-black"
          onClick={audio.toggle}
          aria-label={audio.playing ? "Pause" : "Play"}
        >
          {audio.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="ml-0.5 h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={length || 0}
            step={0.1}
            value={audio.time}
            onChange={(e) => {
              if (audio.ref.current) audio.ref.current.currentTime = Number(e.target.value);
            }}
            className="w-full accent-[#1d1d1f]"
            aria-label="Seek"
            style={{ backgroundSize: `${progress}% 100%` }}
          />
          <div className="tnum flex justify-between text-[12px] text-muted">
            <span>{clock(audio.time)}</span>
            <span>{clock(length)}</span>
          </div>
        </div>
        <button
          className="btn-secondary tnum w-12 px-0 py-1 text-[12px]"
          onClick={() => {
            const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
            setRate(next);
            if (audio.ref.current) audio.ref.current.playbackRate = next;
          }}
          aria-label="Playback speed"
        >
          {rate}×
        </button>
      </div>
    </Card>
  );
}

function TimeLink({ t, seek }: { t: number; seek: (t: number) => void }) {
  return (
    <button onClick={() => seek(t)} className="tnum inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[12px] font-medium text-link ring-1 ring-line transition-colors hover:bg-accent-soft">
      <PlayIcon className="h-2.5 w-2.5" />
      {clock(t)}
    </button>
  );
}

// --- Transcript -------------------------------------------------------------------

function Transcript({
  segments,
  current,
  seek,
  repName,
}: {
  segments: Segment[];
  current: number;
  seek: (t: number) => void;
  repName: string | null;
}) {
  const turns = useMemo(() => {
    const out: { role: Segment["role"]; items: Segment[] }[] = [];
    segments.forEach((s) => {
      const last = out[out.length - 1];
      if (last && last.role === s.role) last.items.push(s);
      else out.push({ role: s.role, items: [s] });
    });
    return out;
  }, [segments]);

  const activeId = useMemo(() => {
    let id = -1;
    for (const s of segments) {
      if (s.start <= current + 0.05) id = s.id;
      else break;
    }
    return current > 0 ? id : -1;
  }, [segments, current]);

  return (
    <Card className="p-6">
      <CardHeader title="Transcript" />
      <div className="space-y-3">
        {turns.map((turn, i) => {
          const rep = turn.role === "rep";
          return (
            <div key={i} className={`flex min-w-0 gap-3 ${rep ? "" : "flex-row-reverse"}`}>
              <div className={`min-w-0 max-w-[85%] ${rep ? "" : "text-right"}`}>
                <p className="mb-1 px-1 text-[12px] text-muted">
                  {rep ? repName ?? "Rep" : turn.role === "customer" ? "Customer" : "Speaker"}{" "}
                  <button className="tnum text-faint hover:text-link" onClick={() => seek(turn.items[0].start)}>
                    {clock(turn.items[0].start)}
                  </button>
                </p>
                <div
                  className={`inline-block max-w-full rounded-[18px] px-4 py-2.5 text-left text-[15px] leading-[1.4] [overflow-wrap:anywhere] ${
                    rep ? "bg-[#e9e9eb] text-ink" : "bg-[#0a84ff] text-white"
                  }`}
                >
                  {turn.items.map((s) => (
                    <span
                      key={s.id}
                      onClick={() => seek(s.start)}
                      className={`cursor-pointer rounded px-0.5 transition-colors ${
                        s.id === activeId ? (rep ? "bg-[#ffe58f]" : "bg-white/30") : rep ? "hover:bg-black/5" : "hover:bg-white/15"
                      }`}
                    >
                      {s.text}{" "}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
