"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApi, useTitle } from "@/lib/hooks";
import type { ActionsSummary, Brief, PreparedAction, Todo } from "@/lib/v2";
import { CheckIcon } from "@/components/icons";
import { Card, Empty, Loading } from "@/components/ui";
import { ActionSheet, KIND_WORDS, handledText } from "@/components/v2/act";
import { MoreToggle, PageError } from "@/components/v2/kit";

/**
 * One job at a time. The page shows the single next thing to do and one big
 * button that does it; when it's done (or skipped) the next one takes its
 * place. Scores and coaching are on the Team page, so there is only one place
 * to look here.
 */
export default function TodayPage() {
  useTitle("Today");
  // Today is about what to do now, whatever period the other pages show.
  const { data, error, status, loading, reload } = useApi<Brief>("/intel/v2/brief");
  const summary = useApi<ActionsSummary>("/intel/actions/summary");
  // Done-for-you extras are optional: an older or partial answer leaves them out.
  const actions = summary.data?.autopilot ? summary.data : null;
  const [acting, setActing] = useState<Todo | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

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
        <Empty title="No calls yet">Go to All calls and add a call recording. This page fills in by itself.</Empty>
      </Card>
    );
  }

  const keyOf = (t: Todo, i: number) => t.key ?? `${t.title}-${i}`;
  const open = data.todo.map((t, i) => ({ t, k: keyOf(t, i) })).filter(({ t }) => !t.handled);
  const waiting = open.filter(({ k }) => !skipped.includes(k));
  const job = waiting[0];
  const position = job ? open.findIndex(({ k }) => k === job.k) + 1 : 0;
  const handled = data.todo.filter((t) => t.handled);

  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <div>
        <h1 className="large-title">Today</h1>
        <p className="mt-2 text-[20px] leading-snug text-ink/80">
          {open.length === 0
            ? "Nothing needs you right now."
            : open.length === 1
              ? "1 thing needs you."
              : `${open.length} things need you. Here's the first one.`}
        </p>
      </div>

      {actions?.practice && (
        <p className="rounded-2xl bg-warn-soft px-5 py-3 text-[16px]">
          <span className="font-semibold">Practice mode:</span> texts go to the{" "}
          <Link href="/v2/outbox" className="font-medium underline underline-offset-2">
            Texts page
          </Link>
          , not to real phones.
        </p>
      )}

      {job ? (
        <Job
          todo={job.t}
          position={position}
          total={open.length}
          onDo={() => setActing(job.t)}
          onSkip={() => setSkipped((s) => [...s, job.k])}
        />
      ) : open.length ? (
        <Card className="px-6 py-8 text-center">
          <p className="text-[20px] font-semibold">You skipped the rest for now.</p>
          <button className="btn-secondary mt-4" onClick={() => setSkipped([])}>
            Show them again
          </button>
        </Card>
      ) : (
        <Card className="flex flex-col items-center px-6 py-10 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-good-soft">
            <CheckIcon className="h-9 w-9 text-good" />
          </span>
          <p className="mt-4 text-[24px] font-semibold">You&apos;re all caught up.</p>
          <p className="mt-1 text-[17px] text-ink/80">New jobs show up here as calls come in.</p>
        </Card>
      )}

      {waiting.length > 1 && <ComingUp items={waiting.slice(1).map(({ t }) => t)} />}

      {handled.length > 0 && <Handled items={handled} />}
      <Autopilot summary={actions} />

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

/** "$588 a year", for the value of a job. */
function perYear(value: number | null | undefined): string | null {
  return value ? `$${Math.round(value).toLocaleString()} a year` : null;
}

/** The one thing to do now: what, why, and a single button. */
function Job({
  todo,
  position,
  total,
  onDo,
  onSkip,
}: {
  todo: Todo;
  position: number;
  total: number;
  onDo: () => void;
  onSkip: () => void;
}) {
  const action = todo.actions?.[0];
  return (
    <section aria-label="Do this next" className="card px-6 py-7 sm:px-8">
      <p className="text-[15px] font-medium text-muted">
        {position} of {total}
      </p>
      <h2 className="mt-2 text-[30px] font-semibold leading-tight tracking-title">{todo.title}</h2>
      <p className="mt-3 text-[19px] leading-relaxed text-ink/90">{todo.why}</p>
      {perYear(todo.value) && (
        <p className="mt-3 text-[19px] font-semibold text-good">Worth {perYear(todo.value)}</p>
      )}
      <div className="mt-7">
        {action ? (
          <button className="btn-primary min-h-[60px] w-full px-8 text-[19px] sm:w-auto" onClick={onDo}>
            {action.label}
          </button>
        ) : (
          <Link href={todo.href} className="btn-primary min-h-[60px] w-full px-8 text-[19px] sm:w-auto">
            Open the call
          </Link>
        )}
      </div>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[17px]">
        {total > 1 && (
          <button className="min-h-[44px] font-medium text-link underline underline-offset-2" onClick={onSkip}>
            Skip for now
          </button>
        )}
        {action && (
          <Link href={todo.href} className="inline-flex min-h-[44px] items-center font-medium text-link underline underline-offset-2">
            Hear the call first
          </Link>
        )}
      </div>
    </section>
  );
}

/** What comes after this one, as plain titles: nothing to press. */
function ComingUp({ items }: { items: Todo[] }) {
  const shown = items.slice(0, 3);
  return (
    <div className="px-1 text-[16px] text-ink/80">
      <p className="font-medium text-ink">After this:</p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((t, i) => (
          <li key={t.key ?? `${t.title}-${i}`}>{t.title}</li>
        ))}
        {items.length > shown.length && <li>and {items.length - shown.length} more</li>}
      </ul>
    </div>
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

