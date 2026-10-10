"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "@/lib/api";
import { date } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { PipelineBoard, PipelineLead } from "@/lib/v2";
import { cleanPests, listWords, money } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { Tile, type Tint } from "@/components/brand";
import { CallBackIcon, CheckIcon, ChevronIcon, CrossIcon, PhoneIcon, PlayIcon } from "@/components/icons";
import { Card, Empty, Segmented } from "@/components/ui";
import { ListSkeleton, PageError } from "@/components/v2/kit";
import { AllDone, Progress, Tick } from "@/components/v2/focus";
import {
  AddNumber,
  CallButton,
  HowDidItGo,
  LeadCard,
  STAGE_LABEL,
  URGENCY,
  displayName,
  openingLine,
  repWords,
  useSaveLead,
  type LeadChange,
  type Stage,
} from "@/components/v2/customer";

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
  // One person at a time unless the board was chosen.
  const [view, setView] = useState<"board" | "list">("list");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_KEY) === "board") setView("board");
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[17px] text-ink/80">
          {view === "board" ? "Each column shows how far a customer has got. Drag a card, or press Move to…" : "Most urgent first. Call, then tell us how it went."}
        </p>
        <Segmented
          value={view}
          onChange={changeView}
          options={[
            { value: "list", label: "One at a time" },
            { value: "board", label: "Board" },
          ]}
        />
      </div>

      {view === "board" ? (
        <>
          <Summary board={data} />
          <Board board={data} business={business} onChange={change} />
        </>
      ) : (
        <>
          <OneByOne board={data} business={business} onChange={change} onBoard={() => changeView("board")} />
          <Closed leads={data.closed} onReopen={(lead) => change(lead, "follow_up")} />
        </>
      )}
    </div>
  );
}

/**
 * One person at a time, the most urgent first. Their name, what they want,
 * the words to say, and one big green button. Back from the call, it asks how
 * it went; the answer moves them and the next person slides in.
 */
function OneByOne({
  board,
  business,
  onChange,
  onBoard,
}: {
  board: PipelineBoard;
  business: string | null;
  onChange: (lead: PipelineLead, change: LeadChange) => Promise<boolean>;
  onBoard: () => void;
}) {
  // Put off with "Later", or rung with no answer: to the back of the line.
  const [later, setLater] = useState<string[]>([]);
  const [handled, setHandled] = useState(0);
  // How many there were when you started; someone with no answer comes round again.
  const [total] = useState(board.open.length);
  const [asking, setAsking] = useState(false);
  const [cheer, setCheer] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cheerTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(cheerTimer.current), []);

  const queue = [...board.open.filter((l) => !later.includes(l.id)), ...later.map((id) => board.open.find((l) => l.id === id)).filter((l): l is PipelineLead => !!l)];
  const lead = queue[0];
  const toBack = (id: string) => setLater((l) => [...l.filter((x) => x !== id), id]);

  if (cheer) {
    return (
      <section aria-label="Next to call" className="card-in rounded-[30px] border border-hairline bg-surface px-6 py-12 text-center shadow-[0_20px_50px_-24px_rgba(0,0,0,0.25)]">
        <Tick size={96} />
        <h2 className="mt-6 text-[30px] font-bold tracking-title">{cheer} said yes!</h2>
        <p className="mt-2 text-[18px] text-ink/75">Nice work. {queue.length ? "Here comes the next one." : ""}</p>
      </section>
    );
  }
  if (!lead) {
    return <AllDone label="Next to call" title="Everyone has been called" body="People who ask about a service show up here by themselves." />;
  }

  const a = lead.action!;
  const u = URGENCY[a.urgency];
  const name = displayName(lead.name);
  const first = lead.name === "Name not given" ? null : lead.name.split(/\s+/)[0];
  const pests = listWords(cleanPests(lead.pests).slice(0, 2));
  const wants = [pests ? `Wants help with ${pests}` : lead.service, lead.value !== null ? `Price ${money(lead.value)}` : null].filter(Boolean).join(" · ");
  const days = lead.last_contact_at ? Math.max(0, Math.floor((Date.now() - Date.parse(lead.last_contact_at)) / 864e5)) : null;
  const say = openingLine(lead, business);

  const answer = (change: LeadChange) => {
    setAsking(false);
    setHandled((n) => n + 1);
    if (change.stage === "won") {
      setCheer(first ?? "They");
      cheerTimer.current = window.setTimeout(() => setCheer(null), 1600);
    }
    if (change.stage === "follow_up") toBack(lead.id);
    void onChange(lead, change);
  };

  return (
    <div className="grid grid-cols-1 gap-7 min-[1180px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] min-[1180px]:items-start min-[1180px]:gap-5">
      <section
        key={lead.id}
        aria-label="Next to call"
        className="card-in relative overflow-hidden rounded-[30px] border border-hairline bg-surface p-6 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.25)] sm:p-8"
      >
        <span className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-good-soft opacity-70 blur-3xl" aria-hidden />
        <div className="relative flex items-center justify-between gap-3">
          <span className={`whitespace-nowrap rounded-full px-3 py-1 text-[15px] font-semibold ${u.cls}`}>{u.label(lead)}</span>
          <Progress place={Math.min(handled + 1, Math.max(total, 1))} of={Math.max(total, handled + 1)} />
        </div>
        <div className="relative mt-5 flex items-center gap-4">
          <span className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-full bg-good-soft text-[26px] font-bold text-good sm:flex" aria-hidden>
            {(first ?? "?")[0].toUpperCase()}
          </span>
          <div className="min-w-0">
            <h2 className="text-[30px] font-bold leading-tight tracking-title sm:text-[34px]">{name}</h2>
            {wants && <p className="mt-1 text-[19px] text-ink/80">{wants}</p>}
          </div>
        </div>
        <p className="relative mt-3 text-[17px] text-ink/70">
          {lead.rep && <>Talked to {repWords(lead.rep)}{lead.last_contact_at && <> on {date(lead.last_contact_at)}</>}. </>}
          {days !== null && days > 0 && <>Nobody has called in {days < 14 ? `${days} day${days === 1 ? "" : "s"}` : days < 60 ? `${Math.round(days / 7)} weeks` : `${Math.round(days / 30)} months`}.</>}
        </p>
        {a.promised && (
          <p className="relative mt-2 text-[17px]">
            <span className="font-semibold">We promised:</span> {a.promised}
          </p>
        )}

        <div className="relative mt-5 rounded-[20px] bg-panel p-4">
          <p className="text-[15px] font-semibold uppercase tracking-wide text-ink/70">When they pick up, say</p>
          <p className="mt-1.5 text-[18px] leading-relaxed">“{say}”</p>
          <button
            className="press mt-1 min-h-[44px] text-[16px] font-medium text-link"
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
            {copied ? "Copied ✓" : "Copy the words"}
          </button>
        </div>

        <div className="relative mt-6 space-y-3">
          {asking ? (
            <HowDidItGo name={lead.name} onCancel={() => setAsking(false)} onAnswer={answer} />
          ) : (
            <>
              {lead.phone ? (
                <CallButton
                  phone={lead.phone}
                  pretty={lead.phone_pretty}
                  name={lead.name}
                  className="min-h-[64px] w-full text-[20px] shadow-[0_14px_30px_-12px_rgba(23,115,58,0.7)]"
                  onCalled={() => window.setTimeout(() => setAsking(true), 600)}
                />
              ) : (
                <AddNumber name={lead.name} onSave={async (phone) => onChange(lead, { phone })} />
              )}
              <div className="grid grid-cols-2 gap-3">
                <button className="btn-secondary min-h-[52px] px-3 text-[17px]" onClick={() => setAsking(true)}>
                  Already called
                </button>
                <button className="btn-secondary min-h-[52px] px-3 text-[17px]" onClick={() => toBack(lead.id)} disabled={queue.length < 2}>
                  Later
                </button>
              </div>
              {lead.last_call_id && (
                <Link href={`/v2/calls/${lead.last_call_id}`} className="press flex min-h-[44px] items-center justify-center gap-1.5 text-[16px] font-medium text-link hover:no-underline">
                  <PlayIcon className="h-3 w-3" />
                  Hear the last call
                </Link>
              )}
            </>
          )}
        </div>
      </section>

      <div className="space-y-7">
        {queue.length > 1 && (
          <section aria-label="After this" className="settle">
            <div className="mb-2 flex items-center justify-between gap-2 px-1 min-[1180px]:-mt-2">
              <h2 className="text-[20px] font-semibold tracking-title">After this</h2>
              <button className="press min-h-[44px] rounded-full px-3 text-[16px] font-medium text-link hover:bg-accent-soft/60" onClick={onBoard}>
                See everyone
              </button>
            </div>
            <ul className="group-list">
              {queue.slice(1, 4).map((l) => (
                <li key={l.id} className="flex min-h-[64px] items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good-soft text-[15px] font-bold text-good" aria-hidden>
                    {(l.name === "Name not given" ? "?" : l.name[0]).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold">{displayName(l.name)}</span>
                    <span className="block truncate text-[15px] text-ink/70">{l.action ? URGENCY[l.action.urgency].label(l) : ""}</span>
                  </span>
                  {l.value !== null && <span className="tnum text-[16px] font-semibold">{money(l.value)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <Summary board={board} compact />
      </div>
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
          <span className="flex items-center gap-2 text-[17px] font-semibold leading-tight">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
            {STAGE_LABEL[stage]}
          </span>
          <span className="tnum rounded-full bg-surface px-2.5 py-0.5 text-[16px] font-semibold">{cards.length}</span>
        </header>
        {worth > 0 && <p className="-mt-2 mb-2 px-1.5 text-[16px] text-ink/70">{money(worth)} in prices</p>}
        {!cards.length && !dragging && <p className="px-1.5 pb-1 pt-2 text-[16px] text-ink/80">Nobody here right now.</p>}
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
            <li className="rounded-2xl border-2 border-dashed border-accent/40 px-3 py-5 text-center text-[16px] text-muted">
              Drop here
            </li>
          )}
        </ul>
        {cards.length > COLUMN_SHOWN && (
          <button
            className="btn-secondary mt-2.5 min-h-[44px] text-[16px]"
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

function Summary({ board, compact = false }: { board: PipelineBoard; compact?: boolean }) {
  const s = board.summary;
  const stats: { label: string; value: string; hint?: string; tone: string; tint: Tint; Icon: (p: { className?: string }) => React.ReactNode }[] = [
    { label: "Need a call now", value: String(s.needs_action), hint: "Late or due today", tone: s.needs_action ? "text-bad" : "", tint: "orange", Icon: CallBackIcon },
    { label: "Still deciding", value: String(s.open), hint: s.open_value ? `${money(s.open_value)} in prices` : undefined, tone: "", tint: "blue", Icon: PhoneIcon },
    { label: "Said yes", value: String(s.won), hint: s.won_value ? `${money(s.won_value)} in first visits` : undefined, tone: s.won ? "text-good" : "", tint: "green", Icon: CheckIcon },
  ];
  if (compact) {
    // Beside the card: one small list, a row each.
    return (
      <section aria-label="How call backs are going">
        <h2 className="mb-2 px-1 text-[20px] font-semibold tracking-title">So far</h2>
        <ul className="group-list">
          {stats.map(({ label, value, hint, tone, tint, Icon }) => (
            <li key={label} className="flex min-h-[64px] items-center gap-3 px-4 py-3">
              <Tile tint={tint} size={30}>
                <Icon />
              </Tile>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold">{label}</span>
                {hint && <span className="block text-[15px] text-ink/70">{hint}</span>}
              </span>
              <span className={`tnum text-[24px] font-bold ${tone}`}>{value}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section aria-label="How call backs are going" className="settle grid grid-cols-3 gap-3">
      {stats.map(({ label, value, hint, tone, tint, Icon }) => (
        <div key={label} className="rounded-[22px] border border-hairline bg-surface p-4 shadow-card">
          <Tile tint={tint} size={26}>
            <Icon />
          </Tile>
          <p className="mt-2 text-[15px] font-semibold leading-tight text-ink/75">{label}</p>
          <p className={`tnum mt-1 text-[30px] font-bold leading-none tracking-title ${tone}`}>{value}</p>
          {hint && <p className="mt-1 hidden text-[15px] text-ink/70 sm:block">{hint}</p>}
        </div>
      ))}
    </section>
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
        className="press flex min-h-[52px] w-full items-center justify-between rounded-2xl px-1 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          <span className="text-[19px] font-semibold tracking-title">Already decided</span>
          <span className="ml-2 text-[16px] text-ink/70">
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
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[16px]">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${
                    l.stage === "won" ? "bg-good" : "bg-bad"
                  }`}
                  aria-label={l.stage === "won" ? "Said yes" : "Said no"}
                >
                  {l.stage === "won" ? <CheckIcon className="h-3 w-3" /> : <CrossIcon className="h-2.5 w-2.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{displayName(l.name)}</span>
                  {what && <span className="text-ink/70"> · {what}</span>}
                </span>
                {l.value !== null && <span className="tnum">{money(l.value)}</span>}
                <span className="tnum w-16 text-right text-ink/70">{date(l.last_contact_at)}</span>
                <button className="min-h-[44px] text-[16px] font-medium text-link hover:underline" onClick={() => onReopen(l)}>
                  Move back to Still deciding
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
