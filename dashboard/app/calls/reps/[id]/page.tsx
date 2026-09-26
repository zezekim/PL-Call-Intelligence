"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { RepDetail } from "@/lib/api";
import { clock, date, pct, tone } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { useCalls } from "@/components/calls-context";
import { BackIcon, CheckIcon } from "@/components/icons";
import { Avatar, Card, CardHeader, Empty, ErrorNote, HitBar, Loading, Metric } from "@/components/ui";

const SCORECARD_NAME: Record<string, string> = {
  sales: "Sales calls",
  all_calls: "Service calls",
  retention: "Retention calls",
};

export default function RepPage() {
  const { id } = useParams<{ id: string }>();
  const { query } = useCalls();
  const { data: rep, error, loading } = useApi<RepDetail>(query(`/intel/reps/${id}`));
  useTitle(rep?.name);

  if (loading && !rep) return <Loading />;
  if (error && !rep) return <ErrorNote message={error} />;
  if (!rep) return null;

  return (
    <div className="space-y-5">
      <Link href="/calls/reps" className="-ml-1 inline-flex items-center gap-0.5 text-[15px] text-link hover:underline">
        <BackIcon className="h-4 w-4" /> Reps
      </Link>

      <Card accent className="p-6">
        <div className="flex items-center gap-4">
          <Avatar name={rep.name} size={52} />
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-title">{rep.name}</h1>
            <p className="text-[14px] text-muted">
              {rep.calls} call{rep.calls === 1 ? "" : "s"} analyzed
            </p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Metric label="Avg call score" value={pct(rep.avg_score_pct)} tone={tone(rep.avg_score_pct, 90, 70)} />
          <Metric
            label="Sales close %"
            value={rep.sales_calls ? pct(rep.close_rate) : "-"}
            tone={rep.sales_calls ? tone(rep.close_rate, 50, 30) : "none"}
            hint={rep.sales_calls ? `${rep.sales_calls} sales calls` : undefined}
          />
          <Metric label="Gold / Green" value={`${rep.grades.gold} / ${rep.grades.green}`} />
          <Metric label="Below standard" value={rep.grades.below} tone={rep.grades.below ? "bad" : "good"} />
        </div>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <CardHeader eyebrow="Coach on" title="Steps missed most" />
          {rep.training.length ? (
            rep.training.map((s) => (
              <HitBar
                key={s.step}
                label={s.step}
                value={s.pct}
                detail={`missed ${s.missed} of ${s.of}`}
                href={s.example_call_id ? `/calls/${s.example_call_id}` : undefined}
              />
            ))
          ) : (
            <p className="text-sm text-muted">Nothing missed.</p>
          )}
        </Card>

        <Card className="p-6">
          <CardHeader eyebrow="Trend" title="Score by call" />
          <Trend points={rep.trend} />
        </Card>
      </div>

      {rep.scorecards.map((sc) => (
        <Card key={sc.scorecard} className="p-6">
          <CardHeader
            eyebrow="Step by step"
            title={SCORECARD_NAME[sc.scorecard] ?? sc.scorecard}
            action={<span className="text-sm text-muted">{sc.calls} calls</span>}
          />
          <div className="grid gap-x-8 sm:grid-cols-2">
            {sc.steps.map((s) => (
              <HitBar key={s.step} label={s.step} value={s.pct} detail={`${s.met}/${s.of}`} />
            ))}
          </div>
        </Card>
      ))}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <CardHeader eyebrow="Coaching" title="Recent tips" />
          {rep.coaching.length ? (
            <ul className="space-y-3">
              {rep.coaching.map((c, i) => (
                <li key={i} className="rounded-2xl bg-panel p-4">
                  <Link href={`/calls/${c.call_id}`} className="text-[15px] font-medium tracking-tightish hover:text-link">
                    {c.title}
                  </Link>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {[c.customer ?? c.ref, date(c.when), c.start !== null ? clock(c.start) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-2 border-l-[3px] border-accent pl-3 text-[14px] leading-relaxed">
                    {c.try_saying}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No coaching yet" />
          )}
        </Card>

        <Card className="p-6">
          <CardHeader eyebrow="Strengths" title="What they do well" />
          {rep.strengths.length ? (
            <ul className="space-y-3">
              {rep.strengths.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-snug">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good" />
                  <span>
                    <Link href={`/calls/${s.call_id}`} className="font-medium hover:text-link">
                      {s.title}.
                    </Link>{" "}
                    {s.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing yet" />
          )}
        </Card>
      </div>
    </div>
  );
}

/** Single-series line of score % per call, oldest to newest. */
function Trend({ points }: { points: RepDetail["trend"] }) {
  const data = points.filter((p) => p.pct !== null);
  if (data.length < 2) {
    return <p className="text-sm text-muted">A trend appears after two or more graded calls.</p>;
  }
  const w = 520;
  const h = 170;
  const pad = { l: 34, r: 12, t: 12, b: 24 };
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / (data.length - 1);
  const y = (v: number) => pad.t + ((100 - v) * (h - pad.t - pad.b)) / 100;
  const path = data.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.pct as number)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Score percentage per call">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="rgb(var(--line))" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="rgb(var(--muted))">
            {v}%
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((p, i) => (
        <a key={p.call_id} href={`/calls/${p.call_id}`}>
          <circle cx={x(i)} cy={y(p.pct as number)} r={4.5} fill="rgb(var(--accent))" stroke="rgb(var(--surface))" strokeWidth={2}>
            <title>{`${p.ref ?? "Call"}: ${p.pct}%`}</title>
          </circle>
          <circle cx={x(i)} cy={y(p.pct as number)} r={12} fill="transparent" />
        </a>
      ))}
      {data.map((p, i) =>
        i === 0 || i === data.length - 1 ? (
          <text key={`l${i}`} x={x(i)} y={h - 6} textAnchor={i ? "end" : "start"} fontSize="11" fill="rgb(var(--muted))">
            {p.ref ?? date(p.when)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
