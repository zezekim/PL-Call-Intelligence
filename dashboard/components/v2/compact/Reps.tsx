"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useApi, useTitle } from "@/lib/hooks";
import type { RepCard } from "@/lib/v2";
import { STATUS_TEXT } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { CheckIcon, ChevronIcon, CrossIcon } from "@/components/icons";
import { Avatar, Card, Empty, ErrorNote, Loading } from "@/components/ui";
import { Trend } from "@/components/v2/compact/kit";

// One or two calls are shown, but not judged as a pattern.
const FEW_CALLS = 3;

export function RepsCompact() {
  useTitle("Reps");
  const { query, refreshKey } = useCalls();
  const { data, error, loading, reload } = useApi<RepCard[]>(query("/intel/v2/reps"));

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data?.length) {
    return (
      <Card>
        <Empty title="Nobody yet">People show up here once their calls are checked.</Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-[14px] text-muted">
        The person who needs help most is at the top. The number is how many call steps they do; a good call does
        8 or 9 out of 10.
      </p>
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
                  <span className="block truncate text-[16px] font-semibold tracking-tightish">{r.name}</span>
                  <span className="block text-[12px] text-muted">
                    {r.calls} call{r.calls === 1 ? "" : "s"}
                    {r.close_rate !== null && ` · ${Math.round(r.close_rate / 10)} of 10 new customers say yes`}
                  </span>
                </span>
              </span>
              <span>
                <span
                  className={`tnum block text-[24px] font-semibold leading-none ${
                    r.scored < FEW_CALLS ? "text-muted" : STATUS_TEXT[r.status]
                  }`}
                >
                  {r.score === null ? "–" : `${Math.round(r.score)}%`}
                </span>
                {r.scored < FEW_CALLS ? <span className="text-[12px] text-muted">Too few calls to be sure</span> : <Trend trend={r.trend} />}
              </span>
              <span className="space-y-1 text-[14px]">
                {r.focus && (
                  <span className="flex items-start gap-2">
                    <CrossIcon className="mt-1 h-3 w-3 shrink-0 text-bad" />
                    <span>
                      <span className="font-medium">Teach: {r.focus.plain}</span>
                      <span className="text-muted"> · skipped {r.focus.missed} of {r.focus.of}</span>
                    </span>
                  </span>
                )}
                {r.strengths[0] && (
                  <span className="flex items-start gap-2">
                    <CheckIcon className="mt-1 h-3 w-3 shrink-0 text-good" />
                    <span className="text-muted">
                      Good at <span className="text-ink">{r.strengths[0].plain}</span>
                    </span>
                  </span>
                )}
              </span>
              <ChevronIcon className="hidden h-4 w-4 text-faint sm:block" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
