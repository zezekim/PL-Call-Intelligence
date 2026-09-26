"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Lead } from "@/lib/api";
import { STAGES, date, dateTime } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { useCalls } from "@/components/calls-context";
import { ChevronIcon } from "@/components/icons";
import { Avatar, Card, Empty, ErrorNote, Loading } from "@/components/ui";

const STAGE_DOT: Record<string, string> = {
  new: "bg-[#8e8e93]",
  quoted: "bg-[#0a84ff]",
  follow_up: "bg-[#ff9f0a]",
  won: "bg-[#34c759]",
  lost: "bg-[#ff3b30]",
};

export default function PipelinePage() {
  useTitle("Pipeline");
  const { refreshKey } = useCalls();
  const { data, error, loading, reload, setData } = useApi<Lead[]>("/intel/pipeline");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  const leads = data ?? [];

  if (!leads.length) {
    return (
      <Card>
        <Empty title="No leads yet">Every sales call adds or moves a lead here automatically.</Empty>
      </Card>
    );
  }

  const allOpen = leads.every((l) => expanded.has(l.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="footnote max-w-2xl">
          Sales calls create and move leads. Drag a card to move it by hand; the next call with that
          customer moves it again.
        </p>
        <button
          className="btn-ghost"
          onClick={() => setExpanded(allOpen ? new Set() : new Set(leads.map((l) => l.id)))}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {moveError && <ErrorNote message={moveError} />}

      {/* The board fills the window: it scrolls sideways, each column scrolls
          down, so the horizontal scrollbar stays in view however tall the
          expanded cards get. The page itself never scrolls sideways. */}
      <div className="-mx-4 h-[calc(100dvh-16.5rem)] min-h-[420px] overflow-x-auto overflow-y-hidden px-4 pb-3 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
        <div className="flex h-full w-max items-stretch gap-4">
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
                className={`flex h-full w-[310px] shrink-0 flex-col rounded-card p-2.5 transition-colors ${
                  over === stage.value ? "bg-accent-soft" : "bg-black/[0.035]"
                }`}
                aria-label={stage.label}
              >
                <header className="mb-2.5 flex shrink-0 items-center justify-between px-2 pt-1">
                  <span className="flex items-center gap-2 text-[14px] font-semibold tracking-tightish">
                    <span className={`h-2 w-2 rounded-full ${STAGE_DOT[stage.value]}`} />
                    {stage.label}
                  </span>
                  <span className="tnum rounded-full bg-white px-2 py-0.5 text-[12px] text-muted">
                    {cards.length}
                  </span>
                </header>
                <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1 pb-1">
                  {cards.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      open={expanded.has(lead.id)}
                      onToggle={() => toggle(lead.id)}
                      onDragStart={() => setDragging(lead.id)}
                      onMove={(s) => void move(lead, s)}
                    />
                  ))}
                  {!cards.length && (
                    <p className="px-2 py-6 text-center text-[13px] text-faint">No leads</p>
                  )}
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
  open,
  onToggle,
  onDragStart,
  onMove,
}: {
  lead: Lead;
  open: boolean;
  onToggle: () => void;
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
      className={`rounded-[14px] border bg-white shadow-card transition-shadow ${
        open
          ? "border-[#d2d2d7] shadow-[0_6px_20px_rgba(0,0,0,0.08)]"
          : "border-hairline hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
      }`}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full cursor-grab p-3.5 text-left active:cursor-grabbing"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[15px] font-semibold leading-snug tracking-tightish">{lead.name}</p>
          <ChevronIcon
            className={`mt-0.5 h-4 w-4 shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
        </div>
        {lead.pests.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(open ? lead.pests : lead.pests.slice(0, 3)).map((p) => (
              <span key={p} className="rounded-md bg-panel px-1.5 py-0.5 text-[12px] capitalize text-muted">
                {p}
              </span>
            ))}
          </div>
        )}
        {!open && lead.next_step && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-muted">
            <span className="text-ink">Next:</span> {lead.next_step}
          </p>
        )}
        <div className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
          {lead.rep_name && <Avatar name={lead.rep_name} size={18} />}
          <span className="truncate">
            {[lead.rep_name, date(lead.last_contact_at)].filter(Boolean).join(" · ")}
          </span>
          {lead.stage_source === "manual" && <span className="ml-auto shrink-0">Moved by hand</span>}
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-3.5 pb-3.5 pt-3">
          <Detail label="Service discussed" value={lead.service} />
          <Detail label="Price quoted" value={lead.price_quoted} />
          <Detail label="Next step" value={lead.next_step} />
          <div className="grid grid-cols-2 gap-3">
            <Detail label="Calls" value={String(lead.calls)} />
            <Detail label="Last contact" value={dateTime(lead.last_contact_at)} />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <select
              className="select flex-1 py-[5px] text-[13px]"
              value={lead.stage}
              onChange={(e) => onMove(e.target.value)}
              aria-label={`Move ${lead.name}`}
            >
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {lead.last_call_id && (
              <Link href={`/calls/${lead.last_call_id}`} className="btn-secondary shrink-0 px-3 py-[5px] text-[13px]">
                Open call
              </Link>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-0.5 text-[14px] leading-snug">{value || "-"}</p>
    </div>
  );
}
