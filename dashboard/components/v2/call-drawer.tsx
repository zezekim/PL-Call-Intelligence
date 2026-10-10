"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CallDetail } from "@/lib/api";
import { OUTCOME_TONE, clock, dateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CALL_TYPE_PLAIN, GRADE_PLAIN, OUTCOME_PLAIN, spokenLength, stepName } from "@/lib/easy";
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
          <Link href={`/v2/calls/${callId}`} className="inline-flex min-h-[44px] items-center text-[16px] font-medium text-link">
            See everything about this call →
          </Link>
          <button
            className="flex h-11 w-11 items-center justify-center rounded-full bg-fill text-[16px] text-ink/70 hover:bg-fill-hover"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {/* Focusable so the keyboard can scroll it. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" tabIndex={0} role="region" aria-label="About this call">
          {call ? (
            <Body call={call} />
          ) : error ? (
            <p className="text-[16px] text-ink/80">This call couldn&apos;t be opened. Try again in a moment.</p>
          ) : (
            <p className="flex items-center gap-2 text-[16px] text-ink/80">
              <Spinner className="h-4 w-4" /> Opening the call…
            </p>
          )}
        </div>
        {action && (
          <div className="border-t border-line px-5 py-4">
            <button className="btn-primary min-h-[52px] w-full text-[17px]" onClick={action.onDo}>
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
  const rep = !call.rep_name ? null : /receptionist/i.test(call.rep_name) ? "the receptionist" : call.rep_name.split(/\s+/)[0];
  const fixKey = fix?.item_keys?.[0];

  return (
    <div className="space-y-5">
      <div>
        <p className="flex flex-wrap items-center gap-2 text-[15px]">
          <span className="font-medium">{CALL_TYPE_PLAIN[call.call_type ?? ""] ?? "Call"}</span>
          {call.outcome && call.outcome !== "not_applicable" && (
            <StatusPill status={OUTCOME_STATUS[tone]} label={OUTCOME_PLAIN[call.outcome] ?? call.outcome} />
          )}
        </p>
        <h2 className="mt-1 text-[24px] font-semibold leading-tight tracking-title">Call with {name ?? "a customer"}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px] text-ink/80">
          {call.rep_name && (
            <span className="inline-flex items-center gap-1.5 text-ink">
              <Avatar name={call.rep_name} size={20} />
              {call.rep_name} took this call ·
            </span>
          )}
          <span>{dateTime(call.occurred_at ?? call.created_at)} ·</span>
          <span>{spokenLength(call.duration_seconds)}</span>
        </p>
      </div>

      {summary && (
        <div>
          <h3 className="text-[15px] font-semibold text-ink/70">What happened</h3>
          <p className="mt-1 text-[17px] leading-relaxed">
            {more || !summary.more ? a!.summary : summary.first}
            {summary.more && (
              <button className="ml-1.5 text-[15px] font-medium text-link underline underline-offset-2" onClick={() => setMore((m) => !m)}>
                {more ? "Show less" : "Read more"}
              </button>
            )}
          </p>
        </div>
      )}

      {a?.score_max ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-panel px-4 py-3">
          <span className="text-[16px] font-medium">How {rep ?? "the call"} did</span>
          <StatusPill status={GRADE_STATUS[a.grade ?? ""] ?? "none"} label={a.grade ? GRADE_PLAIN[a.grade] : "Not checked"} />
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
              <button className="btn-secondary min-h-[48px] px-5 text-[16px]" onClick={audio.toggle}>
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
              label={`What ${rep ?? "they"} should do next time`}
              title={fix.title}
              say={fix.try_saying}
              at={fix.start}
              onHear={(t) => audio.seek(t)}
              canHear={!!call.audio_url}
            />
          )}
          {best && <Moment tone="good" label={`What ${rep ?? "they"} did well`} title={best.title} at={best.start} onHear={(t) => audio.seek(t)} canHear={!!call.audio_url} />}
        </div>
      )}

      {missed.filter((i) => i.key !== fixKey).length > 0 && (
        <div>
          <h3 className="text-[15px] font-semibold text-ink/70">Also missed on this call</h3>
          <ul className="mt-1.5 space-y-1.5">
            {missed.filter((i) => i.key !== fixKey).slice(0, 4).map((i) => (
              <li key={i.key} className="flex items-start gap-2 text-[16px]">
                <span
                  className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-bad-soft text-[10px] font-extrabold text-bad"
                  aria-hidden
                >
                  ✕
                </span>
                {stepName(i.key, i.label)}
              </li>
            ))}
          </ul>
          {missed.filter((i) => i.key !== fixKey).length > 4 && (
            <Link href={`/v2/calls/${call.id}`} className="inline-flex min-h-[44px] items-center text-[15px] font-medium text-link">
              See the rest →
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
      <p className={`text-[15px] font-semibold ${tone === "good" ? "text-good" : "text-bad"}`}>{label}</p>
      <p className="mt-0.5 text-[17px] font-medium leading-snug">{title}</p>
      {say && (
        <p className="mt-1.5 text-[16px] leading-relaxed">
          <span className="font-semibold">Say this instead:</span> {say}
        </p>
      )}
      {at !== null && canHear && (
        <button className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-link underline underline-offset-2" onClick={() => onHear(at)}>
          <PlayIcon className="h-3 w-3" /> Hear that part
        </button>
      )}
    </div>
  );
}
