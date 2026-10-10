"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi, useTitle } from "@/lib/hooks";
import type { ActionsSummary, Brief, PreparedAction, RepBrief, RepCard, Status } from "@/lib/v2";
import { STATUS_TEXT } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { ChevronIcon, PlayIcon } from "@/components/icons";
import { Avatar, Card, Empty } from "@/components/ui";
import { ActionSheet } from "@/components/v2/act";
import { personLabel } from "@/components/v2/customer";
import { Progress } from "@/components/v2/focus";
import { CoachingFocus, Footer, Scores } from "@/components/v2/how-its-going";
import { ListSkeleton, PageError, Trend } from "@/components/v2/kit";

// One or two calls are shown, but not judged as a pattern.
const FEW_CALLS = 3;
const PERSON_WORD: Record<Status, string> = { good: "Doing well", watch: "Okay", bad: "Needs help", none: "Too early to tell" };

export default function RepsPage() {
  useTitle("Team");
  const { query, refreshKey } = useCalls();
  const { data, error, status, loading, reload } = useApi<RepCard[]>(query("/intel/v2/reps"));
  const brief = useApi<Brief>(query("/intel/v2/brief"));
  const summary = useApi<ActionsSummary>("/intel/actions/summary");
  const actions = summary.data?.autopilot ? summary.data : null;
  const reloadBrief = brief.reload;

  useEffect(() => {
    if (refreshKey) {
      void reload();
      void reloadBrief();
    }
  }, [refreshKey, reload, reloadBrief]);
  const refreshCoaching = async () => {
    await Promise.all([reloadBrief(), summary.reload()]);
  };
  const b = brief.data?.calls?.analyzed ? brief.data : null;

  if (loading && !data) return <ListSkeleton rows={4} />;
  if (error && !data) return <PageError status={status} onRetry={() => void reload()} />;
  if (!data?.length) {
    return (
      <Card>
        <Empty title="Nobody yet">People show up here once their calls are checked.</Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 gap-7 min-[1180px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] min-[1180px]:items-start min-[1180px]:gap-5">
        <CoachOne reps={data} summary={actions} onChanged={refreshCoaching} />
        <section aria-label="Everyone" className="settle">
          <div className="mb-2 px-1 min-[1180px]:-mt-2">
            <h2 className="text-[20px] font-semibold tracking-title">Everyone</h2>
            <p className="text-[16px] text-ink/70">Who needs help most is at the top.</p>
          </div>
          <ul className="group-list">
            {data.map((r) => (
              <li key={r.id}>
                <Link href={`/v2/reps/${r.id}`} className="press flex min-h-[72px] items-center gap-3 px-4 py-3 hover:bg-surface-hover hover:no-underline">
                  <Avatar name={r.name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="text-[17px] font-semibold text-ink">{personLabel(r.name)}</span>
                      <span className={`text-[16px] font-semibold ${r.scored < FEW_CALLS ? "text-ink/70" : STATUS_TEXT[r.status]}`}>
                        {r.scored < FEW_CALLS || r.score === null ? "Too early to tell" : PERSON_WORD[r.status]}
                      </span>
                    </span>
                    {r.focus && <span className="block text-[15px] text-ink/80">Needs to work on: {r.focus.plain}</span>}
                    <span className="block text-[15px] text-ink/70">
                      {r.calls} call{r.calls === 1 ? "" : "s"}
                      {r.decided ? ` · ${r.sold} of ${r.decided} new caller${r.decided === 1 ? "" : "s"} said yes` : ""}
                    </span>
                  </span>
                  <ChevronIcon className="h-4 w-4 shrink-0 text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {b && <Scores brief={b} />}
      {b && <CoachingFocus brief={b} quality={b.cards[3]} summary={actions} onChanged={refreshCoaching} />}
      {b && <Footer brief={b} />}
    </div>
  );
}

/**
 * Help one person at a time, whoever needs it most first: the one thing to
 * work on, the words to teach, the moment to hear on their own call, and one
 * big button that sends them the tip (or gets their number to).
 */
function CoachOne({ reps, summary, onChanged }: { reps: RepCard[]; summary: ActionsSummary | null; onChanged: () => Promise<void> }) {
  // People, not the phone receptionist: it can't be sent a tip.
  const people = reps.filter((r) => r.focus && !/receptionist/i.test(r.name));
  const [i, setI] = useState(0);
  const [sending, setSending] = useState<PreparedAction | null>(null);
  const person = people[i % Math.max(1, people.length)];
  const detail = useApi<RepBrief>(person ? `/intel/v2/reps/${person.id}` : null).data;
  if (!person) return null;
  const first = person.name.split(/\s+/)[0];
  const tip = summary?.coaching_waiting.find((a) => a.to_name === person.name && a.to_phone);
  const coach = detail?.id === person.id ? detail.coach : null;

  return (
    <section
      key={person.id}
      aria-label="Help one person"
      className="card-in relative overflow-hidden rounded-[30px] border border-hairline bg-surface p-6 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.25)] sm:p-8"
    >
      <span className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent-soft opacity-80 blur-3xl" aria-hidden />
      <div className="relative flex items-center justify-between gap-3">
        <p className="text-[15px] font-semibold uppercase tracking-wide text-ink/75">Help one person</p>
        {people.length > 1 && <Progress place={(i % people.length) + 1} of={people.length} />}
      </div>
      <div className="relative mt-5 flex items-center gap-4">
        <Avatar name={person.name} size={64} />
        <div className="min-w-0">
          <h2 className="text-[30px] font-bold leading-tight tracking-title">{first}</h2>
          <p className={`text-[18px] font-semibold ${person.scored < FEW_CALLS ? "text-ink/70" : STATUS_TEXT[person.status]}`}>
            {person.scored < FEW_CALLS ? "Too early to tell" : PERSON_WORD[person.status]}
            {person.scored >= FEW_CALLS && person.trend && (
              <span className="ml-2 text-[16px] font-medium">
                <Trend trend={person.trend} />
              </span>
            )}
          </p>
        </div>
      </div>
      <p className="relative mt-5 text-[15px] font-semibold uppercase tracking-wide text-ink/75">Needs to work on</p>
      <p className="relative mt-1 text-[26px] font-bold leading-tight tracking-title">{person.focus!.plain}</p>
      <p className="relative mt-1 text-[18px] text-ink/80">
        {person.focus!.meaning ? `${person.focus!.meaning} ` : ""}Missed on {person.focus!.missed} of {person.focus!.of} call{person.focus!.of === 1 ? "" : "s"}.
      </p>
      {coach && (
        <div className="relative mt-5 rounded-[20px] bg-panel p-4">
          <p className="text-[15px] font-semibold uppercase tracking-wide text-ink/70">Teach {first} to say</p>
          <p className="mt-1.5 text-[18px] leading-relaxed">“{coach.try_saying}”</p>
          <Link
            href={`/v2/calls/${coach.call_id}${coach.start !== null ? `?t=${Math.floor(coach.start)}` : ""}`}
            className="press mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-[16px] font-medium text-link hover:no-underline"
          >
            <PlayIcon className="h-3 w-3" />
            Hear the moment on {first}&apos;s call
          </Link>
        </div>
      )}
      <div className="relative mt-6 space-y-3">
        {tip ? (
          <button className="btn-primary min-h-[64px] w-full text-[20px] font-semibold shadow-[0_14px_30px_-12px_rgb(var(--accent)/0.7)]" onClick={() => setSending(tip)}>
            Text {first} the tip →
          </button>
        ) : (
          <Link href={`/v2/reps/${person.id}`} className="btn-primary min-h-[64px] w-full text-[20px] font-semibold hover:no-underline">
            {detail?.id === person.id && !detail.phone ? `Add ${first}'s mobile to send tips` : `See how ${first} is doing`} →
          </Link>
        )}
        {people.length > 1 && (
          <button className="btn-secondary min-h-[52px] w-full text-[17px]" onClick={() => setI((n) => n + 1)}>
            Next person
          </button>
        )}
      </div>
      {sending && (
        <ActionSheet
          open
          title={`Tip for ${first}`}
          options={[sending]}
          summary={summary}
          onClose={() => setSending(null)}
          onDone={onChanged}
        />
      )}
    </section>
  );
}
