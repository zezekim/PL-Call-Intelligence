"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Lead } from "@/lib/api";
import { STAGES, date } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useCalls } from "@/components/calls-context";
import { Avatar, Card, Empty, ErrorNote, Loading } from "@/components/ui";

const STAGE_DOT: Record<string, string> = {
  new: "bg-[#8e8e93]",
  quoted: "bg-[#0a84ff]",
  follow_up: "bg-[#ff9f0a]",
  won: "bg-[#34c759]",
  lost: "bg-[#ff3b30]",
};

export default function PipelinePage() {
  const { refreshKey } = useCalls();
  const { data, error, loading, reload, setData } = useApi<Lead[]>("/intel/pipeline");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  async function move(lead: Lead, stage: string) {
    if (lead.stage === stage || !data) return;
    const previous = data;
    setData(data.map((l) => (l.id === lead.id ? { ...l, stage, stage_source: "manual" } : l)));
    try {
      await api.patch(`/intel/leads/${lead.id}`, { stage });
      setMoveError(null);
    } catch (err) {
      setData(previous);
      setMoveError(err instanceof Error ? err.message : "Could not move lead");
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  const leads = data ?? [];

  if (!leads.length) {
    return (
      <Card className="p-6">
        <Empty title="No leads yet">Every sales call adds or moves a lead here automatically.</Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="footnote px-1">
        Leads are created and moved by sales calls. Drag a card to move it by hand; the next call
        with that customer moves it again.
      </p>
      {moveError && <ErrorNote message={moveError} />}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[980px] grid-cols-5 gap-3">
          {STAGES.map((stage) => {
            const cards = leads.filter((l) => l.stage === stage.value);
            return (
              <section
                key={stage.value}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(stage.value);
                }}
                onDragLeave={() => setOver((o) => (o === stage.value ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const lead = leads.find((l) => l.id === dragging);
                  if (lead) void move(lead, stage.value);
                  setDragging(null);
                  setOver(null);
                }}
                className={`flex min-h-[360px] flex-col rounded-card p-2 transition-colors ${
                  over === stage.value ? "bg-accent-soft" : "bg-black/[0.035]"
                }`}
                aria-label={stage.label}
              >
                <header className="mb-2 flex items-center justify-between px-2 pt-1.5">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <span className={`h-2 w-2 rounded-full ${STAGE_DOT[stage.value]}`} />
                    {stage.label}
                  </span>
                  <span className="tnum text-xs text-muted">{cards.length}</span>
                </header>
                <div className="flex flex-col gap-2">
                  {cards.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onDragStart={() => setDragging(lead.id)}
                      onMove={(s) => void move(lead, s)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  onDragStart,
  onMove,
}: {
  lead: Lead;
  onDragStart: () => void;
  onMove: (stage: string) => void;
}) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      className="cursor-grab rounded-[14px] border border-hairline bg-white p-3.5 shadow-card transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px] font-semibold leading-snug tracking-tightish">{lead.name}</p>
        {lead.stage_source === "manual" && (
          <span className="shrink-0 text-[11px] text-muted" title="Moved by hand">
            Manual
          </span>
        )}
      </div>
      {lead.pests.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {lead.pests.slice(0, 3).map((p) => (
            <span key={p} className="rounded-md bg-panel px-1.5 py-0.5 text-[11px] capitalize text-muted">
              {p}
            </span>
          ))}
        </div>
      )}
      {lead.price_quoted && <p className="mt-2 line-clamp-2 text-[12px] leading-snug">{lead.price_quoted}</p>}
      {lead.next_step && (
        <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-muted">
          <span className="font-medium text-ink">Next:</span> {lead.next_step}
        </p>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          {lead.rep_name && <Avatar name={lead.rep_name} size={18} />}
          <span className="truncate">
            {[lead.rep_name, date(lead.last_contact_at)].filter(Boolean).join(" · ")}
          </span>
        </span>
        {lead.last_call_id && (
          <Link href={`/calls/${lead.last_call_id}`} className="shrink-0 text-[12px] text-link hover:underline">
            Call
          </Link>
        )}
      </div>
      <label className="sr-only" htmlFor={`move-${lead.id}`}>
        Move {lead.name}
      </label>
      <select
        id={`move-${lead.id}`}
        className="mt-2 w-full rounded-lg border-0 bg-panel px-2 py-1 text-[12px] text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
        value={lead.stage}
        onChange={(e) => onMove(e.target.value)}
      >
        {STAGES.map((s) => (
          <option key={s.value} value={s.value}>
            Move to {s.label}
          </option>
        ))}
      </select>
    </article>
  );
}
