"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useApi, useTitle } from "@/lib/hooks";
import type { ActionsSummary, Brief, RepCard, Status } from "@/lib/v2";
import { STATUS_TEXT } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { CheckIcon, ChevronIcon, CrossIcon } from "@/components/icons";
import { Avatar, Card, Empty } from "@/components/ui";
import { personLabel } from "@/components/v2/customer";
import { CoachingFocus, Footer, Scores } from "@/components/v2/how-its-going";
import { ListSkeleton, PageError, Section, Trend } from "@/components/v2/kit";

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
      {b && <Scores brief={b} />}
      <Section
        title="Each person"
        subtitle="Who needs help most is at the top. Press a name to see how to help them."
      >
        <ul className="group-list">
          {data.map((r) => (
            <li key={r.id}>
              <Link
                href={`/v2/reps/${r.id}`}
                className="grid gap-3 px-5 py-4 transition-colors hover:bg-surface-hover sm:grid-cols-[minmax(0,1.1fr)_110px_minmax(0,1.6fr)_16px] sm:items-center"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.name} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-[17px] font-semibold tracking-tightish">{personLabel(r.name)}</span>
                    <span className="block text-[15px] text-ink/70">
                      {r.calls} call{r.calls === 1 ? "" : "s"}
                      {r.decided ? ` · ${r.sold} of ${r.decided} new caller${r.decided === 1 ? "" : "s"} said yes` : ""}
                    </span>
                  </span>
                </span>
                <span>
                  <span className={`block text-[18px] font-semibold leading-tight ${r.scored < FEW_CALLS ? "text-ink/70" : STATUS_TEXT[r.status]}`}>
                    {r.scored < FEW_CALLS || r.score === null ? "Too early to tell" : PERSON_WORD[r.status]}
                  </span>
                  {r.scored >= FEW_CALLS && <Trend trend={r.trend} />}
                </span>
                <span className="space-y-1 text-[16px]">
                  {r.focus && (
                    <span className="flex items-start gap-2">
                      <CrossIcon className="mt-1 h-3 w-3 shrink-0 text-bad" />
                      <span>
                        <span className="font-medium">Needs to work on: {r.focus.plain}</span>
                        <span className="text-ink/70">
                          {" "}
                          (missed on {r.focus.missed} of {r.focus.of} calls)
                        </span>
                      </span>
                    </span>
                  )}
                  {r.strengths[0] && (
                    <span className="flex items-start gap-2">
                      <CheckIcon className="mt-1 h-3 w-3 shrink-0 text-good" />
                      <span className="text-ink/70">
                        Good at: <span className="text-ink">{r.strengths[0].plain}</span>
                      </span>
                    </span>
                  )}
                </span>
                <ChevronIcon className="hidden h-4 w-4 text-faint sm:block" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      {b && <CoachingFocus brief={b} quality={b.cards[3]} summary={actions} onChanged={refreshCoaching} />}
      {b && <Footer brief={b} />}
    </div>
  );
}
