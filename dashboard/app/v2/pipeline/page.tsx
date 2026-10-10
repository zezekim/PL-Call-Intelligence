"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Me } from "@/lib/api";
import { date } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { PipelineBoard, PipelineLead } from "@/lib/v2";
import { cleanPests, listWords, money } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { CheckIcon, ChevronIcon, CrossIcon } from "@/components/icons";
import { Avatar, Card, Empty, Segmented } from "@/components/ui";
import { ListSkeleton, PageError, Section } from "@/components/v2/kit";
import { CallButton, LeadCard, STAGE_LABEL, URGENCY, openingLine, useSaveLead, type LeadChange, type Stage } from "@/components/v2/customer";

// The board, left to right: how far each customer has got.
const COLUMNS: { stage: Stage; dot: string }[] = [
  { stage: "new", dot: "bg-[#8e8e93]" },
  { stage: "quoted", dot: "bg-accent" },
  { stage: "follow_up", dot: "bg-warn" },
  { stage: "won", dot: "bg-good" },
  { stage: "lost", dot: "bg-bad" },
];
const VIEW_KEY = "pestlaunch.callback.view";
// A long column shows this many, then "Show N more".
const COLUMN_SHOWN = 5;

/** Moves a lead on the board at once, before the server answers. */
function moveLead(board: PipelineBoard, id: string, stage: Stage): PipelineBoard {
  const lead = [...board.open, ...board.closed].find((l) => l.id === id);
  if (!lead) return board;
  const open = board.open.filter((l) => l.id !== id);
  const closed = board.closed.filter((l) => l.id !== id);
  const s = { ...board.summary };
  if (lead.action) {
    s.open -= 1;
    if (lead.action.urgency !== "upcoming") s.needs_action -= 1;
    s.open_value -= lead.value ?? 0;
  } else if (lead.stage === "won") {
    s.won -= 1;
    s.won_value -= lead.value ?? 0;
  } else if (lead.stage === "lost") s.lost -= 1;
  if (stage !== "won" && stage !== "lost") {
    // Still open: moved within the board at once. One coming back from yes or
    // no gets its next step from the server on the reload.
    if (lead.action) return { ...board, open: board.open.map((l) => (l.id === id ? { ...l, stage } : l)) };
    return { ...board, open, closed, summary: s };
  }
  if (stage === "won") {
    s.won += 1;
    s.won_value += lead.value ?? 0;
  } else s.lost += 1;
  return { ...board, open, closed: [{ ...lead, stage, action: null }, ...closed], summary: s };
}

export default function PipelinePage() {
  useTitle("Call back");
  const { refreshKey } = useCalls();
  const { data, error, status, loading, reload, setData } = useApi<PipelineBoard>("/intel/v2/pipeline");
  const me = useApi<Me>("/auth/me").data;
  const business = me?.business_name ?? null;
  const [view, setView] = useState<"board" | "list">("board");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const changeView = (v: "board" | "list") => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  const save = useSaveLead(reload);
  const change = useCallback(
    async (lead: PipelineLead, c: LeadChange | Stage) => {
      const next: LeadChange = typeof c === "string" ? { stage: c } : c;
      if (!data) return false;
      // Moves show at once; the server's answer comes on the reload.
      if (next.stage) setData(moveLead(data, lead.id, next.stage));
      return save(lead, next);
    },
    [data, save, setData],
  );

  if (loading && !data) return <ListSkeleton rows={5} />;
  if (error && !data) return <PageError status={status} onRetry={() => void reload()} />;
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
    <div className="space-y-6">
      <Summary board={data} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[16px] text-ink/80">
          {view === "board"
            ? "Drag a card to move it, or tap Said yes or Said no."
            : s.open
              ? "The most urgent is at the top."
              : "Everyone has said yes or no."}
        </p>
        <Segmented
          value={view}
          onChange={changeView}
          options={[
            { value: "board", label: "Board" },
            { value: "list", label: "List" },
          ]}
        />
      </div>

      {view === "board" ? (
        <Board board={data} business={business} onChange={change} />
      ) : (
        <>
          <Section title="Call these people">
            {data.open.length ? (
              <ul className="group-list">
                {data.open.map((lead) => (
                  <OpenLead key={lead.id} lead={lead} business={business} onDecide={(stage) => change(lead, stage)} />
                ))}
              </ul>
            ) : (
              <Card className="flex items-center gap-3 px-5 py-4">
                <CheckIcon className="h-5 w-5 text-good" />
                <p className="text-[15px]">You're all caught up. Nobody to chase.</p>
              </Card>
            )}
          </Section>
          <Closed leads={data.closed} onReopen={(lead) => change(lead, "follow_up")} />
        </>
      )}
    </div>
  );
}

/**
 * The call-back board: one column per step, left to right, like a Trello
 * board. Drag a card to another column, or tap Move on it (which also works on
 * a phone), or ring them and say how it went.
 */
function Board({
  board,
  business,
  onChange,
}: {
  board: PipelineBoard;
  business: string | null;
  onChange: (lead: PipelineLead, change: LeadChange) => Promise<boolean>;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [expanded, setExpanded] = useState<Stage[]>([]);
  const all = [...board.open, ...board.closed];

  const column = (stage: Stage, dot: string) => {
    const cards = (stage === "won" || stage === "lost" ? board.closed : board.open).filter((l) => l.stage === stage);
    const worth = cards.reduce((sum, l) => sum + (l.value ?? 0), 0);
    const shown = expanded.includes(stage) ? cards : cards.slice(0, COLUMN_SHOWN);
    return (
      <section
        key={stage}
        aria-label={STAGE_LABEL[stage]}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(stage);
        }}
        onDragLeave={() => setOver((o) => (o === stage ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          const lead = all.find((l) => l.id === dragging);
          if (lead && lead.stage !== stage) void onChange(lead, { stage });
          setDragging(null);
          setOver(null);
        }}
        className={`flex flex-col rounded-[22px] p-3 transition-colors ${
          over === stage ? "bg-accent-soft ring-2 ring-accent/50" : "bg-ink/[0.04]"
        }`}
      >
        <header className={`flex items-center justify-between gap-2 px-1.5 pt-1 ${cards.length || dragging ? "mb-3" : ""}`}>
          <span className="flex items-center gap-2 text-[16px] font-semibold leading-tight">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
            {STAGE_LABEL[stage]}
          </span>
          <span className="tnum rounded-full bg-surface px-2.5 py-0.5 text-[14px] font-semibold">{cards.length}</span>
        </header>
        {worth > 0 && <p className="-mt-2 mb-2 px-1.5 text-[14px] text-muted">{money(worth)}</p>}
        <ul className="flex flex-col gap-2.5">
          {shown.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              business={business}
              draggable
              dragging={dragging === lead.id}
              onDragStart={() => setDragging(lead.id)}
              onDragEnd={() => setDragging(null)}
              onChange={(c) => onChange(lead, c)}
            />
          ))}
          {!cards.length && dragging && (
            <li className="rounded-2xl border-2 border-dashed border-accent/40 px-3 py-5 text-center text-[14px] text-muted">
              Drop here
            </li>
          )}
        </ul>
        {cards.length > COLUMN_SHOWN && (
          <button
            className="btn-secondary mt-2.5 min-h-[44px] text-[15px]"
            onClick={() => setExpanded((x) => (x.includes(stage) ? x.filter((s) => s !== stage) : [...x, stage]))}
          >
            {expanded.includes(stage) ? "Show less" : `Show ${cards.length - COLUMN_SHOWN} more`}
          </button>
        )}
      </section>
    );
  };

  // Four columns side by side on a laptop, two on a tablet; on a phone they
  // slide sideways one at a time.
  return (
    <div className="-mx-4 snap-x snap-mandatory overflow-x-auto px-4 pb-4 sm:mx-0 sm:overflow-visible sm:px-0">
      <div className="grid grid-flow-col auto-cols-[min(84vw,300px)] items-start gap-3 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 min-[1100px]:grid-cols-4">
        {COLUMNS.slice(0, 3).map(({ stage, dot }) => (
          <div key={stage} className="snap-start">
            {column(stage, dot)}
          </div>
        ))}
        <div className="flex snap-start flex-col gap-3">
          {column("won", "bg-good")}
          {column("lost", "bg-bad")}
        </div>
      </div>
    </div>
  );
}

function Summary({ board }: { board: PipelineBoard }) {
  const s = board.summary;
  const stats = [
    { label: "Need a call now", value: String(s.needs_action), hint: "Late, or due today", tone: s.needs_action ? "text-bad" : "" },
    { label: "Still deciding", value: String(s.open), hint: s.open_value ? `${money(s.open_value)} in prices given` : undefined },
    { label: "Said yes", value: String(s.won), hint: s.won_value ? `${money(s.won_value)} in first visits` : undefined, tone: s.won ? "text-good" : "" },
  ];
  return (
    <Card className="grid grid-cols-3 p-5 sm:p-6">
      {stats.map((st, i) => (
        <div key={st.label} className={i ? "border-l border-line pl-4 sm:pl-6" : "pr-4"}>
          <p className="text-[15px] text-ink/80">{st.label}</p>
          <p className={`tnum mt-1 text-[30px] font-semibold leading-none tracking-title ${st.tone ?? ""}`}>{st.value}</p>
          {st.hint && <p className="mt-1 hidden text-[14px] text-muted sm:block">{st.hint}</p>}
        </div>
      ))}
    </Card>
  );
}

function OpenLead({
  lead,
  business,
  onDecide,
}: {
  lead: PipelineLead;
  business: string | null;
  onDecide: (stage: "won" | "lost") => void;
}) {
  const a = lead.action!;
  const u = URGENCY[a.urgency];
  const say = openingLine(lead, business);
  const [copied, setCopied] = useState(false);
  // "Late by 3 days" already says how long; otherwise say when we last talked.
  const lastTalk =
    a.urgency !== "overdue" && a.days_since_contact !== null
      ? `last talk ${a.days_since_contact === 0 ? "today" : `${a.days_since_contact} days ago`}`
      : null;
  const meta = [listWords(cleanPests(lead.pests).slice(0, 3)) || null, lead.value !== null ? money(lead.value) : null, lastTalk]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${u.cls}`}>{u.label(lead)}</span>
          <span className="text-[12px] text-muted">{STAGE_LABEL[lead.stage as Stage]}</span>
        </div>
        <p className="mt-1.5 text-[16px] font-semibold leading-snug tracking-tightish">{a.label}</p>
        {(lead.rep || meta) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
            {lead.rep && (
              <span className="inline-flex items-center gap-1.5">
                <Avatar name={lead.rep} size={16} />
                {lead.rep}
              </span>
            )}
            {lead.rep && meta && <span aria-hidden>·</span>}
            {meta && <span>{meta}</span>}
          </p>
        )}
        {a.promised && (
          <p className="mt-1.5 text-[13px]">
            <span className="font-medium">We promised:</span> {a.promised}
          </p>
        )}
        <div className="mt-2.5 flex items-start gap-3 rounded-xl bg-panel px-3.5 py-2.5">
          <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-ink/90">
            <span className="mr-1.5 text-[12px] font-medium text-muted">Say</span>“{say}”
          </p>
          <button
            className="shrink-0 pt-0.5 text-[12px] font-medium text-link hover:underline"
            aria-label="Copy what to say"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(say);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              } catch {
                /* clipboard blocked: the words are on screen anyway */
              }
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-6">
        {lead.phone && <CallButton phone={lead.phone} pretty={lead.phone_pretty} name={lead.name} />}
        {lead.last_call_id && (
          <Link href={`/v2/calls/${lead.last_call_id}`} className="btn-ghost px-3 py-1 text-[13px]">
            Listen
          </Link>
        )}
        <button className="btn-secondary px-3 py-1 text-[13px]" onClick={() => onDecide("lost")}>
          <CrossIcon className="h-3 w-3" />
          Said no
        </button>
        <button className="btn-primary px-3 py-1 text-[13px]" onClick={() => onDecide("won")}>
          <CheckIcon className="h-3 w-3" />
          Said yes
        </button>
      </div>
    </li>
  );
}

function Closed({ leads, onReopen }: { leads: PipelineLead[]; onReopen: (lead: PipelineLead) => void }) {
  // Nothing to do here, so it waits folded away.
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
            {won} said yes · {leads.length - won} said no
          </span>
        </span>
        <ChevronIcon className={`h-4 w-4 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <ul className="group-list mt-3">
          {leads.map((l) => {
            const what = l.service ?? (listWords(cleanPests(l.pests)) || null);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[14px]">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${
                    l.stage === "won" ? "bg-good" : "bg-bad"
                  }`}
                  aria-label={l.stage === "won" ? "Said yes" : "Said no"}
                >
                  {l.stage === "won" ? <CheckIcon className="h-3 w-3" /> : <CrossIcon className="h-2.5 w-2.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{l.name}</span>
                  {what && <span className="text-muted"> · {what}</span>}
                </span>
                {l.value !== null && <span className="tnum text-muted">{money(l.value)}</span>}
                <span className="tnum w-16 text-right text-muted">{date(l.last_contact_at)}</span>
                <button className="text-[12px] text-link hover:underline" onClick={() => onReopen(l)}>
                  Not decided after all
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
