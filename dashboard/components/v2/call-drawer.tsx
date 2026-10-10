"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CallDetail } from "@/lib/api";
import { OUTCOME_TONE, clock, dateTime, duration } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CALL_TYPE_PLAIN, GRADE_PLAIN, OUTCOME_PLAIN, stepName } from "@/lib/easy";
import type { Status } from "@/lib/v2";
import { firstSentence, personName } from "@/lib/v2";
import { PauseIcon, PlayIcon } from "@/components/icons";
import { Avatar, Spinner, useDialog } from "@/components/ui";
import { CallButton } from "@/components/v2/customer";
import { StatusPill } from "@/components/v2/kit";
import { useAudio } from "@/components/v2/listen";

const GRADE_STATUS: Record<string, Status> = {
  gold: "good",
  green: "good",
  below: "bad",
};
const OUTCOME_STATUS: Record<string, Status> = {
  good: "good",
  warn: "watch",
  bad: "bad",
  none: "none",
};

/**
 * A call at a glance, beside the page it was opened from: what happened, how
 * it went, the moment to hear and the steps missed, with the job's own button
 * at the bottom. The full call page is one link away.
 */
export function CallDrawer({
  callId,
  onClose,
  action,
}: {
  callId: string;
  onClose: () => void;
  /** The job's button ("Text Jordan →"), done from inside the drawer. */
  action?: { label: string; onDo: () => void } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(true, onClose, ref);
  const { data: call, error } = useApi<CallDetail>(`/intel/calls/${callId}`);
  const name = personName(call?.analysis?.customer_name);

  // On the body: the page fades in with a transform, which would pin a fixed
  // panel to the page instead of the window.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={call ? `Call with ${name ?? "a customer"}` : "Call"}
        className="flex h-full w-full max-w-[480px] flex-col bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <Link href={`/v2/calls/${callId}`} className="text-[14px] font-medium text-link">
            Open the full call →
          </Link>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fill text-[14px] text-muted hover:bg-fill-hover"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {call ? (
            <Body call={call} />
          ) : error ? (
            <p className="text-[15px] text-muted">This call couldn&apos;t be opened. Try again in a moment.</p>
          ) : (
            <p className="flex items-center gap-2 text-[15px] text-muted">
              <Spinner className="h-4 w-4" /> Opening the call…
            </p>
          )}
        </div>
        {action && (
          <div className="border-t border-line px-5 py-4">
            <button className="btn-primary w-full" onClick={action.onDo}>
              {action.label} →
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Body({ call }: { call: CallDetail }) {
  const audio = useAudio();
  const [more, setMore] = useState(false);
  const a = call.analysis;
  const name = personName(a?.customer_name);
  const tone = call.outcome ? (OUTCOME_TONE[call.outcome] ?? "none") : "none";
  const summary = a?.summary ? firstSentence(a.summary) : null;
  const best = a?.coaching.strengths?.[0];
  const fix = a?.coaching.coaching?.[0];
  const missed = (a?.items ?? []).filter((i) => i.status === "missed");

  return (
    <div className="space-y-5">
      <div>
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium">{CALL_TYPE_PLAIN[call.call_type ?? ""] ?? "Call"}</span>
          {call.outcome && call.outcome !== "not_applicable" && (
            <StatusPill status={OUTCOME_STATUS[tone]} label={OUTCOME_PLAIN[call.outcome] ?? call.outcome} />
          )}
        </p>
        <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-title">Call with {name ?? "a customer"}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          {call.rep_name && (
            <span className="inline-flex items-center gap-1.5 text-ink">
              <Avatar name={call.rep_name} size={18} />
              {call.rep_name}
            </span>
          )}
          <span>{dateTime(call.occurred_at ?? call.created_at)}</span>
          <span>{duration(call.duration_seconds)}</span>
        </p>
      </div>

      {summary && (
        <div>
          <h3 className="text-[13px] font-semibold text-muted">What happened</h3>
          <p className="mt-1 text-[15px] leading-relaxed">
            {more || !summary.more ? a!.summary : summary.first}
            {summary.more && (
              <button className="ml-1.5 text-[13px] font-medium text-link hover:underline" onClick={() => setMore((m) => !m)}>
                {more ? "Less" : "More"}
              </button>
            )}
          </p>
        </div>
      )}

      {a?.score_max ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-panel px-4 py-3">
          <span className="text-[14px] text-ink/80">Call steps done</span>
          <span className="flex items-center gap-2">
            <span className="tnum text-[20px] font-semibold">
              {a.score}
              <span className="text-[14px] font-medium text-muted">/{a.score_max}</span>
            </span>
            <StatusPill status={GRADE_STATUS[a.grade ?? ""] ?? "none"} label={a.grade ? GRADE_PLAIN[a.grade] : "Not checked"} />
          </span>
        </div>
      ) : null}

      {(call.audio_url || call.customer_phone) && (
        <div className="flex flex-wrap gap-2">
          {call.audio_url && (
            <>
              <audio
                ref={audio.ref}
                src={call.audio_url}
                preload="none"
                onPlay={() => audio.setPlaying(true)}
                onPause={() => audio.setPlaying(false)}
                onTimeUpdate={(e) => audio.setTime(e.currentTarget.currentTime)}
              />
              <button className="btn-secondary" onClick={audio.toggle}>
                {audio.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                {audio.playing ? `Pause · ${clock(audio.time)}` : "Play the call"}
              </button>
            </>
          )}
          {call.customer_phone && <CallButton phone={call.customer_phone} pretty={call.customer_phone_pretty} name={name} />}
        </div>
      )}

      {(fix || best) && (
        <div className="space-y-2">
          {fix && (
            <Moment
              tone="bad"
              label="Do better next time"
              title={fix.title}
              say={fix.try_saying}
              at={fix.start}
              onHear={(t) => audio.seek(t)}
              canHear={!!call.audio_url}
            />
          )}
          {best && <Moment tone="good" label="Done well" title={best.title} at={best.start} onHear={(t) => audio.seek(t)} canHear={!!call.audio_url} />}
        </div>
      )}

      {missed.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-muted">Steps missed</h3>
          <ul className="mt-1.5 space-y-1">
            {missed.slice(0, 4).map((i) => (
              <li key={i.key} className="flex items-start gap-2 text-[14px]">
                <span
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-bad-soft text-[10px] font-extrabold text-bad"
                  aria-hidden
                >
                  ✕
                </span>
                {stepName(i.key, i.label)}
              </li>
            ))}
          </ul>
          {missed.length > 4 && (
            <Link href={`/v2/calls/${call.id}`} className="mt-1.5 block text-[13px] font-medium text-link">
              {missed.length - 4} more on the full call →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Moment({
  tone,
  label,
  title,
  say,
  at,
  canHear,
  onHear,
}: {
  tone: "good" | "bad";
  label: string;
  title: string;
  say?: string;
  at: number | null;
  canHear: boolean;
  onHear: (t: number) => void;
}) {
  return (
    <div className={`rounded-xl px-4 py-3 ${tone === "good" ? "bg-good-soft" : "bg-bad-soft"}`}>
      <p className={`text-[12px] font-semibold ${tone === "good" ? "text-good" : "text-bad"}`}>{label}</p>
      <p className="mt-0.5 text-[15px] font-medium leading-snug">{title}</p>
      {say && (
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink/80">
          <span className="font-semibold">Try saying:</span> {say}
        </p>
      )}
      {at !== null && canHear && (
        <button className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-link hover:underline" onClick={() => onHear(at)}>
          <PlayIcon className="h-2.5 w-2.5" /> Hear it ({clock(at)})
        </button>
      )}
    </div>
  );
}
