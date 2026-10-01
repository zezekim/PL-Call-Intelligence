"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "@/lib/api";
import { date } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { PipelineBoard, PipelineLead, Urgency } from "@/lib/v2";
import { cleanPests, listWords, money } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { CheckIcon, ChevronIcon, CrossIcon } from "@/components/icons";
import { Avatar, Card, Empty } from "@/components/ui";
import { ListSkeleton, PageError, Section } from "@/components/v2/kit";
import { failMessage, useToast } from "@/components/v2/toast";

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

type Stage = "won" | "lost" | "follow_up";

/**
 * What to say when they pick up, from what the call already told us: their
 * name, the price, the pests, who they spoke to. Plain enough to read out.
 */
function openingLine(lead: PipelineLead, business: string | null): string {
  const first = lead.name === "Name not given" ? null : lead.name.split(/\s+/)[0];
  const hi = first ? `Hi ${first}` : "Hi there";
  const person = lead.rep && !/receptionist|\bai\b/i.test(lead.rep) ? lead.rep.split(/\s+/)[0] : null;
  const from = person && business ? `, it's ${person} from ${business}` : business ? `, it's ${business}` : person ? `, it's ${person}` : "";
  const pests = cleanPests(lead.pests);
  const about = pests.length ? `the ${listWords(pests.slice(0, 2))}` : lead.service ? lead.service.toLowerCase() : "your pest problem";
  const price = lead.value !== null ? `the ${money(lead.value)} quote` : lead.price_quoted ? `the quote we gave you` : null;
  if (lead.action?.label.startsWith("Confirm")) {
    return `${hi}${from}. I'm calling to confirm your visit for ${about}. Does the time still work for you?`;
  }
  if (lead.stage === "quoted" && price) {
    return `${hi}${from}. I'm following up on ${price} for ${about}. Do you have any questions I can answer?`;
  }
  if (lead.stage === "follow_up" || lead.stage === "quoted") {
    return `${hi}${from}. You wanted some time to think about ${about}. Is now a good time to talk it through?`;
  }
  return `${hi}${from}. You called us about ${about}. I'd love to help. When would be a good time for us to come out?`;
}

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
  if (stage === "follow_up") {
    // Back on the list; the server works out its next step on the reload.
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
  const toast = useToast();
  const { data, error, status, loading, reload, setData } = useApi<PipelineBoard>("/intel/v2/pipeline");
  const me = useApi<Me>("/auth/me").data;
  const business = me?.business_name ?? null;

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  const change = useCallback(
    async (lead: PipelineLead, stage: Stage, undoable = true) => {
      if (!data) return;
      const before = data;
      const was = lead.stage;
      setData(moveLead(data, lead.id, stage));
      try {
        await api.patch(`/intel/leads/${lead.id}`, { stage });
        const message =
          stage === "won" ? `${lead.name} said yes` : stage === "lost" ? `${lead.name} said no` : `${lead.name} is back on the list`;
        toast({
          message,
          undo: undoable
            ? async () => {
                try {
                  await api.patch(`/intel/leads/${lead.id}`, { stage: was });
                } catch {
                  toast({ message: failMessage(), tone: "error" });
                }
                await reload();
              }
            : undefined,
        });
        await reload();
      } catch {
        setData(before);
        toast({ message: failMessage(), tone: "error" });
      }
    },
    [data, reload, setData, toast],
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
    <div className="space-y-8">
      <Summary board={data} />

      <Section
        title="Call these people"
        subtitle={s.open ? "The most urgent is at the top." : "Everyone has said yes or no."}
      >
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
          <p className="text-[13px] text-muted">{st.label}</p>
          <p className={`tnum mt-1 text-[30px] font-semibold leading-none tracking-title ${st.tone ?? ""}`}>{st.value}</p>
          {st.hint && <p className="mt-1 hidden text-[12px] text-muted sm:block">{st.hint}</p>}
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
          <span className="text-[12px] text-muted">{STAGE_LABEL[lead.stage]}</span>
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
