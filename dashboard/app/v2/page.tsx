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
import { Meter, MoreToggle, PageError, Section, StatusPill } from "@/components/v2/kit";

export default function OverviewPage() {
  useTitle("Today");
  const { query, refreshKey } = useCalls();
  const { data, error, status, loading, reload } = useApi<Brief>(query("/intel/v2/brief"));
  const summary = useApi<ActionsSummary>("/intel/actions/summary");
  // Done-for-you extras are optional: an older or partial answer leaves them out.
  const actions = summary.data?.autopilot ? summary.data : null;

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
  const [acting, setActing] = useState<Todo | null>(null);

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
  const first = data.todo.find((t) => !t.handled && t.actions?.length);

  return (
    <div className="space-y-10">
      {actions?.practice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warn-soft px-5 py-4 text-[16px]">
          <p>
            <span className="font-semibold">Practice mode is on.</span> Texts go to the Texts page instead of people&apos;s phones.
          </p>
          <Link href="/v2/outbox" className="btn-secondary">
            See the texts
          </Link>
        </div>
      )}
      <Headline brief={data} first={first} onStart={() => first && setActing(first)} />

      <DoToday items={data.todo} onAct={setActing} />
      <Autopilot summary={actions} />

      <Section title="How it's going" subtitle="Green is good. Red needs work.">
        <div className="grid gap-4 min-[1180px]:grid-cols-3 min-[1180px]:gap-y-0">
          {[sales, retention, service].map((c) => (
            <Performance key={c.key} card={c} />
          ))}
        </div>
      </Section>

      <CoachingFocus brief={data} quality={quality} summary={actions} onChanged={refreshAll} />

      <Footer brief={data} />

      {acting && (
        <ActionSheet
          open={!!acting}
          title={acting.title}
          options={acting.actions ?? []}
          summary={actions}
          onClose={() => setActing(null)}
          onDone={refreshAll}
        />
      )}
    </div>
  );
}

// --- What's happening ------------------------------------------------------------

function Headline({ brief, first, onStart }: { brief: Brief; first?: Todo; onStart: () => void }) {
  const { status, title, money } = brief.headline;
  const Icon = status === "good" ? CheckIcon : AlertIcon;
  return (
    <div className={`rounded-card px-6 py-6 ${STATUS_SOFT[status]}`}>
      <div className="flex gap-4">
        <Icon className={`mt-1 h-7 w-7 shrink-0 ${STATUS_TEXT[status]}`} />
        <div className="min-w-0">
          <p className="text-[24px] font-semibold leading-snug tracking-title">{title}</p>
          {money && (
            <p className="mt-2 max-w-3xl text-[18px] leading-snug">
              {money}{" "}
              <Link href="/v2/pipeline" className="whitespace-nowrap font-medium text-link underline underline-offset-2">
                See who
              </Link>
            </p>
          )}
        </div>
      </div>
      {first?.actions?.length ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 sm:pl-11">
          <button className="btn-primary min-h-[52px] px-7 text-[17px]" onClick={onStart}>
            Start here: {first.actions[0].label}
          </button>
          <span className="text-[15px] text-ink/80">{first.title}</span>
        </div>
      ) : null}
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
        <span className="text-[17px] font-medium text-ink/80">{card.metric_label.toLowerCase()}</span>
      </div>
      <div className="mt-3 w-full self-start">
        <Meter value={card.value} target={card.target} status={card.status} label={card.metric_label} />
      </div>
      <p className="mt-2 text-[14px] text-muted" title={card.detail}>
        {card.goal}
      </p>

      <p className="mt-4 border-t border-line pt-3 text-[16px] leading-snug">{card.why}</p>
      {card.action ? (
        <Link
          href={card.action.href}
          className="mt-3 inline-flex min-h-[40px] items-center gap-1 self-start text-[16px] font-medium text-link underline underline-offset-2"
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
function DoToday({ items, onAct }: { items: Todo[]; onAct: (t: Todo) => void }) {
  const [all, setAll] = useState(false);
  const open = items.filter((t) => !t.handled);
  const handled = items.filter((t) => t.handled);
  const shown = all ? open : open.slice(0, TOP);
  return (
    <Section title="Do these first" subtitle="Each one is ready to go. Press the blue button.">
      {open.length ? (
        <>
          <ol className="group-list">
            {shown.map((t, i) =>
              i < TOP ? (
                <li key={t.key ?? `${t.title}-${i}`} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
                  <Link href={t.href} className="group flex min-w-0 flex-1 items-start gap-4">
                    <span
                      className={`tnum flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[17px] font-semibold ${
                        i === 0 ? "bg-bad text-white" : "bg-fill text-ink"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[18px] font-semibold leading-snug group-hover:underline">
                        {t.title}
                        {perYear(t.value) && (
                          <span className="ml-2 whitespace-nowrap rounded-full bg-good-soft px-2.5 py-0.5 align-middle text-[14px] font-semibold text-good">
                            {perYear(t.value)}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-[16px] leading-snug text-ink/80">{t.why}</p>
                    </div>
                  </Link>
                  {t.actions?.length ? (
                    <button
                      className="btn-primary min-h-[48px] shrink-0 self-start px-6 text-[16px] sm:ml-0 sm:self-center"
                      onClick={() => onAct(t)}
                    >
                      {t.actions[0].label}
                    </button>
                  ) : null}
                </li>
              ) : (
                <li key={t.key ?? `${t.title}-${i}`}>
                  <button
                    onClick={() => (t.actions?.length ? onAct(t) : undefined)}
                    className="flex min-h-[56px] w-full items-center gap-4 px-5 py-3 text-left text-[16px] transition-colors hover:bg-surface-hover"
                  >
                    <span className="tnum w-9 shrink-0 text-center text-[15px] text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1">{t.title}</span>
                    <span className="hidden shrink-0 text-[15px] font-medium text-link sm:block">
                      {t.actions?.[0]?.label ?? KIND_LABEL[t.kind]}
                    </span>
                    <ChevronIcon className="h-5 w-5 shrink-0 text-muted" />
                  </button>
                </li>
              ),
            )}
          </ol>
          {open.length > TOP && (
            <button className="btn-secondary mt-3 w-full sm:w-auto" aria-expanded={all} onClick={() => setAll((a) => !a)}>
              {all ? "Show less" : `Show ${open.length - TOP} more`}
            </button>
          )}
        </>
      ) : (
        <Card className="flex items-center gap-3 px-5 py-5">
          <CheckIcon className="h-6 w-6 text-good" />
          <p className="text-[17px]">You&apos;re all caught up. Nothing needs you today.</p>
        </Card>
      )}
      {handled.length > 0 && <Handled items={handled} />}
    </Section>
  );
}

/** What was done in the last few days, and what customers said back. */
function Handled({ items }: { items: Todo[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 3);
  return (
    <div className="mt-4">
      <p className="mb-1.5 px-1 text-[15px] font-semibold text-good">Done</p>
      <ul className="group-list">
        {shown.map((t) => {
          const a = t.handled as PreparedAction;
          return (
            <li key={t.key ?? t.title} className="flex items-start gap-3 px-5 py-3">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good" />
              <div className="min-w-0 flex-1 text-[16px]">
                <Link href={t.href} className="text-muted line-through decoration-ink/20 hover:text-ink hover:no-underline">
                  {t.title}
                </Link>
                <p className="text-[15px] text-ink/80">{handledText(a)}</p>
                {a.reply_text && (
                  <p className="mt-1.5 rounded-xl bg-accent-soft/60 px-3 py-2 text-[16px]">
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
    <p className="px-1 text-[15px] text-muted">
      {on.length ? (
        <>
          <span className="font-medium text-ink">Autopilot is on</span> for {on.map((k) => KIND_WORDS[k].many).join(" and ")}
          {auto ? `: ${auto} sent today.` : "."}{" "}
        </>
      ) : (
        <>Want these done without asking? </>
      )}
      <Link href="/settings#autopilot" className="text-link underline underline-offset-2">
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
    <Section title="What to teach this week" subtitle="One thing. It would help the most calls.">
      <Card className="p-5">
        {c ? (
          <>
            <p className="text-[24px] font-semibold leading-tight tracking-title">{c.focus.plain}</p>
            <p className="mt-0.5 text-[16px] text-ink/80">{c.focus.meaning}</p>
            <p className="mt-2 text-[16px] font-medium text-bad">
              Skipped on {c.focus.missed} of {c.focus.of} calls
            </p>

            {c.tip && (
              <div className="mt-4 rounded-2xl bg-panel p-4">
                <p className="text-[14px] font-medium text-muted">Teach them to say</p>
                <p className="mt-1 text-[17px] leading-relaxed">“{c.tip.try_saying}”</p>
                <Link
                  href={`/v2/calls/${c.tip.call_id}${c.tip.start !== null ? `?t=${Math.floor(c.tip.start)}` : ""}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-[15px] font-medium text-link hover:underline"
                >
                  <PlayIcon className="h-3 w-3" />
                  Hear it on a real call
                  {c.tip.start !== null && ` at ${clock(c.tip.start)}`}
                </Link>
              </div>
            )}

            {first && (
              <p className="mt-4 text-[15px] text-muted">
                Start with <span className="font-medium text-ink">{first.rep}</span>, who skipped it on {first.missed}{" "}
                of {first.of} calls.
              </p>
            )}
            <CoachingTexts delivery={c.delivery} waiting={summary?.coaching_waiting ?? []} onChanged={onChanged} />
          </>
        ) : (
          <p className="text-[16px] text-muted">We need a few more calls before we can say.</p>
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
    <div className="mt-4 rounded-2xl border border-line p-4 text-[16px]">
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
          <p className="mt-2 text-[15px] text-muted">
            Add a mobile number on each person&apos;s page on{" "}
            <Link href="/v2/reps" className="text-link underline underline-offset-2">
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-1 pt-4 text-[15px] text-muted">
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
