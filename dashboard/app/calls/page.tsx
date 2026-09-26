"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { MissedStep, Overview } from "@/lib/api";
import { CANCEL_REASON, OFFER_LABEL, pct, titleCase, tone } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useCalls } from "@/components/calls-context";
import { ChevronIcon } from "@/components/icons";
import { Card, CardHeader, Empty, ErrorNote, HitBar, Loading, Metric } from "@/components/ui";

export default function OverviewPage() {
  const { query, refreshKey } = useCalls();
  const { data, error, loading, reload } = useApi<Overview>(query("/intel/overview"), {
    poll: (d) => d.scorecard.in_progress > 0,
  });

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  const { scorecard, sales, retention, service } = data;
  if (!scorecard.calls && !scorecard.in_progress) {
    return (
      <Card className="p-6">
        <Empty title="No calls yet">
          Upload call recordings and they will be transcribed, classified and scored against
          your call standards.
        </Empty>
      </Card>
    );
  }

  const leaks = [
    {
      show: data.follow_ups.length > 0,
      title: `${data.follow_ups.length} follow-up${data.follow_ups.length === 1 ? "" : "s"} promised`,
      detail: "Callbacks, quotes and visits the team committed to on calls",
      href: "#follow-ups",
      action: "Review",
    },
    {
      show: sales.not_closed.length > 0,
      title: `${sales.not_closed.length} sales call${sales.not_closed.length === 1 ? "" : "s"} not closed`,
      detail: "Prospects who are still deciding or said no",
      href: "/calls/pipeline",
      action: "Open pipeline",
    },
    {
      show: retention.no_offer_calls > 0,
      title: `${retention.no_offer_calls} cancellation${retention.no_offer_calls === 1 ? "" : "s"} with no save offer`,
      detail: "The rep processed the cancel without offering a solution",
      href: "/calls/log?type=retention",
      action: "Listen",
    },
    {
      show: service.unresolved_calls.length > 0,
      title: `${service.unresolved_calls.length} service call${service.unresolved_calls.length === 1 ? "" : "s"} not fully resolved`,
      detail: "Customers who may need another touch",
      href: "/calls/log?lens=service",
      action: "View",
    },
    {
      show: scorecard.needs_review > 0,
      title: `${scorecard.needs_review} call type${scorecard.needs_review === 1 ? "" : "s"} to confirm`,
      detail: "The call could fit more than one type - confirm it so it is graded on the right scorecard",
      href: "/calls/log?review=1",
      action: "Confirm",
    },
    {
      show: scorecard.failed > 0,
      title: `${scorecard.failed} recording${scorecard.failed === 1 ? "" : "s"} could not be processed`,
      detail: "Open the call to see why and retry",
      href: "/calls/log?status=failed",
      action: "View",
    },
  ].filter((l) => l.show);

  return (
    <div className="space-y-5">
      {data.receptionist_number && <ReceptionistCard number={data.receptionist_number} />}
      <Card accent className="p-6">
        <CardHeader
          title="Scorecard"
          action={
            scorecard.in_progress > 0 ? (
              <span className="chip bg-accent-soft text-accent">
                {scorecard.in_progress} processing
              </span>
            ) : undefined
          }
        />
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Calls analyzed" value={scorecard.calls} />
          <Metric
            label="Avg call score"
            value={pct(scorecard.avg_score_pct)}
            tone={tone(scorecard.avg_score_pct, 90, 70)}
          />
          <Metric label="Sales close %" value={pct(sales.close_rate)} tone={tone(sales.close_rate, 50, 30)} hint={`${sales.sold} of ${sales.sold + sales.follow_up + sales.not_sold} sales calls`} />
          <Metric
            label="Cancels saved"
            value={retention.calls ? `${retention.saved}/${retention.saved + retention.cancelled}` : "-"}
            tone={retention.calls ? tone(retention.save_rate, 50, 25) : "none"}
          />
          <Metric
            label="Gold / Green"
            value={`${scorecard.grades.gold} / ${scorecard.grades.green}`}
            tone={scorecard.grades.gold + scorecard.grades.green > 0 ? "good" : "none"}
          />
          <Metric
            label="Below standard"
            value={scorecard.grades.below}
            tone={scorecard.grades.below > 0 ? "bad" : "good"}
            hint={`of ${scorecard.scored} graded calls`}
          />
        </div>
      </Card>

      {leaks.length > 0 && (
        <Card accent className="p-6">
          <CardHeader title="Call leaks" />
          <div className="space-y-2">
            {leaks.map((l) => (
              <div key={l.title} className="inset-row">
                <div className="min-w-0">
                  <p className="font-medium">{l.title}</p>
                  <p className="text-sm text-muted">{l.detail}</p>
                </div>
                <Link href={l.href} className="btn-primary shrink-0 rounded-full px-4">
                  {l.action} →
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-6">
          <CardHeader eyebrow="Sales" title="Are we closing?" />
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Sold" value={sales.sold} tone={sales.sold ? "good" : "none"} />
            <Metric label="Follow-up" value={sales.follow_up} tone={sales.follow_up ? "warn" : "none"} />
            <Metric label="Not sold" value={sales.not_sold} tone={sales.not_sold ? "bad" : "none"} />
          </div>
          <Divider />
          <p className="eyebrow mb-1">Most missed steps</p>
          <StepList steps={sales.missed_steps.slice(0, 3)} />
          {sales.objections.length > 0 && (
            <>
              <Divider />
              <p className="eyebrow mb-2">Objections heard</p>
              <ul className="space-y-1.5 text-sm">
                {sales.objections.slice(0, 4).map((o, i) => (
                  <li key={i}>
                    <Link href={`/calls/${o.call_id}`} className="hover:text-accent">
                      “{o.objection}”
                      <span className="text-muted"> · {o.customer ?? o.ref}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <LensLink href="/calls/log?lens=sales" label={`${sales.calls} sales calls`} />
        </Card>

        <Card className="p-6">
          <CardHeader eyebrow="Retention" title="Are we saving cancels?" />
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Cancel calls" value={retention.calls} />
            <Metric label="Saved" value={retention.saved} tone={retention.saved ? "good" : "none"} />
            <Metric label="Lost" value={retention.cancelled} tone={retention.cancelled ? "bad" : "none"} />
          </div>
          <Divider />
          <p className="eyebrow mb-2">Why they cancel</p>
          {retention.reasons.length ? (
            <ul className="space-y-1 text-sm">
              {retention.reasons.map((r) => (
                <li key={r.reason} className="flex justify-between">
                  <span>{CANCEL_REASON[r.reason] ?? titleCase(r.reason)}</span>
                  <span className="tnum text-muted">{r.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No cancellation calls yet.</p>
          )}
          <Divider />
          <p className="eyebrow mb-2">Save offers made</p>
          {retention.offers.length ? (
            <ul className="space-y-1 text-sm">
              {retention.offers.map((o) => (
                <li key={o.offer} className="flex justify-between">
                  <span>{OFFER_LABEL[o.offer] ?? titleCase(o.offer)}</span>
                  <span className="tnum text-muted">{o.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              {retention.calls ? "No save offer was made on any cancel call." : "-"}
            </p>
          )}
          <LensLink href="/calls/log?lens=retention" label={`${retention.calls} retention calls`} />
        </Card>

        <Card className="p-6">
          <CardHeader eyebrow="Customer service" title="How are we handling customers?" />
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Calls" value={service.calls} />
            <Metric
              label="Resolved"
              value={pct(service.resolution_rate)}
              tone={tone(service.resolution_rate, 90, 70)}
            />
            <Metric
              label="Avg score"
              value={pct(service.avg_score_pct)}
              tone={tone(service.avg_score_pct, 90, 70)}
            />
          </div>
          <Divider />
          <p className="eyebrow mb-2">Call reasons</p>
          <ul className="space-y-1 text-sm">
            {service.by_type.map((t) => (
              <li key={t.call_type} className="flex justify-between">
                <span>{t.label}</span>
                <span className="tnum text-muted">{t.count}</span>
              </li>
            ))}
          </ul>
          <Divider />
          <p className="eyebrow mb-1">Most missed steps</p>
          <StepList steps={service.missed_steps.slice(0, 3)} />
          <LensLink href="/calls/log?lens=service" label={`${service.calls} service calls`} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <CardHeader
            eyebrow="Training"
            title="What to coach this week"
          />
          <p className="-mt-2 mb-3 text-sm text-muted">
            Scorecard steps missed most often across every graded call.
          </p>
          <StepList steps={data.training} />
        </Card>

        <Card className="p-6">
          <div id="follow-ups" className="scroll-mt-6" />
          <CardHeader eyebrow="Follow-ups" title="What we promised customers" />
          {data.follow_ups.length ? (
            <ul className="divide-y divide-line">
              {data.follow_ups.map((f, i) => (
                <li key={i}>
                  <Link href={`/calls/${f.call_id}`} className="group flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm group-hover:text-accent">{f.action}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {[f.customer, titleCase(f.owner), f.due].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <ChevronIcon className="mt-1 h-4 w-4 shrink-0 text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing outstanding" />
          )}
        </Card>
      </div>
    </div>
  );
}

function formatPhone(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return number;
}

function ReceptionistCard({ number }: { number: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-ink px-6 py-5 text-white shadow-card">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">
          Try the AI receptionist
        </p>
        <p className="mt-1 text-xl font-semibold tracking-tight">
          Call{" "}
          <a href={`tel:${number}`} className="tnum underline decoration-white/30 underline-offset-4 hover:decoration-white">
            {formatPhone(number)}
          </a>
        </p>
        <p className="mt-1 text-sm text-white/70">
          Ask about pricing or book an inspection. About a minute after you hang up, the call
          appears in the Call Log - transcribed, scored and coached like any other.
        </p>
      </div>
      <Link href="/calls/log?source=twilio" className="btn shrink-0 rounded-full bg-white px-4 text-ink hover:bg-white/90">
        Receptionist calls →
      </Link>
    </div>
  );
}

function StepList({ steps }: { steps: MissedStep[] }) {
  if (!steps.length) return <p className="text-sm text-muted">Nothing missed yet.</p>;
  return (
    <div>
      {steps.map((s) => (
        <HitBar
          key={s.step}
          label={s.step}
          value={s.pct}
          detail={`missed ${s.missed} of ${s.of}`}
          href={s.example_call_id ? `/calls/${s.example_call_id}` : undefined}
        />
      ))}
    </div>
  );
}

function Divider() {
  return <div className="my-4 h-px bg-line" />;
}

function LensLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">
      {label}
      <ChevronIcon className="h-4 w-4" />
    </Link>
  );
}
