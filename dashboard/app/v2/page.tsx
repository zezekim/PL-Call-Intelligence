"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { clock } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { ActionsSummary, Brief, PerformanceCard, PreparedAction, Todo } from "@/lib/v2";
import { STATUS_SOFT, STATUS_TEXT } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { AlertIcon, CheckIcon, ChevronIcon, PhoneIcon, PlayIcon } from "@/components/icons";
import { Card, Empty, Loading, Spinner } from "@/components/ui";
import { ActionSheet, KIND_WORDS, handledText } from "@/components/v2/act";
import { failMessage, useToast } from "@/components/v2/toast";
import { Change, Meter, MoreToggle, PageError, Section, StatusPill } from "@/components/v2/kit";

export default function OverviewPage() {
  useTitle("Today");
  const { query, refreshKey } = useCalls();
  const { data, error, status, loading, reload } = useApi<Brief>(query("/intel/v2/brief"));
  const summary = useApi<ActionsSummary>("/intel/actions/summary");

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  // Draft the actions for anything new since the last visit, then show them.
  const drafted = useRef(false);
  useEffect(() => {
    if (drafted.current) return;
    drafted.current = true;
    api
      .post("/intel/actions/refresh")
      .then(() => Promise.all([reload(), summary.reload()]))
      .catch(() => undefined);
  }, [reload, summary]);
  const refreshAll = async () => {
    await Promise.all([reload(), summary.reload()]);
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <PageError status={status} onRetry={() => void reload()} />;
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

      <div className="grid gap-4 min-[1180px]:grid-cols-3 min-[1180px]:gap-y-0">
        {[sales, retention, service].map((c) => (
          <Performance key={c.key} card={c} />
        ))}
      </div>

      <div className="grid items-start gap-8 min-[1180px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <DoToday items={data.todo} summary={summary.data} onChanged={refreshAll} />
          <Autopilot summary={summary.data} />
        </div>
        <CoachingFocus brief={data} quality={quality} summary={summary.data} onChanged={refreshAll} />
      </div>

      <Footer brief={data} />
    </div>
  );
}

// --- What's happening ------------------------------------------------------------

function Headline({ brief }: { brief: Brief }) {
  const { status, title, detail, money } = brief.headline;
  const Icon = status === "good" ? CheckIcon : AlertIcon;
  return (
    <div className={`flex gap-4 rounded-card px-6 py-5 ${STATUS_SOFT[status]}`}>
      <Icon className={`mt-1 h-5 w-5 shrink-0 ${STATUS_TEXT[status]}`} />
      <div className="min-w-0">
        <p className="text-[20px] font-semibold leading-snug tracking-title">{title}</p>
        {money && (
          <p className="mt-1.5 max-w-3xl text-[16px] font-semibold leading-snug">
            {money}{" "}
            <Link href="/v2/pipeline" className="whitespace-nowrap text-[14px] font-medium text-link hover:underline">
              See who
            </Link>
          </p>
        )}
        {detail && <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-ink/80">{detail}</p>}
      </div>
    </div>
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
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-[15px] font-semibold tracking-tightish" title={card.question}>
          {card.label}
        </p>
        <span className="shrink-0">
          <StatusPill status={card.status} />
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className={`tnum whitespace-nowrap text-[40px] font-semibold leading-none tracking-title ${STATUS_TEXT[card.status]}`}>
          {card.of ? `${card.count} of ${card.of}` : "–"}
        </span>
        <span className="text-[15px] font-medium text-ink/80">{card.metric_label.toLowerCase()}</span>
        <Change value={card.change} />
      </div>
      <div className="mt-3 w-full self-start">
        <Meter value={card.value} target={card.target} status={card.status} label={card.metric_label} />
      </div>
      <p className="mt-1.5 text-[12px] text-muted" title={card.detail}>
        {card.goal}
      </p>

      <p className="mt-4 border-t border-line pt-3 text-[14px] leading-snug">{card.why}</p>
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

const TOP = 3;

/** "$588 a year", for the value of a to-do. */
function perYear(value: number | null | undefined): string | null {
  return value ? `$${Math.round(value).toLocaleString()} a year` : null;
}

/**
 * The top three get full rows with the action ready to send; the rest wait
 * one tap away, one line each. Done items sink to the bottom showing what
 * was done, so the work is seen to happen.
 */
function DoToday({
  items,
  summary,
  onChanged,
}: {
  items: Todo[];
  summary: ActionsSummary | null;
  onChanged: () => Promise<void>;
}) {
  const [all, setAll] = useState(false);
  const [acting, setActing] = useState<Todo | null>(null);
  const open = items.filter((t) => !t.handled);
  const handled = items.filter((t) => t.handled);
  const shown = all ? open : open.slice(0, TOP);
  return (
    <Section title="Do these first" subtitle="The most important one is at the top. Each one is ready to send.">
      {open.length ? (
        <>
          <ol className="group-list">
            {shown.map((t, i) =>
              i < TOP ? (
                <li key={t.key ?? `${t.title}-${i}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
                  <Link href={t.href} className="group flex min-w-0 flex-1 items-start gap-4">
                    <span
                      className={`tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
                        i === 0 ? "bg-bad text-white" : "bg-fill text-ink"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium leading-snug group-hover:underline">
                        {t.title}
                        {perYear(t.value) && (
                          <span className="ml-2 whitespace-nowrap rounded-full bg-good-soft px-2 py-0.5 text-[12px] font-semibold text-good">
                            {perYear(t.value)}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-snug text-muted">{t.why}</p>
                    </div>
                  </Link>
                  {t.actions?.length ? (
                    <button
                      className="btn-primary min-h-[44px] shrink-0 self-start pl-4 sm:ml-10"
                      onClick={() => setActing(t)}
                    >
                      {t.actions[0].label}
                    </button>
                  ) : null}
                </li>
              ) : (
                <li key={t.key ?? `${t.title}-${i}`}>
                  <button
                    onClick={() => (t.actions?.length ? setActing(t) : undefined)}
                    className="flex w-full items-center gap-4 px-5 py-2.5 text-left text-[14px] transition-colors hover:bg-surface-hover"
                  >
                    <span className="tnum w-6 shrink-0 text-center text-[12px] text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="hidden shrink-0 text-[12px] text-muted sm:block">
                      {t.actions?.[0]?.label ?? KIND_LABEL[t.kind]}
                    </span>
                    <ChevronIcon className="h-4 w-4 shrink-0 text-faint" />
                  </button>
                </li>
              ),
            )}
          </ol>
          {open.length > TOP && (
            <MoreToggle
              className="mt-2.5 px-1"
              open={all}
              onToggle={() => setAll((a) => !a)}
              count={open.length - TOP}
            />
          )}
        </>
      ) : (
        <Card className="flex items-center gap-3 px-5 py-4">
          <CheckIcon className="h-5 w-5 text-good" />
          <p className="text-[15px]">You're all caught up. Nothing needs you today.</p>
        </Card>
      )}
      {handled.length > 0 && <Handled items={handled} />}
      {acting && (
        <ActionSheet
          open={!!acting}
          title={acting.title}
          options={acting.actions ?? []}
          summary={summary}
          onClose={() => setActing(null)}
          onDone={onChanged}
        />
      )}
    </Section>
  );
}

/** What was done in the last few days, and what customers said back. */
function Handled({ items }: { items: Todo[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 3);
  return (
    <div className="mt-4">
      <p className="mb-1.5 px-1 text-[13px] font-semibold text-good">Done</p>
      <ul className="group-list">
        {shown.map((t) => {
          const a = t.handled as PreparedAction;
          return (
            <li key={t.key ?? t.title} className="flex items-start gap-3 px-5 py-3">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good" />
              <div className="min-w-0 flex-1 text-[14px]">
                <Link href={t.href} className="text-muted line-through decoration-ink/20 hover:text-ink hover:no-underline">
                  {t.title}
                </Link>
                <p className="text-[13px] text-ink/80">{handledText(a)}</p>
                {a.reply_text && (
                  <p className="mt-1.5 rounded-xl bg-accent-soft/60 px-3 py-2 text-[14px]">
                    <span className="font-medium">{a.to_name ?? "They"} replied:</span> “{a.reply_text}”
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > 3 && (
        <MoreToggle className="mt-2 px-1" open={all} onToggle={() => setAll((x) => !x)} count={items.length - 3} />
      )}
    </div>
  );
}

/** One line saying what runs by itself, so nothing happens behind the owner's back. */
function Autopilot({ summary }: { summary: ActionsSummary | null }) {
  if (!summary) return null;
  const on = (Object.keys(summary.autopilot) as PreparedAction["kind"][]).filter((k) => summary.autopilot[k]);
  const auto = summary.done_today.filter((a) => a.auto).length;
  return (
    <p className="px-1 text-[13px] text-muted">
      {on.length ? (
        <>
          <span className="font-medium text-ink">Autopilot is on</span> for {on.map((k) => KIND_WORDS[k].many).join(" and ")}
          {auto ? `: ${auto} sent today.` : "."}{" "}
        </>
      ) : (
        <>Want these done without asking? </>
      )}
      <Link href="/settings#autopilot" className="text-link hover:underline">
        {on.length ? "Change" : "Turn on autopilot"}
      </Link>
    </p>
  );
}

// --- What to coach -----------------------------------------------------------------

function CoachingFocus({
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
    <Section title="What to teach this week" subtitle="The one step that would help the most calls.">
      <Card className="p-5">
        {c ? (
          <>
            <p className="text-[20px] font-semibold leading-tight tracking-title">{c.focus.plain}</p>
            <p className="mt-0.5 text-[14px] text-ink/80">{c.focus.meaning}</p>
            <p className="mt-2 text-[14px] font-medium text-bad">
              Skipped on {c.focus.missed} of {c.focus.of} calls
            </p>

            {c.tip && (
              <div className="mt-4 rounded-2xl bg-panel p-4">
                <p className="text-[12px] font-medium text-muted">Teach them to say</p>
                <p className="mt-1 text-[15px] leading-relaxed">“{c.tip.try_saying}”</p>
                <Link
                  href={`/v2/calls/${c.tip.call_id}${c.tip.start !== null ? `?t=${Math.floor(c.tip.start)}` : ""}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-link hover:underline"
                >
                  <PlayIcon className="h-3 w-3" />
                  Hear the real call
                  {c.tip.start !== null && ` at ${clock(c.tip.start)}`}
                </Link>
              </div>
            )}

            {first && (
              <p className="mt-4 text-[13px] text-muted">
                Start with <span className="font-medium text-ink">{first.rep}</span>, who skipped it on {first.missed}{" "}
                of {first.of} calls.
              </p>
            )}
            <CoachingTexts delivery={c.delivery} waiting={summary?.coaching_waiting ?? []} onChanged={onChanged} />
          </>
        ) : (
          <p className="text-[14px] text-muted">We need a few more calls before we can say.</p>
        )}

        {quality.value !== null && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-muted">
            <span>Overall, calls follow about {Math.round(quality.value / 10)} of 10 steps</span>
            <StatusPill status={quality.status} />
          </div>
        )}
        {c?.strength && (
          <p className="mt-2 flex items-start gap-2 text-[13px] text-muted">
            <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
            <span>
              Strongest step: <span className="text-ink">{c.strength.plain}</span> ({c.strength.met} of{" "}
              {c.strength.of} calls)
            </span>
          </p>
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
    <div className="mt-4 rounded-2xl border border-line p-4 text-[14px]">
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
          <p className="mt-2 text-[13px] text-muted">
            Add a mobile number on each person&apos;s page on{" "}
            <Link href="/v2/reps" className="text-link hover:underline">
              Team
            </Link>{" "}
            to turn this on.
          </p>
        )
      )}
    </div>
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
  if (brief.accuracy) {
    const a = brief.accuracy;
    bits.push(
      <span
        key="a"
        title={`Of ${a.steps} step marks the AI made on calls a manager corrected, ${a.kept} were kept. Calls a manager read without changing anything aren't counted, so the real figure is at least this.`}
      >
        Managers kept {Math.round(a.pct)}% of the AI's step marks ({a.calls} call{a.calls === 1 ? "" : "s"} corrected)
      </span>,
    );
  }
  bits.push(
    <Link key="g" href="/settings" className="hover:text-link hover:underline">
      Change goals
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
