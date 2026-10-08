"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { clock, date } from "@/lib/format";
import { CALL_TYPE_PLAIN, GRADE_PLAIN, OUTCOME_PLAIN } from "@/lib/easy";
import { useApi, useTitle } from "@/lib/hooks";
import type { RepBrief, StepStat } from "@/lib/v2";
import { STATUS_TEXT, personName, rateStatus } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { BackIcon, CheckIcon, ChevronIcon, CrossIcon, PlayIcon } from "@/components/icons";
import { Avatar, Card } from "@/components/ui";
import { Meter, PageError, PersonSkeleton, StatusPill, Trend } from "@/components/v2/kit";
import type { Grade } from "@/lib/api";

export default function RepPage() {
  const { id } = useParams<{ id: string }>();
  const { query, refreshKey } = useCalls();
  const { data: rep, error, status, loading, reload } = useApi<RepBrief>(query(`/intel/v2/reps/${id}`));
  useTitle(rep?.name ?? "Team");
  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !rep) return <PersonSkeleton />;
  if (error && !rep) {
    return (
      <PageError status={status} thing="person" onRetry={() => void reload()} back={{ href: "/v2/reps", label: "Back to Team" }} />
    );
  }
  if (!rep) return null;

  return (
    <div className="space-y-6">
      <Link href="/v2/reps" className="-ml-1 inline-flex items-center gap-0.5 text-[15px] text-link hover:underline">
        <BackIcon className="h-4 w-4" /> Team
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <Avatar name={rep.name} size={52} />
            <div className="min-w-0">
              <h1 className="text-[28px] font-semibold leading-tight tracking-title">{rep.name}</h1>
              <p className="mt-2 max-w-2xl text-[16px] leading-relaxed">{rep.verdict}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className={`tnum text-[44px] font-semibold leading-none tracking-title ${STATUS_TEXT[rep.status]}`}>
              {rep.score === null ? "–" : `${Math.round(rep.score)}%`}
            </p>
            <p className="mt-1 text-[12px] text-muted">
              of call steps done
              {rep.team_score !== null && ` · team ${Math.round(rep.team_score)}%`}
            </p>
            <div className="mt-2 flex justify-end">
              <Trend trend={rep.trend} />
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4 text-[14px]">
          <Fact label="Calls checked" value={String(rep.scored)} />
          <Fact label="Good calls" value={`${rep.meeting_standard} of ${rep.scored}`} />
          <Fact
            label="New customers won"
            value={rep.close_rate === null ? "–" : `${Math.round(rep.close_rate)}%`}
            hint={rep.sales_calls ? `out of ${rep.sales_calls} call${rep.sales_calls === 1 ? "" : "s"}` : "No calls from new customers"}
          />
        </div>
      </Card>

      {/* One step to teach, why, and the words to use: the same shape as Today. */}
      <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <Heading tone="bad" title="Teach next" />
          {rep.focus ? (
            <div className="mt-3">
              <p className="text-[20px] font-semibold leading-tight tracking-title">{rep.focus.plain}</p>
              <p className="mt-0.5 text-[14px] text-ink/80">{rep.focus.meaning}</p>
              <p className="mt-1 text-[14px] font-semibold text-bad">
                Skipped on {rep.focus.missed} of {rep.focus.of} calls
              </p>
              <div className="mt-3 max-w-sm">
                <Meter value={rep.focus.hit_rate} target={80} status={rateStatus(rep.focus.hit_rate)} label="Done rate" />
              </div>
              <p className="mt-1.5 text-[12px] text-muted">Goal: do it on 8 out of 10 calls.</p>
              {rep.coach && (
                <div className="mt-4 rounded-2xl bg-panel p-4">
                  {rep.coach.what_happened && (
                    <p className="text-[14px] leading-relaxed text-ink/80">{rep.coach.what_happened}</p>
                  )}
                  <p className="mt-2 text-[12px] font-medium text-muted">Next time, say</p>
                  <p className="mt-1 text-[15px] leading-relaxed">“{rep.coach.try_saying}”</p>
                  <Link
                    href={`/v2/calls/${rep.coach.call_id}${rep.coach.start !== null ? `?t=${Math.floor(rep.coach.start)}` : ""}`}
                    className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-link hover:underline"
                  >
                    <PlayIcon className="h-3 w-3" />
                    Listen together: call with {personName(rep.coach.customer) ?? "a customer"}
                    {rep.coach.start !== null && ` at ${clock(rep.coach.start)}`}
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-[14px] text-muted">Nothing stands out to teach right now.</p>
          )}
        </Card>

        <Card className="p-5">
          <Heading tone="good" title="Good at" />
          {rep.strengths.length ? (
            <ul className="mt-3 space-y-3">
              {rep.strengths.map((s) => (
                <StepLine key={s.step} step={s} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[14px] text-muted">No step is done well every time yet.</p>
          )}
          {rep.strength_example && (
            <Link
              href={`/v2/calls/${rep.strength_example.call_id}${rep.strength_example.start !== null ? `?t=${Math.floor(rep.strength_example.start)}` : ""}`}
              className="mt-4 block rounded-2xl bg-good-soft p-4 transition hover:brightness-[0.98]"
            >
              <p className="text-[14px] font-medium">{rep.strength_example.title}</p>
              {rep.strength_example.quote && (
                <p className="mt-1 text-[14px] leading-relaxed">“{rep.strength_example.quote}”</p>
              )}
              <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-link">
                <PlayIcon className="h-2.5 w-2.5" /> Hear it
                {rep.strength_example.start !== null && ` at ${clock(rep.strength_example.start)}`}
              </p>
            </Link>
          )}
        </Card>

      </div>

      <RecentCalls rep={rep} />
      <AllSteps steps={rep.steps} />
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="tnum mt-0.5 text-[17px] font-semibold">{value}</p>
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

function Heading({ tone, title }: { tone: "good" | "bad"; title: string }) {
  const cls = { good: "bg-good", bad: "bg-bad" }[tone];
  const Icon = tone === "good" ? CheckIcon : CrossIcon;
  return (
    <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-title">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-white ${cls}`}>
        <Icon className="h-3 w-3" />
      </span>
      {title}
    </h2>
  );
}

function StepLine({ step }: { step: StepStat }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="font-medium">{step.plain}</span>
        <span className="tnum text-muted">
          done on {step.met} of {step.of}
        </span>
      </div>
      <div className="mt-1.5">
        <Meter value={step.hit_rate} status={rateStatus(step.hit_rate)} label={step.plain} />
      </div>
    </li>
  );
}

function RecentCalls({ rep }: { rep: RepBrief }) {
  const calls = rep.calls_list.slice(0, 5);
  if (!calls.length) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="text-[19px] font-semibold tracking-title">Recent calls</h2>
        {rep.calls_list.length > calls.length && (
          <Link href={`/v2/calls?rep=${rep.id}&who=${encodeURIComponent(rep.name)}`} className="text-[13px] font-medium text-link hover:underline">
            See all {rep.calls_list.length}
          </Link>
        )}
      </div>
      <ul className="group-list">
        {calls.map((c) => (
          <li key={c.call_id}>
            <Link href={`/v2/calls/${c.call_id}`} className="flex items-center gap-4 px-5 py-3 text-[14px] transition-colors hover:bg-surface-hover">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{personName(c.customer) ?? "Customer not named"}</span>
                <span className="text-muted">
                  {" "}
                  · {CALL_TYPE_PLAIN[c.call_type] ?? c.call_type} · {date(c.when)}
                  {c.outcome && c.outcome !== "not_applicable" && ` · ${OUTCOME_PLAIN[c.outcome] ?? c.outcome}`}
                </span>
              </span>
              {c.grade && (
                <StatusPill
                  status={c.grade === "below" ? "bad" : "good"}
                  label={GRADE_PLAIN[c.grade as Grade]}
                />
              )}
              <ChevronIcon className="h-4 w-4 text-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AllSteps({ steps }: { steps: StepStat[] }) {
  // The detail behind the three cards above: there when wanted.
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <section>
      <button className="flex w-full items-center justify-between px-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          <span className="text-[19px] font-semibold tracking-title">Every step</span>
          <span className="ml-2 text-[13px] text-muted">How often each step of the call is done.</span>
        </span>
        <ChevronIcon className={`h-4 w-4 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <Card className="mt-3 p-5">
          <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {steps.map((s) => (
              <StepLine key={s.step} step={s} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
