"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { MissedStep, Overview } from "@/lib/api";
import { CANCEL_REASON, OFFER_LABEL, pct, titleCase } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { useCalls } from "@/components/calls-context";
import { ChevronIcon, PhoneIcon } from "@/components/icons";
import { FollowUpList } from "@/components/follow-up-list";
import { Card, CardHeader, Empty, ErrorNote, GroupRow, HitBar, Loading, Metric } from "@/components/ui";

export default function OverviewPage() {
  useTitle("Calls");
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
      <Card>
        <Empty title="No calls yet">
          Upload recordings and each one is transcribed, classified and graded against your
          call standards.
        </Empty>
      </Card>
    );
  }

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const attention = [
    {
      show: data.follow_ups.length > 0,
      title: `${plural(data.follow_ups.length, "open follow-up")}`,
      detail: "Callbacks, quotes and visits promised on calls - tick them off as they're done",
      href: "#follow-ups",
    },
    {
      show: sales.not_closed.length > 0,
      title: `${plural(sales.not_closed.length, "sales call")} not closed`,
      detail: "Prospects still deciding, or who said no",
      href: "/calls/pipeline",
    },
    {
      show: retention.no_offer_calls > 0,
      title: `${plural(retention.no_offer_calls, "cancellation")} with no save offer`,
      detail: "The cancel was processed without offering a solution",
      href: "/calls/log?type=retention",
    },
    {
      show: service.unresolved_calls.length > 0,
      title: `${plural(service.unresolved_calls.length, "service call")} not fully resolved`,
      detail: "Customers who may need another touch",
      href: "/calls/log?lens=service",
    },
    {
      show: scorecard.needs_review > 0,
      title: `${plural(scorecard.needs_review, "call type")} to confirm`,
      detail: "Could fit more than one type; confirm so it is graded on the right scorecard",
      href: "/calls/log?review=1",
    },
    {
      show: scorecard.disputed_calls > 0,
      title: `${plural(scorecard.disputed_calls, "call")} with disputed steps`,
      detail: "The two scoring models still disagree on a step; your call decides it",
      href: "/calls/log?disputed=1",
    },
    {
      show: scorecard.failed > 0,
      title: `${plural(scorecard.failed, "recording")} could not be processed`,
      detail: "Open the call to see why and try again",
      href: "/calls/log?status=failed",
    },
  ].filter((l) => l.show);

  return (
    <div className="space-y-6">
      {data.receptionist_number && <ReceptionistCard number={data.receptionist_number} />}

      <Card className="px-6 py-6">
        <div className="grid grid-cols-2 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-line">
          <Stat
            label="Calls analyzed"
            value={scorecard.calls}
            hint={scorecard.in_progress ? `${scorecard.in_progress} processing` : undefined}
          />
          <Stat label="Average score" value={pct(scorecard.avg_score_pct)} />
          <Stat
            label="Sales closed"
            value={pct(sales.close_rate)}
            hint={`${sales.sold} of ${sales.sold + sales.follow_up + sales.not_sold} sales calls`}
          />
          <Stat
            label="Cancels saved"
            value={retention.calls ? `${retention.saved} of ${retention.saved + retention.cancelled}` : "-"}
          />
          <Stat
            label="Meeting standard"
            value={`${scorecard.grades.gold + scorecard.grades.green} of ${scorecard.scored}`}
            hint="Gold or Green grade"
          />
        </div>
      </Card>

      {attention.length > 0 && (
        <section>
          <h2 className="section-title mb-3 px-1">Needs attention</h2>
          <div className="group-list">
            {attention.map((l) => (
              <GroupRow key={l.title} href={l.href}>
                <p className="text-[15px] font-medium">{l.title}</p>
                <p className="text-[13px] text-muted">{l.detail}</p>
              </GroupRow>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col p-6">
          <CardHeader eyebrow="Sales" title="Are we closing?" />
          <div className="grid grid-cols-3 gap-3">
            <Metric size="md" label="Sold" value={sales.sold} />
            <Metric size="md" label="Deciding" value={sales.follow_up} />
            <Metric size="md" label="Lost" value={sales.not_sold} />
          </div>
          <Divider />
          <p className="eyebrow mb-1">Steps most often missed</p>
          <StepList steps={sales.missed_steps.slice(0, 3)} />
          {sales.objections.length > 0 && (
            <>
              <Divider />
              <p className="eyebrow mb-2">What customers pushed back on</p>
              <ul className="space-y-2">
                {sales.objections.slice(0, 3).map((o, i) => (
                  <li key={i} className="text-[14px] leading-snug">
                    <Link href={`/calls/${o.call_id}`} className="hover:text-link">
                      {o.objection}
                    </Link>
                    <span className="text-muted"> · {o.customer ?? o.ref}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <LensLink href="/calls/log?lens=sales" label={`All ${sales.calls} sales calls`} />
        </Card>

        <Card className="flex flex-col p-6">
          <CardHeader eyebrow="Retention" title="Are we saving cancels?" />
          <div className="grid grid-cols-3 gap-3">
            <Metric size="md" label="Cancel calls" value={retention.calls} />
            <Metric size="md" label="Saved" value={retention.saved} />
            <Metric size="md" label="Lost" value={retention.cancelled} />
          </div>
          <Divider />
          <p className="eyebrow mb-2">Why they cancel</p>
          <KeyValueList
            empty="No cancellation calls yet."
            rows={retention.reasons.map((r) => [CANCEL_REASON[r.reason] ?? titleCase(r.reason), r.count])}
          />
          <Divider />
          <p className="eyebrow mb-2">Save offers made</p>
          <KeyValueList
            empty={retention.calls ? "No save offer was made on any cancel call." : "-"}
            rows={retention.offers.map((o) => [OFFER_LABEL[o.offer] ?? titleCase(o.offer), o.count])}
          />
          <LensLink href="/calls/log?lens=retention" label={`All ${retention.calls} retention calls`} />
        </Card>

        <Card className="flex flex-col p-6">
          <CardHeader eyebrow="Customer service" title="Are customers well served?" />
          <div className="grid grid-cols-3 gap-3">
            <Metric size="md" label="Calls" value={service.calls} />
            <Metric size="md" label="Resolved" value={pct(service.resolution_rate)} />
            <Metric size="md" label="Avg score" value={pct(service.avg_score_pct)} />
          </div>
          <Divider />
          <p className="eyebrow mb-2">Why they called</p>
          <KeyValueList rows={service.by_type.map((t) => [t.label, t.count])} empty="-" />
          <Divider />
          <p className="eyebrow mb-1">Steps most often missed</p>
          <StepList steps={service.missed_steps.slice(0, 3)} />
          <LensLink href="/calls/log?lens=service" label={`All ${service.calls} service calls`} />
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <CardHeader title="Coach this week" subtitle="Scorecard steps missed most often across every graded call." />
          <StepList steps={data.training} />
        </Card>

        <section id="follow-ups" className="scroll-mt-8">
          <h2 className="section-title mb-3 px-1">Promised to customers</h2>
          {data.follow_ups.length ? (
            <Card className="p-5">
              <FollowUpList items={data.follow_ups} linkToCall />
            </Card>
          ) : (
            <Card>
              <Empty title="Nothing outstanding" />
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat(props: React.ComponentProps<typeof Metric>) {
  return (
    <div className="lg:px-6 lg:first:pl-0 lg:last:pr-0">
      <Metric {...props} />
    </div>
  );
}

function StepList({ steps }: { steps: MissedStep[] }) {
  if (!steps.length) return <p className="text-[14px] text-muted">Nothing missed yet.</p>;
  return (
    <div>
      {steps.map((s) => (
        <HitBar
          key={s.step}
          label={s.step}
          value={s.pct}
          detail={`${s.missed} of ${s.of}`}
          href={s.example_call_id ? `/calls/${s.example_call_id}` : undefined}
        />
      ))}
    </div>
  );
}

function KeyValueList({ rows, empty }: { rows: [string, number][]; empty: string }) {
  if (!rows.length) return <p className="text-[14px] text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-[14px]">
      {rows.map(([k, v]) => (
        <li key={k} className="flex justify-between gap-3">
          <span>{k}</span>
          <span className="tnum text-muted">{v}</span>
        </li>
      ))}
    </ul>
  );
}

function Divider() {
  return <div className="my-5 h-px bg-line" />;
}

function LensLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mt-auto inline-flex items-center gap-0.5 pt-5 text-[14px] text-link hover:underline">
      {label}
      <ChevronIcon className="h-3.5 w-3.5" />
    </Link>
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
    <Card className="flex flex-wrap items-center gap-5 px-6 py-5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#30d158] text-white">
        <PhoneIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold tracking-tightish">
          Call the AI receptionist at{" "}
          <a href={`tel:${number}`} className="tnum text-link hover:underline">
            {formatPhone(number)}
          </a>
        </p>
        <p className="mt-0.5 text-[14px] text-muted">
          Ask about pricing or book an inspection. About a minute after you hang up, the call
          appears in the Call Log, graded like any other.
        </p>
      </div>
      <Link href="/calls/log?source=twilio" className="btn-secondary">
        Receptionist calls
      </Link>
    </Card>
  );
}
