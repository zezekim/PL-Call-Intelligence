"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { RepSummary } from "@/lib/api";
import { TONE_TEXT, pct, tone } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { useCalls } from "@/components/calls-context";
import { ChevronIcon } from "@/components/icons";
import { Avatar, Card, Empty, ErrorNote, Loading } from "@/components/ui";

export default function RepsPage() {
  useTitle("Reps");
  const { query, refreshKey } = useCalls();
  const { data, error, loading, reload } = useApi<RepSummary[]>(query("/intel/reps"));

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  const reps = (data ?? []).filter((r) => r.calls > 0);
  if (!reps.length) {
    return (
      <Card className="p-6">
        <Empty title="No reps yet">Reps appear once their calls are analyzed.</Empty>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <table className="hidden w-full text-left text-[14px] md:table">
        <thead className="border-b border-line text-[12px] text-muted">
          <tr>
            <th className="px-6 py-3 font-medium">Rep</th>
            <th className="px-3 py-3 text-right font-medium">Calls</th>
            <th className="px-3 py-3 text-right font-medium">Avg score</th>
            <th className="px-3 py-3 font-medium">Grades</th>
            <th className="px-3 py-3 text-right font-medium">Close %</th>
            <th className="px-3 py-3 font-medium">Strongest step</th>
            <th className="px-3 py-3 font-medium">Coach on</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {reps.map((r) => (
            <tr key={r.id} className="transition-colors hover:bg-[#fafafa]">
              <td className="px-6 py-3.5">
                <Link href={`/calls/reps/${r.id}`} className="flex items-center gap-3 text-[15px] font-medium tracking-tightish hover:text-link">
                  <Avatar name={r.name} size={30} />
                  {r.name}
                </Link>
              </td>
              <td className="tnum px-3 py-3 text-right">{r.calls}</td>
              <td className={`tnum px-3 py-3 text-right font-semibold ${TONE_TEXT[tone(r.avg_score_pct, 90, 70)]}`}>
                {pct(r.avg_score_pct)}
              </td>
              <td className="px-3 py-3">
                <GradeMix grades={r.grades} />
              </td>
              <td className="tnum px-3 py-3 text-right">
                {r.sales_calls ? pct(r.close_rate) : <span className="text-faint">-</span>}
              </td>
              <td className="max-w-[180px] truncate px-3 py-3">{r.strongest ?? "-"}</td>
              <td className="max-w-[180px] truncate px-3 py-3">{r.weakest ?? "-"}</td>
              <td className="pr-4">
                <Link href={`/calls/reps/${r.id}`} aria-label={`Open ${r.name}`}>
                  <ChevronIcon className="h-4 w-4 text-faint" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-line md:hidden">
        {reps.map((r) => (
          <li key={r.id}>
            <Link href={`/calls/reps/${r.id}`} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={r.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted">
                  {r.calls} calls · coach on {r.weakest ?? "-"}
                </p>
              </div>
              <span className={`tnum font-semibold ${TONE_TEXT[tone(r.avg_score_pct, 90, 70)]}`}>
                {pct(r.avg_score_pct)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GradeMix({ grades }: { grades: RepSummary["grades"] }) {
  const parts = [
    { n: grades.gold, label: "Gold", cls: "bg-[#c99a00]" },
    { n: grades.green, label: "Green", cls: "bg-good" },
    { n: grades.below, label: "Below", cls: "bg-bad" },
  ].filter((p) => p.n > 0);
  if (!parts.length) return <span className="text-faint">-</span>;
  return (
    <span className="flex flex-wrap gap-3 text-[13px] text-muted">
      {parts.map((p) => (
        <span key={p.label} className="inline-flex items-center gap-1.5">
          <span className={`h-[7px] w-[7px] rounded-full ${p.cls}`} />
          <span className="tnum text-ink">{p.n}</span> {p.label}
        </span>
      ))}
    </span>
  );
}
