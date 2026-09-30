"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { PipelineBoard, PipelineLead, Urgency } from "@/lib/v2";
import { money } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { CheckIcon, ChevronIcon, CrossIcon } from "@/components/icons";
import { Avatar, Card, Empty, ErrorNote, Loading, Spinner } from "@/components/ui";
import { Section } from "@/components/v2/compact/kit";

const URGENCY: Record<Urgency, { label: (l: PipelineLead) => string; cls: string }> = {
  overdue: {
    label: (l) => {
      const due = l.action?.due_at ? Math.max(1, Math.round((Date.now() - Date.parse(l.action.due_at)) / 864e5)) : 0;
      return due ? `Late by ${due} day${due === 1 ? "" : "s"}` : "Late";
    },
    cls: "bg-bad-soft text-bad",
  },
  today: { label: () => "Call today", cls: "bg-warn-soft text-warn" },
  cold: { label: () => "Waiting a long time", cls: "bg-fill text-subtle" },
  upcoming: { label: (l) => (l.action?.due_at ? `Call by ${date(l.action.due_at)}` : "Call soon"), cls: "bg-fill text-subtle" },
};

const STAGE_LABEL: Record<string, string> = {
  new: "Asked about a service",
  quoted: "Got a price",
  follow_up: "Still deciding",
  won: "Said yes",
  lost: "Said no",
};

export function PipelineCompact() {
  useTitle("Call back");
  const { refreshKey } = useCalls();
  const { data, error, loading, reload } = useApi<PipelineBoard>("/intel/v2/pipeline");

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;
  if (!data.open.length && !data.closed.length) {
    return (
      <Card>
        <Empty title="Nobody to call back yet">People who ask about a service show up here by themselves.</Empty>
      </Card>
    );
  }

  const s = data.summary;
  return (
    <div className="space-y-8">
      <Summary board={data} />

      <Section
        title="Call these people"
        subtitle={
          s.open
            ? `${s.needs_action} of ${s.open} people need a call now. The most urgent is at the top.`
            : "Nobody to call. Everyone has said yes or no."
        }
      >
        {data.open.length ? (
          <ul className="group-list">
            {data.open.map((lead) => (
              <OpenLead key={lead.id} lead={lead} onChange={reload} />
            ))}
          </ul>
        ) : (
          <Card className="flex items-center gap-3 px-5 py-4">
            <CheckIcon className="h-5 w-5 text-good" />
            <p className="text-[15px]">Nothing to chase.</p>
          </Card>
        )}
      </Section>

      <Closed leads={data.closed} onChange={reload} />
    </div>
  );
}

function Summary({ board }: { board: PipelineBoard }) {
  const s = board.summary;
  const stats = [
    { label: "Still deciding", value: String(s.open), hint: s.open_value ? `${money(s.open_value)} in prices given` : undefined },
    { label: "Need a call now", value: String(s.needs_action), hint: "Late, or due today", tone: s.needs_action ? "text-bad" : "" },
    { label: "Said yes", value: String(s.won), hint: s.won_value ? `${money(s.won_value)} in first visits` : undefined, tone: "text-good" },
    { label: "Said no", value: String(s.lost), tone: s.lost ? "text-bad" : "" },
  ];
  const funnel = board.funnel.filter((f) => f.stage !== "lost");
  const max = Math.max(1, ...funnel.map((f) => f.count));
  return (
    <Card className="p-6">
      <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4 sm:divide-x sm:divide-line">
        {stats.map((st) => (
          <div key={st.label} className="sm:px-5 sm:first:pl-0">
            <p className="text-[13px] text-muted">{st.label}</p>
            <p className={`tnum mt-1 text-[30px] font-semibold leading-none tracking-title ${st.tone ?? ""}`}>{st.value}</p>
            {st.hint && <p className="mt-1 text-[12px] text-muted">{st.hint}</p>}
          </div>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-4 gap-2 border-t border-line pt-5" aria-label="Leads by stage">
        {funnel.map((f) => (
          <div key={f.stage}>
            <div className="flex h-10 items-end">
              <div
                className={`w-full rounded-md ${f.stage === "won" ? "bg-good" : "bg-accent"} ${f.count ? "" : "opacity-20"}`}
                style={{ height: `${Math.max(8, (f.count / max) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[12px] text-muted">
              {STAGE_LABEL[f.stage]} · <span className="tnum font-medium text-ink">{f.count}</span>
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function OpenLead({ lead, onChange }: { lead: PipelineLead; onChange: () => Promise<void> }) {
  const a = lead.action!;
  const u = URGENCY[a.urgency];
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(stage: "won" | "lost") {
    setBusy(stage);
    try {
      await api.patch(`/intel/leads/${lead.id}`, { stage });
      await onChange();
    } finally {
      setBusy(null);
    }
  }
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${u.cls}`}>{u.label(lead)}</span>
          <span className="text-[12px] text-muted">{STAGE_LABEL[lead.stage]}</span>
        </div>
        <p className="mt-1.5 text-[16px] font-semibold leading-snug tracking-tightish">
          {a.label}
        </p>
        <p className="mt-0.5 text-[14px] text-muted">
          {a.why}
          {a.days_since_contact !== null && ` Last talk: ${a.days_since_contact === 0 ? "today" : `${a.days_since_contact} days ago`}.`}
        </p>
        {a.promised && <p className="mt-1 text-[13px]"><span className="font-medium">We promised:</span> {a.promised}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-muted">
          {lead.rep && (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={lead.rep} size={16} />
              {lead.rep}
            </span>
          )}
          {lead.pests.length > 0 && <span className="capitalize">{lead.pests.slice(0, 3).join(", ")}</span>}
          {lead.value !== null && <span className="tnum">{money(lead.value)}</span>}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {lead.last_call_id && (
          <Link href={`/v2/calls/${lead.last_call_id}`} className="btn-ghost px-3 py-1 text-[13px]">
            Listen to the last call
          </Link>
        )}
        <button className="btn-secondary px-3 py-1 text-[13px]" disabled={!!busy} onClick={() => decide("lost")}>
          {busy === "lost" ? <Spinner className="h-3 w-3" /> : <CrossIcon className="h-3 w-3" />}
          They said no
        </button>
        <button className="btn-primary px-3 py-1 text-[13px]" disabled={!!busy} onClick={() => decide("won")}>
          {busy === "won" ? <Spinner className="h-3 w-3" /> : <CheckIcon className="h-3 w-3" />}
          They said yes
        </button>
      </div>
    </li>
  );
}

function Closed({ leads, onChange }: { leads: PipelineLead[]; onChange: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!leads.length) return null;
  const won = leads.filter((l) => l.stage === "won").length;
  return (
    <section>
      <button
        className="flex w-full items-center justify-between px-1 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          <span className="text-[19px] font-semibold tracking-title">Already decided</span>
          <span className="ml-2 text-[13px] text-muted">
            {won} said yes · {leads.length - won} said no. Nothing to do here.
          </span>
        </span>
        <ChevronIcon className={`h-4 w-4 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <ul className="group-list mt-3">
          {leads.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[14px]">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${
                  l.stage === "won" ? "bg-good" : "bg-bad"
                }`}
              >
                {l.stage === "won" ? <CheckIcon className="h-3 w-3" /> : <CrossIcon className="h-2.5 w-2.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{l.name}</span>
                <span className="text-muted"> · {l.service ?? l.pests.join(", ")}</span>
              </span>
              {l.value !== null && <span className="tnum text-muted">{money(l.value)}</span>}
              <span className="tnum w-16 text-right text-muted">{date(l.last_contact_at)}</span>
              <ReopenButton lead={l} onChange={onChange} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReopenButton({ lead, onChange }: { lead: PipelineLead; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="text-[12px] text-link hover:underline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.patch(`/intel/leads/${lead.id}`, { stage: "follow_up" });
          await onChange();
        } finally {
          setBusy(false);
        }
      }}
    >
      Not decided after all
    </button>
  );
}
