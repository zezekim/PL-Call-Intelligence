"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { date } from "@/lib/format";
import type { PipelineLead, Urgency } from "@/lib/v2";
import { cleanPests, listWords, money } from "@/lib/v2";
import { CheckIcon, ChevronIcon, CrossIcon, PhoneIcon, PlayIcon, RefreshIcon } from "@/components/icons";
import { Avatar, Spinner } from "@/components/ui";
import { failMessage, useToast } from "@/components/v2/toast";

/*
 * One customer, one card, the same everywhere: on the call-back board and
 * when a job on Today is opened. The big button rings them; afterwards the
 * card asks how it went, so the board moves itself.
 */

export type Stage = "new" | "quoted" | "follow_up" | "won" | "lost";

export const STAGE_LABEL: Record<Stage, string> = {
  new: "Asked about a service",
  quoted: "Got a price",
  follow_up: "Still deciding",
  won: "Said yes",
  lost: "Said no",
};

export const URGENCY: Record<Urgency, { label: (l: PipelineLead) => string; cls: string }> = {
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

/**
 * What to say when they pick up, from what the call already told us: their
 * name, the price, the pests, who they spoke to. Plain enough to read out.
 */
export function openingLine(lead: PipelineLead, business: string | null): string {
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

/** What a card can ask for: a new column, "called, try later", or a number to keep. */
export type LeadChange = { stage?: Stage; called?: boolean; phone?: string };

/**
 * The big green button. On a phone it rings them; on a computer it opens the
 * computer's calling app if there is one, and the number is right there to
 * read out either way.
 */
export function CallButton({
  phone,
  pretty,
  name,
  onCalled,
  className = "",
}: {
  phone: string;
  pretty?: string;
  name?: string | null;
  onCalled?: () => void;
  className?: string;
}) {
  const first = name && name !== "Name not given" ? name.split(/\s+/)[0] : null;
  return (
    <a
      href={`tel:${phone}`}
      onClick={() => onCalled?.()}
      className={`inline-flex min-h-[52px] items-center justify-center gap-2.5 rounded-2xl bg-[#17733a] px-5 text-[18px] font-semibold text-white shadow-sm transition-transform hover:bg-[#126130] hover:no-underline active:scale-[0.98] ${className}`}
      aria-label={`Call ${first ?? "them"} on ${pretty || phone}`}
    >
      <PhoneIcon className="h-5 w-5 shrink-0" />
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <span className="max-w-full truncate">Call {first ?? "them"}</span>
        <span className="text-[13px] font-medium">{pretty || phone}</span>
      </span>
    </a>
  );
}

/** After the call: three answers, and the card moves itself. */
export function HowDidItGo({
  name,
  onAnswer,
  onCancel,
}: {
  name: string;
  onAnswer: (change: LeadChange) => void;
  onCancel: () => void;
}) {
  const first = name !== "Name not given" ? name.split(/\s+/)[0] : "they";
  return (
    <div className="pop-in rounded-2xl border-2 border-accent/40 bg-accent-soft/50 p-3" role="group" aria-label="How did the call go?">
      <p className="px-1 text-[17px] font-semibold">How did it go?</p>
      <div className="mt-2 grid gap-2">
        <button className="btn-primary min-h-[48px] text-[16px]" onClick={() => onAnswer({ stage: "won", called: true })}>
          <CheckIcon className="h-4 w-4" />
          {first === "they" ? "They" : first} said yes
        </button>
        <button className="btn-secondary min-h-[48px] text-[16px]" onClick={() => onAnswer({ stage: "follow_up", called: true })}>
          <RefreshIcon className="h-4 w-4" />
          No answer, or call again later
        </button>
        <button className="btn-secondary min-h-[48px] text-[16px]" onClick={() => onAnswer({ stage: "lost", called: true })}>
          <CrossIcon className="h-3.5 w-3.5" />
          {first === "they" ? "They" : first} said no
        </button>
      </div>
      <button className="mt-1.5 min-h-[40px] w-full text-[14px] font-medium text-link" onClick={onCancel}>
        I didn&apos;t call yet
      </button>
    </div>
  );
}

/** "We don't have their number": type it once, and it's kept. */
function AddNumber({ name, onSave }: { name: string; onSave: (phone: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button className="btn-secondary min-h-[52px] w-full text-[16px]" onClick={() => setOpen(true)}>
        <PhoneIcon className="h-4 w-4" />
        Add their number
      </button>
    );
  }
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await onSave(value);
        setBusy(false);
        if (ok) setOpen(false);
      }}
    >
      <input
        className="input min-w-0 flex-1"
        inputMode="tel"
        autoComplete="tel"
        autoFocus
        placeholder="(555) 123-4567"
        aria-label={`Phone number for ${name}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="btn-primary min-h-[48px] px-4" disabled={busy || !value.trim()}>
        {busy && <Spinner className="h-4 w-4" />}
        Save
      </button>
    </form>
  );
}

/** Move a card without dragging: one button per column. Works on any screen. */
function MoveTo({ stage, onMove, onClose }: { stage: Stage; onMove: (s: Stage) => void; onClose: () => void }) {
  return (
    <div className="pop-in rounded-2xl border border-line bg-panel p-2" role="group" aria-label="Move to">
      <p className="px-2 pb-1 pt-1 text-[14px] font-semibold text-ink/80">Move to</p>
      <div className="grid gap-1.5">
        {(Object.keys(STAGE_LABEL) as Stage[])
          .filter((s) => s !== stage)
          .map((s) => (
            <button key={s} className="btn-secondary min-h-[44px] justify-start text-[15px]" onClick={() => onMove(s)}>
              {STAGE_LABEL[s]}
            </button>
          ))}
        <button className="min-h-[40px] text-[14px] font-medium text-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The customer card. `compact` is for people who already decided: no call
 * button, just who they are and a way to reopen.
 */
export function LeadCard({
  lead,
  business,
  onChange,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
  as = "li",
}: {
  lead: PipelineLead;
  business: string | null;
  onChange: (change: LeadChange) => void | Promise<boolean | void>;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  as?: "li" | "div";
}) {
  const a = lead.action;
  const [asking, setAsking] = useState(false);
  const [moving, setMoving] = useState(false);
  const [sayOpen, setSayOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const say = a ? openingLine(lead, business) : null;
  const what = listWords(cleanPests(lead.pests).slice(0, 2)) || lead.service;
  const meta = [what, lead.value !== null ? money(lead.value) : null].filter(Boolean).join(" · ");
  const Tag = as;

  return (
    <Tag
      draggable={draggable}
      onDragStart={(e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      className={`relative block rounded-2xl border border-line bg-surface p-3.5 shadow-sm transition-all ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${dragging ? "rotate-1 opacity-60" : "hover:shadow-md"}`}
    >
      {a ? (
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${URGENCY[a.urgency].cls}`}>
          {URGENCY[a.urgency].label(lead)}
        </span>
      ) : (
        <p className="text-[16px] font-semibold leading-snug">{lead.name}</p>
      )}
      {a && <p className="mt-2 text-[17px] font-semibold leading-snug">{a.label}</p>}
      {meta && <p className="mt-0.5 text-[14px] text-ink/75">{meta}</p>}
      {a && lead.rep && (
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
          <Avatar name={lead.rep} size={18} />
          {lead.rep}
          {lead.last_contact_at && <> · {date(lead.last_contact_at)}</>}
        </p>
      )}

      {a && (
        <div className="mt-3 space-y-2">
          {asking ? (
            <HowDidItGo
              name={lead.name}
              onCancel={() => setAsking(false)}
              onAnswer={(change) => {
                setAsking(false);
                void onChange(change);
              }}
            />
          ) : moving ? (
            <MoveTo
              stage={lead.stage as Stage}
              onClose={() => setMoving(false)}
              onMove={(s) => {
                setMoving(false);
                void onChange({ stage: s });
              }}
            />
          ) : (
            <>
              {lead.phone ? (
                <CallButton
                  phone={lead.phone}
                  pretty={lead.phone_pretty}
                  name={lead.name}
                  className="w-full"
                  // The question waits until they're back from the call.
                  onCalled={() => window.setTimeout(() => setAsking(true), 600)}
                />
              ) : (
                <AddNumber name={lead.name} onSave={async (phone) => (await onChange({ phone })) !== false} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-secondary min-h-[44px] px-2 text-[15px]" onClick={() => void onChange({ stage: "won" })}>
                  <CheckIcon className="h-4 w-4" />
                  Said yes
                </button>
                <button className="btn-secondary min-h-[44px] px-2 text-[15px]" onClick={() => void onChange({ stage: "lost" })}>
                  <CrossIcon className="h-3.5 w-3.5" />
                  Said no
                </button>
              </div>
              <div className="flex flex-wrap gap-x-4 text-[14px] font-medium text-link">
                <button className="inline-flex min-h-[40px] items-center gap-1" onClick={() => setSayOpen((o) => !o)} aria-expanded={sayOpen}>
                  What to say
                  <ChevronIcon className={`h-3.5 w-3.5 transition-transform ${sayOpen ? "rotate-90" : ""}`} />
                </button>
                <button className="min-h-[40px]" onClick={() => setMoving(true)}>
                  Move
                </button>
                {lead.last_call_id && (
                  <Link href={`/v2/calls/${lead.last_call_id}`} className="inline-flex min-h-[40px] items-center gap-1 hover:no-underline" aria-label={`Listen to the call with ${lead.name}`}>
                    <PlayIcon className="h-3.5 w-3.5" />
                    Listen
                  </Link>
                )}
              </div>
              {sayOpen && say && (
                <div className="rounded-xl bg-panel px-3 py-2.5">
                  <p className="text-[15px] leading-relaxed text-ink/90">“{say}”</p>
                  <button
                    className="mt-1 min-h-[32px] text-[13px] font-medium text-link"
                    aria-label={`Copy what to say to ${lead.name}`}
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
              )}
              {/* The words to say, kept in the page for screen readers and search. */}
              {!sayOpen && say && <span className="sr-only">Say: “{say}”</span>}
            </>
          )}
        </div>
      )}

      {!a && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 text-[14px] font-medium text-link">
          <button className="min-h-[40px]" onClick={() => void onChange({ stage: "follow_up" })}>
            Not decided after all
          </button>
          {lead.last_call_id && (
            <Link href={`/v2/calls/${lead.last_call_id}`} className="inline-flex min-h-[40px] items-center gap-1 hover:no-underline" aria-label={`Listen to the call with ${lead.name}`}>
              <PlayIcon className="h-3.5 w-3.5" />
              Listen
            </Link>
          )}
        </div>
      )}
    </Tag>
  );
}

/**
 * Saves a change to a lead and says what happened, with Undo for a move.
 * Returns false when it didn't save, so the caller can put things back.
 */
export function useSaveLead(reload: () => Promise<unknown>) {
  const toast = useToast();
  return async (lead: PipelineLead, change: LeadChange): Promise<boolean> => {
    const was = lead.stage;
    try {
      await api.patch(`/intel/leads/${lead.id}`, change);
    } catch (err) {
      toast({ message: err instanceof ApiError && err.status === 400 ? err.message : failMessage(), tone: "error" });
      await reload();
      return false;
    }
    const s = change.stage;
    const message = !s
      ? change.phone
        ? `Number saved for ${lead.name}`
        : `${lead.name}: noted`
      : s === "won"
        ? `${lead.name} said yes`
        : s === "lost"
          ? `${lead.name} said no`
          : change.called
            ? `${lead.name}: call again in a couple of days`
            : lead.action
              ? `${lead.name} moved to “${STAGE_LABEL[s]}”`
              : `${lead.name} is back on the list`;
    toast({
      message,
      undo:
        s && s !== was
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
    return true;
  };
}
