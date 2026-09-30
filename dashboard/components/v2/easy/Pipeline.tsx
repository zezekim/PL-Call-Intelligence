"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { plural } from "@/lib/easy";
import { date } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { PipelineBoard, PipelineLead, Status, Urgency } from "@/lib/v2";
import { money } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { ErrorNote, Loading, Spinner } from "@/components/ui";
import { BigLink, Panel, Reveal, Section, StatusBadge, StatusIcon, bigButton, easyLink } from "@/components/v2/kit";

function urgency(l: PipelineLead): { status: Status; label: string } {
  const u: Urgency = l.action?.urgency ?? "upcoming";
  if (u === "overdue") {
    const late = l.action?.due_at ? Math.max(1, Math.round((Date.now() - Date.parse(l.action.due_at)) / 864e5)) : 0;
    return { status: "bad", label: late ? `Late by ${plural(late, "day")}` : "Late" };
  }
  if (u === "today") return { status: "watch", label: "Call today" };
  if (u === "cold") return { status: "watch", label: "Waiting a long time" };
  return { status: "none", label: l.action?.due_at ? `Call by ${date(l.action.due_at)}` : "Call soon" };
}

export function PipelineEasy() {
  useTitle("Call back");
  const { refreshKey } = useCalls();
  const { data, error, loading, reload } = useApi<PipelineBoard>("/intel/v2/pipeline");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  const s = data.summary;
  return (
    <div className="space-y-12">
      <Panel>
        <div className="grid gap-6 sm:grid-cols-3">
          <Number value={s.open} label={s.open === 1 ? "person to call back" : "people to call back"} />
          <Number value={s.won} label="said yes" hint={s.won_value ? `${money(s.won_value)} in first visits` : undefined} />
          <Number value={s.lost} label="said no" />
        </div>
      </Panel>

      {saved && (
        <div className="flex items-center gap-3 rounded-[18px] bg-good-soft px-6 py-4 text-[20px] font-semibold" role="status">
          <StatusIcon status="good" size={26} />
          {saved}
        </div>
      )}

      <Section
        title={data.open.length ? "Call these people" : "Nobody to call back"}
        intro={data.open.length ? "The most urgent is at the top. After you call, press what they said." : "Everyone has said yes or no."}
      >
        <ul className="space-y-4">
          {data.open.map((lead) => (
            <Lead
              key={lead.id}
              lead={lead}
              onDecided={async (text) => {
                setSaved(text);
                await reload();
              }}
            />
          ))}
        </ul>
      </Section>

      <Decided leads={data.closed} onChange={reload} />
    </div>
  );
}

function Number({ value, label, hint }: { value: number; label: string; hint?: string }) {
  return (
    <div>
      <p className="text-[48px] font-bold leading-none tracking-title">{value}</p>
      <p className="mt-2 text-[20px] font-semibold">{label}</p>
      {hint && <p className="mt-0.5 text-[17px] text-ink/80">{hint}</p>}
    </div>
  );
}

function Lead({ lead, onDecided }: { lead: PipelineLead; onDecided: (text: string) => Promise<void> }) {
  const a = lead.action!;
  const u = urgency(lead);
  const [busy, setBusy] = useState<"won" | "lost" | null>(null);
  async function decide(stage: "won" | "lost") {
    setBusy(stage);
    try {
      await api.patch(`/intel/leads/${lead.id}`, { stage });
      await onDecided(`Saved: ${lead.name} said ${stage === "won" ? "yes" : "no"}.`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <li>
      <Panel>
        <StatusBadge status={u.status} label={u.label} />
        <h3 className="mt-3 text-[26px] font-bold leading-tight tracking-title">{a.label}</h3>
        <p className="mt-2 text-[20px] leading-relaxed">{a.why}</p>
        {a.days_since_contact !== null && (
          <p className="mt-1 text-[18px] text-ink/80">
            Last talk: {a.days_since_contact === 0 ? "today" : `${plural(a.days_since_contact, "day")} ago`}
            {lead.rep ? `, with ${lead.rep}` : ""}.
          </p>
        )}
        {a.promised && (
          <p className="mt-3 rounded-[14px] bg-warn-soft px-4 py-3 text-[18px] leading-relaxed">
            <span className="font-semibold">We promised: </span>
            {a.promised}
          </p>
        )}
        {lead.pests.length > 0 && (
          <p className="mt-3 text-[18px] text-ink/80">
            About: <span className="capitalize">{lead.pests.slice(0, 4).join(", ")}</span>
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3 border-t-2 border-line pt-5">
          <button className={bigButton.good} disabled={!!busy} onClick={() => decide("won")}>
            {busy === "won" ? <Spinner className="h-4 w-4" /> : <span aria-hidden>✓</span>}
            They said yes
          </button>
          <button className={bigButton.danger} disabled={!!busy} onClick={() => decide("lost")}>
            {busy === "lost" ? <Spinner className="h-4 w-4" /> : <span aria-hidden>✕</span>}
            They said no
          </button>
          {lead.last_call_id && (
            <BigLink href={`/v2/calls/${lead.last_call_id}`} kind="secondary">
              ▶ Listen to the last call
            </BigLink>
          )}
        </div>
      </Panel>
    </li>
  );
}

function Decided({ leads, onChange }: { leads: PipelineLead[]; onChange: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!leads.length) return null;
  const yes = leads.filter((l) => l.stage === "won").length;
  return (
    <Section title="Already decided" intro={`${yes} said yes and ${leads.length - yes} said no. Nothing to do here.`}>
      <Reveal open={open} onToggle={() => setOpen((o) => !o)} more={`Show all ${leads.length}`} less="Hide them" />
      {open && (
        <ul className="mt-4 space-y-3">
          {leads.map((l) => (
            <li key={l.id}>
              <Panel className="flex flex-wrap items-center gap-4 !py-4">
                <StatusBadge status={l.stage === "won" ? "good" : "bad"} label={l.stage === "won" ? "Said yes" : "Said no"} />
                <span className="min-w-0 flex-1 text-[20px] font-semibold">{l.name}</span>
                <span className="text-[18px] text-ink/80">{date(l.last_contact_at)}</span>
                <Undo lead={l} onChange={onChange} />
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Undo({ lead, onChange }: { lead: PipelineLead; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`min-h-[44px] rounded-full px-4 text-[17px] ${easyLink}`}
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
