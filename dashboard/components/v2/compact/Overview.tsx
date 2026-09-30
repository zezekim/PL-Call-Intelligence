"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clock } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { Brief, PerformanceCard, Todo } from "@/lib/v2";
import { STATUS_SOFT, STATUS_TEXT, rateStatus } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { AlertIcon, CheckIcon, ChevronIcon, PhoneIcon, PlayIcon } from "@/components/icons";
import { Card, Empty, ErrorNote, Loading } from "@/components/ui";
import { Change, Meter, Section, StatusPill } from "@/components/v2/compact/kit";

export function OverviewCompact() {
  useTitle("Today");
  const { query, refreshKey } = useCalls();
  const { data, error, loading, reload } = useApi<Brief>(query("/intel/v2/brief"));

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;
  if (!data.calls.analyzed) {
    return (
      <Card>
        <Empty title="No calls yet">Press Upload to add call recordings. This page fills in by itself.</Empty>
      </Card>
    );
  }

  const [sales, retention, service, quality] = data.cards;

  return (
    <div className="space-y-8">
      <Headline brief={data} />

      <div className="grid gap-4 xl:grid-cols-3 xl:gap-y-0">
        {[sales, retention, service].map((c) => (
          <Performance key={c.key} card={c} />
        ))}
      </div>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <DoToday items={data.todo} total={data.todo_total} />
        <CoachingFocus brief={data} quality={quality} />
      </div>

      <Footer brief={data} />
    </div>
  );
}

// --- What's happening ------------------------------------------------------------

function Headline({ brief }: { brief: Brief }) {
  const { status, title, detail } = brief.headline;
  const Icon = status === "good" ? CheckIcon : AlertIcon;
  return (
    <div className={`flex gap-4 rounded-card px-6 py-5 ${STATUS_SOFT[status]}`}>
      <Icon className={`mt-1 h-5 w-5 shrink-0 ${STATUS_TEXT[status]}`} />
      <div className="min-w-0">
        <p className="text-[20px] font-semibold leading-snug tracking-title">{title}</p>
        {detail && <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-ink/80">{detail}</p>}
      </div>
    </div>
  );
}

/*
 * The three cards share their row heights (CSS subgrid), so the numbers, bars
 * and links line up across them however long each card's wording is.
 */
function Performance({ card }: { card: PerformanceCard }) {
  return (
    <Card className="flex flex-col p-5 xl:row-span-7 xl:grid xl:grid-rows-subgrid xl:gap-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tightish">{card.label}</p>
          <p className="text-[13px] text-muted">{card.question}</p>
        </div>
        <span className="shrink-0">
          <StatusPill status={card.status} />
        </span>
      </div>

      <div className="mt-5 flex items-baseline gap-2">
        <span className={`tnum whitespace-nowrap text-[40px] font-semibold leading-none tracking-title ${STATUS_TEXT[card.status]}`}>
          {card.of ? `${card.count} of ${card.of}` : "–"}
        </span>
        <span className="text-[15px] font-medium text-ink/80">{card.metric_label.toLowerCase()}</span>
        <Change value={card.change} />
      </div>
      <p className="mt-1 text-[13px] text-muted">{card.goal}</p>
      <div className="mt-3 w-full self-start">
        <Meter value={card.value} target={card.target} status={card.status} label={card.metric_label} />
      </div>
      <p className="tnum mt-3 text-[13px] text-muted">{card.detail}</p>

      <div className="mt-4 border-t border-line pt-3">
        <p className="text-[14px] leading-snug">{card.why}</p>
      </div>
      {card.action ? (
        <Link
          href={card.action.href}
          className="mt-3 inline-flex items-center gap-1 self-start text-[14px] font-medium text-link hover:underline"
        >
          {card.action.label}
          <ChevronIcon className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span aria-hidden />
      )}
    </Card>
  );
}

// --- What to do next -------------------------------------------------------------

const KIND_LABEL: Record<Todo["kind"], string> = {
  retention: "Cancelled",
  sales: "Call back",
  service: "Problem",
  follow_up: "Promise",
};

const TOP = 5;

function DoToday({ items, total }: { items: Todo[]; total: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, TOP);
  const hidden = total - shown.length;
  return (
    <Section
      title="Do these first"
      subtitle="The most important one is at the top."
      action={
        items.length > TOP ? (
          <button className="text-[13px] text-link hover:underline" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show ${hidden} more`}
          </button>
        ) : undefined
      }
    >
      {shown.length ? (
        <ol className="group-list">
          {shown.map((t, i) => (
            <li key={`${t.title}-${i}`}>
              <Link href={t.href} className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-hover">
                <span
                  className={`tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
                    i === 0 ? "bg-bad text-white" : "bg-fill text-ink"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium leading-snug">{t.title}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted">{t.why}</p>
                </div>
                <span className="mt-0.5 hidden shrink-0 text-[12px] text-muted sm:block">{KIND_LABEL[t.kind]}</span>
                <ChevronIcon className="mt-1 h-4 w-4 shrink-0 text-faint" />
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <Card className="flex items-center gap-3 px-5 py-4">
          <CheckIcon className="h-5 w-5 text-good" />
          <p className="text-[15px]">Nothing needs you today.</p>
        </Card>
      )}
    </Section>
  );
}

// --- What to coach -----------------------------------------------------------------

function CoachingFocus({ brief, quality }: { brief: Brief; quality: PerformanceCard }) {
  const c = brief.coaching;
  return (
    <Section title="What to teach this week" subtitle="One step that would help the most calls.">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted">Following the call steps</p>
          <StatusPill status={quality.status} label={`Does about ${Math.round((quality.value ?? 0) / 10)} of 10 steps`} />
        </div>
        <p className="mt-1 text-[13px] text-muted">{quality.detail}</p>

        {c ? (
          <>
            <div className="mt-5 border-t border-line pt-5">
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted">Practise this step</p>
              <p className="mt-1 text-[20px] font-semibold leading-tight tracking-title">{c.focus.plain}</p>
              <p className="mt-0.5 text-[14px] text-ink/80">{c.focus.meaning}</p>
              <p className="mt-1 text-[14px]">
                <span className="font-semibold text-bad">Skipped on {c.focus.missed} of {c.focus.of} calls.</span>
              </p>
              <div className="mt-3">
                <Meter value={c.focus.hit_rate} target={80} status={rateStatus(c.focus.hit_rate)} label="Done rate" />
              </div>
            </div>

            {c.tip && (
              <div className="mt-5 rounded-2xl bg-panel p-4">
                <p className="text-[12px] font-medium text-muted">Teach them to say</p>
                <p className="mt-1 text-[15px] leading-relaxed">“{c.tip.try_saying}”</p>
                <Link
                  href={`/v2/calls/${c.tip.call_id}${c.tip.start !== null ? `?t=${Math.floor(c.tip.start)}` : ""}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-link hover:underline"
                >
                  <PlayIcon className="h-3 w-3" />
                  Hear it on a real call: {c.tip.rep ?? "team member"} with {c.tip.customer ?? "a customer"}
                  {c.tip.start !== null && ` at ${clock(c.tip.start)}`}
                </Link>
              </div>
            )}

            {c.reps.length > 0 && (
              <p className="mt-4 text-[13px] leading-relaxed text-muted">
                <span className="font-medium text-ink">Start with </span>
                {c.reps
                  .slice(0, 3)
                  .map((r) => `${r.rep} (skipped ${r.missed} of ${r.of})`)
                  .join(", ")}
                .
              </p>
            )}

            {c.strength && (
              <div className="mt-4 flex items-start gap-2.5 border-t border-line pt-4 text-[14px]">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good" />
                <p>
                  <span className="font-medium">The team is good at:</span> {c.strength.plain}, done on{" "}
                  {c.strength.met} of {c.strength.of} calls.
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="mt-4 text-[14px] text-muted">We need a few more calls before we can say.</p>
        )}
      </Card>
    </Section>
  );
}

// --- Everything else, quietly -------------------------------------------------------

function Footer({ brief }: { brief: Brief }) {
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
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-1 pt-4 text-[13px] text-muted">
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
          AI receptionist: <a className="text-link hover:underline" href={`tel:${brief.receptionist_number}`}>{brief.receptionist_number}</a>
        </p>
      )}
    </div>
  );
}
