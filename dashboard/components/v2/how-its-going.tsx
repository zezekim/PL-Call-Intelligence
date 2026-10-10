"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { clock } from "@/lib/format";
import type { ActionsSummary, Brief, PerformanceCard, PreparedAction } from "@/lib/v2";
import { STATUS_SOFT, STATUS_TEXT, goalWords } from "@/lib/v2";
import { AlertIcon, CheckIcon, ChevronIcon, PhoneIcon, PlayIcon } from "@/components/icons";
import { Card, Spinner } from "@/components/ui";
import { failMessage, useToast } from "@/components/v2/toast";
import { Meter, Section, StatusPill } from "@/components/v2/kit";

/*
 * How the business is doing and what to teach: the part of the owner's view
 * that is for reading, not doing. It lives on the Team page so Today can be
 * one job at a time.
 */

export function Scores({ brief }: { brief: Brief }) {
  const [sales, retention, service] = brief.cards;
  // The headline's "most urgent" detail belongs to Today; here only the verdict.
  const { status, title } = brief.headline;
  const Icon = status === "good" ? CheckIcon : AlertIcon;
  return (
    <Section title="How it's going" subtitle="Green is good. Red needs work.">
      <div className={`mb-4 flex gap-3 rounded-card px-5 py-4 ${STATUS_SOFT[status]}`}>
        <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${STATUS_TEXT[status]}`} />
        <div>
          <p className="text-[18px] font-semibold leading-snug">{title}</p>
        </div>
      </div>
      <div className="grid gap-4 min-[1180px]:grid-cols-3 min-[1180px]:gap-y-0">
        {[sales, retention, service].map((c) => (
          <Performance key={c.key} card={c} />
        ))}
      </div>
    </Section>
  );
}

/*
 * The three cards share their row heights (CSS subgrid), so the numbers, bars
 * and links line up across them however long each card's wording is. Each card
 * says one thing: how this area is doing, why, and what to do about it.
 */
function Performance({ card }: { card: PerformanceCard }) {
  return (
    <Card className="flex flex-col p-5 min-[1180px]:row-span-6 min-[1180px]:grid min-[1180px]:grid-rows-subgrid min-[1180px]:gap-0">
      <div>
        <p className="text-[18px] font-semibold leading-snug tracking-tightish" title={card.question}>
          {card.label}
        </p>
        <span className="mt-2 inline-block">
          <StatusPill status={card.status} />
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className={`tnum whitespace-nowrap text-[40px] font-semibold leading-none tracking-title ${STATUS_TEXT[card.status]}`}>
          {card.of ? `${card.count} of ${card.of}` : "–"}
        </span>
        <span className="text-[18px] font-medium text-ink/80">{card.metric_label.toLowerCase()}</span>
      </div>
      <div className="mt-3 w-full self-start">
        <Meter value={card.value} target={card.target} status={card.status} label={card.metric_label} />
      </div>
      <p className="mt-2 text-[16px] text-ink/70" title={card.detail}>
        {goalWords(card.goal)}
      </p>

      <p className="mt-4 border-t border-line pt-3 text-[17px] leading-snug">{card.why}</p>
      {card.action ? (
        <Link
          href={card.action.href}
          className="mt-3 inline-flex min-h-[40px] items-center gap-1 self-start text-[17px] font-medium text-link underline underline-offset-2"
        >
          {card.action.label}
          <ChevronIcon className="h-4 w-4" />
        </Link>
      ) : (
        <span aria-hidden />
      )}
    </Card>
  );
}


// --- What to coach -----------------------------------------------------------------

export function CoachingFocus({
  brief,
  quality,
  summary,
  onChanged,
}: {
  brief: Brief;
  quality: PerformanceCard;
  summary: ActionsSummary | null;
  onChanged: () => Promise<void>;
}) {
  const c = brief.coaching;
  const first = c?.reps[0];
  return (
    <Section title="What to teach this week" subtitle="One thing. It would help the most calls.">
      <Card className="p-5">
        {c ? (
          <>
            <p className="text-[24px] font-semibold leading-tight tracking-title">{c.focus.plain}</p>
            <p className="mt-0.5 text-[17px] text-ink/80">{c.focus.meaning}</p>
            <p className="mt-2 text-[17px] font-medium text-bad">
              Skipped on {c.focus.missed} of {c.focus.of} calls
            </p>

            {c.tip && (
              <div className="mt-4 rounded-2xl bg-panel p-4">
                <p className="text-[16px] font-medium text-ink/70">Teach them to say</p>
                <p className="mt-1 text-[18px] leading-relaxed">“{c.tip.try_saying}”</p>
                <Link
                  href={`/v2/calls/${c.tip.call_id}${c.tip.start !== null ? `?t=${Math.floor(c.tip.start)}` : ""}`}
                  className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-[16px] font-medium text-link underline underline-offset-2"
                >
                  <PlayIcon className="h-3 w-3" />
                  Hear it on a real call
                  {c.tip.start !== null && ` at ${clock(c.tip.start)}`}
                </Link>
              </div>
            )}

            {first && (
              <p className="mt-4 text-[17px] text-ink/80">
                Start with <span className="font-medium text-ink">{first.rep}</span>, who skipped it on {first.missed}{" "}
                of {first.of} calls.
              </p>
            )}
            <CoachingTexts delivery={c.delivery} waiting={summary?.coaching_waiting ?? []} onChanged={onChanged} />
          </>
        ) : (
          <p className="text-[17px] text-muted">We need a few more calls before we can say.</p>
        )}

      </Card>
    </Section>
  );
}

/**
 * Each person gets their own tip by text, so the owner doesn't have to
 * deliver it. Shows who has opened it and played their clip.
 */
function CoachingTexts({
  delivery,
  waiting,
  onChanged,
}: {
  delivery: NonNullable<Brief["coaching"]>["delivery"];
  waiting: PreparedAction[];
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ready = waiting.filter((a) => a.to_phone);
  async function sendAll() {
    setBusy(true);
    let sent = 0;
    for (const a of ready) {
      try {
        const done = await api.post<PreparedAction>(`/intel/actions/${a.id}/perform`, {});
        if (done.status === "done") sent += 1;
      } catch {
        /* counted below */
      }
    }
    setBusy(false);
    toast(
      sent === ready.length
        ? { message: `Sent ${sent} tip${sent === 1 ? "" : "s"}` }
        : { message: `Sent ${sent} of ${ready.length}. ${failMessage()}`, tone: "error" },
    );
    await onChanged();
  }
  const d = delivery;
  return (
    <div className="mt-4 rounded-2xl border border-line p-4 text-[17px]">
      <p className="font-medium">Each person&apos;s own tip, by text</p>
      {d && d.sent > 0 ? (
        <p className="mt-1 text-ink/80">
          This week: sent to {d.sent}, opened by {d.opened}, {d.listened} listened to their call.
        </p>
      ) : (
        <p className="mt-1 text-ink/80">
          Every Monday, each person can get their one thing to work on and a link to hear it on their own call.
        </p>
      )}
      {ready.length > 0 ? (
        <button className="btn-primary mt-3 min-h-[44px]" disabled={busy} onClick={() => void sendAll()}>
          {busy && <Spinner className="h-4 w-4" />}
          Text {ready.length} {ready.length === 1 ? "person" : "people"} their tip
        </button>
      ) : (
        !d?.sent && (
          <p className="mt-2 text-[16px] text-ink/70">
            To turn this on, press a person&apos;s name above and add their mobile number.
          </p>
        )
      )}
    </div>
  );
}

// --- Everything else, quietly -------------------------------------------------------

export function Footer({ brief }: { brief: Brief }) {
  const bits: React.ReactNode[] = [`${brief.calls.analyzed} calls checked`];
  if (brief.calls.processing) bits.push(`${brief.calls.processing} still being checked`);
  if (brief.calls.failed)
    bits.push(
      <Link key="f" href="/v2/calls?status=failed" className="text-bad hover:underline">
        {brief.calls.failed} could not be read
      </Link>,
    );
  if (brief.review.disputed_calls)
    bits.push(
      <Link key="d" href="/v2/calls?disputed=1" className="text-link hover:underline">
        {brief.review.disputed_calls} call{brief.review.disputed_calls === 1 ? " needs" : "s need"} your decision
      </Link>,
    );
  if (brief.review.type_checks)
    bits.push(
      <Link key="t" href="/v2/calls?review=1" className="text-link hover:underline">
        {brief.review.type_checks} call{brief.review.type_checks === 1 ? "" : "s"} may be the wrong type
      </Link>,
    );
  bits.push(
    <Link key="g" href="/settings" className="hover:text-link hover:underline">
      Change goals
    </Link>,
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-1 pt-4 text-[16px] text-ink/70">
      <p className="flex flex-wrap gap-x-2">
        {bits.map((b, i) => (
          <span key={i}>
            {i > 0 && <span aria-hidden>· </span>}
            {b}
          </span>
        ))}
      </p>
      {brief.receptionist_number && (
        <p className="inline-flex items-center gap-1.5">
          <PhoneIcon className="h-3.5 w-3.5" />
          Your phone receptionist: <a className="text-link hover:underline" href={`tel:${brief.receptionist_number}`}>{brief.receptionist_number}</a>
        </p>
      )}
    </div>
  );
}
