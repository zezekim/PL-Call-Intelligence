"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CALL_TYPE_PLAIN, GRADE_PLAIN, OUTCOME_PLAIN, plural } from "@/lib/easy";
import { date } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { RepBrief, StepStat } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { Avatar, ErrorNote, Loading } from "@/components/ui";
import { BigLink, GoalBar, Panel, Reveal, Section, StatusBadge, StatusIcon } from "@/components/v2/kit";

const FEW_CALLS = 3;

export function RepEasy() {
  const { id } = useParams<{ id: string }>();
  const { query } = useCalls();
  const { data: rep, error, loading } = useApi<RepBrief>(query(`/intel/v2/reps/${id}`));
  useTitle(rep?.name ?? null);

  if (loading && !rep) return <Loading />;
  if (error && !rep) return <ErrorNote message={error} />;
  if (!rep) return null;
  const tens = Math.round((rep.score ?? 0) / 10);
  const early = rep.scored < FEW_CALLS;

  return (
    <div className="space-y-12">
      <BigLink href="/v2/reps" kind="secondary">
        ← Back to the team
      </BigLink>

      <header className="flex flex-wrap items-start gap-6">
        <Avatar name={rep.name} size={80} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[40px] font-bold leading-tight tracking-title">{rep.name}</h1>
          <p className="mt-3 max-w-3xl text-[22px] leading-relaxed">{rep.verdict}</p>
          <div className="mt-4">
            <StatusBadge large status={early ? "none" : rep.status} label={`Does ${tens} out of 10 steps`} />
          </div>
        </div>
      </header>

      <Section title="What to teach" intro="One thing at a time works best.">
        <Panel>
          {rep.focus ? (
            <>
              <p className="text-[18px] font-semibold text-ink/80">Practise this step</p>
              <p className="mt-1 text-[32px] font-bold leading-tight tracking-title">{rep.focus.plain}</p>
              <p className="mt-2 text-[20px] leading-relaxed">{rep.focus.meaning}</p>
              <p className="mt-3 inline-flex items-center gap-2 text-[20px] font-semibold">
                <StatusIcon status="bad" size={22} />
                Skipped on {rep.focus.missed} of {plural(rep.focus.of, "call")}
              </p>
              {rep.coach && (
                <div className="mt-6 rounded-[18px] bg-panel p-6">
                  <p className="text-[18px] font-semibold text-ink/80">What happened</p>
                  <p className="mt-1 text-[20px] leading-relaxed">{rep.coach.what_happened}</p>
                  <p className="mt-5 text-[18px] font-semibold text-ink/80">Next time, say something like:</p>
                  <p className="mt-1 text-[22px] leading-relaxed">“{rep.coach.try_saying}”</p>
                  <div className="mt-5">
                    <BigLink
                      href={`/v2/calls/${rep.coach.call_id}${rep.coach.start !== null ? `?t=${Math.floor(rep.coach.start)}` : ""}`}
                    >
                      ▶ Listen to this moment together
                    </BigLink>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-[20px]">Nothing stands out to teach right now.</p>
          )}
        </Panel>
      </Section>

      <Section title="What they do well">
        <Panel>
          {rep.strengths.length ? (
            <ul className="space-y-5">
              {rep.strengths.map((s) => (
                <StepLine key={s.step} step={s} />
              ))}
            </ul>
          ) : (
            <p className="text-[20px]">
              {early ? "We need a few more calls to know." : "No step is done well every time yet."}
            </p>
          )}
          {rep.strength_example && (
            <div className="mt-6 rounded-[18px] bg-good-soft p-6">
              <p className="text-[20px] font-semibold">{rep.strength_example.title}</p>
              {rep.strength_example.quote && (
                <p className="mt-1 text-[20px] leading-relaxed">“{rep.strength_example.quote}”</p>
              )}
              <div className="mt-4">
                <BigLink
                  href={`/v2/calls/${rep.strength_example.call_id}${rep.strength_example.start !== null ? `?t=${Math.floor(rep.strength_example.start)}` : ""}`}
                  kind="secondary"
                >
                  ▶ Hear it
                </BigLink>
              </div>
            </div>
          )}
        </Panel>
      </Section>

      <Section title={`${rep.name}'s calls`}>
        <ul className="space-y-3">
          {rep.calls_list.slice(0, 8).map((c) => (
            <li key={c.call_id}>
              <Link href={`/v2/calls/${c.call_id}`} className="block rounded-[22px] focus-visible:ring-[4px] focus-visible:ring-accent/50">
                <Panel className="flex flex-wrap items-center gap-4 !py-4 transition-colors hover:border-accent">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[20px] font-semibold">{c.customer ?? "Customer not named"}</span>
                    <span className="block text-[17px] text-ink/80">
                      {CALL_TYPE_PLAIN[c.call_type] ?? c.call_type} · {date(c.when)}
                      {c.outcome && OUTCOME_PLAIN[c.outcome] ? ` · ${OUTCOME_PLAIN[c.outcome]}` : ""}
                    </span>
                  </span>
                  {c.grade && (
                    <StatusBadge status={c.grade === "below" ? "bad" : "good"} label={GRADE_PLAIN[c.grade]} />
                  )}
                  <span aria-hidden className="text-[22px] text-ink/60">→</span>
                </Panel>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <AllSteps steps={rep.steps} />
    </div>
  );
}

function StepLine({ step }: { step: StepStat }) {
  const status = step.hit_rate >= 80 ? "good" : step.hit_rate >= 50 ? "watch" : "bad";
  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[20px] font-semibold">{step.plain}</span>
        <span className="text-[18px]">
          done on {step.met} of {plural(step.of, "call")}
        </span>
      </div>
      <p className="text-[17px] text-ink/80">{step.meaning}</p>
      <div className="mt-2">
        <GoalBar value={step.hit_rate} status={status} />
      </div>
    </li>
  );
}

function AllSteps({ steps }: { steps: StepStat[] }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <Section title="Every step" intro="How often each step of the call is done.">
      <Reveal open={open} onToggle={() => setOpen((o) => !o)} more={`Show all ${steps.length} steps`} less="Hide the steps" />
      {open && (
        <Panel className="mt-4">
          <ul className="space-y-5">
            {steps.map((s) => (
              <StepLine key={s.step} step={s} />
            ))}
          </ul>
        </Panel>
      )}
    </Section>
  );
}
