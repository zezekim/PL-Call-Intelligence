"use client";

import Link from "next/link";
import { useEffect } from "react";
import { plural } from "@/lib/easy";
import { useApi, useTitle } from "@/lib/hooks";
import type { RepCard } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { Avatar, ErrorNote, Loading } from "@/components/ui";
import { Panel, StatusBadge, StatusIcon, Trend, easyLink } from "@/components/v2/kit";

// One or two calls are shown, but not judged as a pattern.
const FEW_CALLS = 3;

export default function TeamV2() {
  useTitle("Team");
  const { query, refreshKey } = useCalls();
  const { data, error, loading, reload } = useApi<RepCard[]>(query("/intel/v2/reps"));

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data?.length) {
    return (
      <Panel>
        <p className="text-[22px] font-semibold">Nobody yet. People appear here once their calls are checked.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[20px] leading-relaxed">
        The person who needs help the most is at the top. A good call does at least 8 or 9 out of 10 steps.
      </p>
      <ul className="space-y-4">
        {data.map((r) => {
          const early = r.scored < FEW_CALLS;
          const tens = Math.round((r.score ?? 0) / 10);
          return (
            <li key={r.id}>
              <Link href={`/v2/reps/${r.id}`} className="block rounded-[22px] focus-visible:ring-[4px] focus-visible:ring-accent/50">
                <Panel className="transition-colors hover:border-accent">
                  <div className="flex flex-wrap items-start gap-5">
                    <Avatar name={r.name} size={56} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[26px] font-bold leading-tight tracking-title">{r.name}</p>
                      <p className="mt-1 text-[18px] text-ink/80">
                        {plural(r.scored, "call")} checked
                        {early ? " · too few to be sure" : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={early ? "none" : r.status} label={`Does ${tens} out of 10 steps`} />
                      {!early && (
                        <div className="mt-2">
                          <Trend trend={r.trend} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 border-t-2 border-line pt-5 text-[20px] sm:grid-cols-2">
                    {r.focus && (
                      <p className="flex items-start gap-3">
                        <StatusIcon status="bad" size={24} />
                        <span>
                          <span className="font-semibold">Teach: </span>
                          {r.focus.plain}
                        </span>
                      </p>
                    )}
                    {r.strengths[0] && (
                      <p className="flex items-start gap-3">
                        <StatusIcon status="good" size={24} />
                        <span>
                          <span className="font-semibold">Good at: </span>
                          {r.strengths[0].plain}
                        </span>
                      </p>
                    )}
                  </div>
                  <p className={`mt-4 text-[18px] ${easyLink}`}>See {r.name}&apos;s calls and what to teach →</p>
                </Panel>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
