"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, type Me } from "@/lib/api";
import { useApi, useTitle } from "@/lib/hooks";
import type { ActionsSummary, Brief, PerformanceCard, PipelineBoard, PipelineLead, PreparedAction, RepCard, Status, Todo } from "@/lib/v2";
import { money } from "@/lib/v2";
import { UploadIcon } from "@/components/icons";
import { Loading, Modal, Segmented, Spinner } from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { ActionSheet, KIND_WORDS, handledText } from "@/components/v2/act";
import { CallDrawer } from "@/components/v2/call-drawer";
import { LeadCard, URGENCY, useSaveLead } from "@/components/v2/customer";
import { PageError } from "@/components/v2/kit";
import { failMessage, useToast } from "@/components/v2/toast";

/**
 * The answer first, then the work, one action per line. A coloured sentence
 * says how things are and what to do first; four numbers say how each part of
 * the business is going; the list below has every job, most urgent first,
 * each with one button. Then the team and the customers still deciding.
 */

type Tone = "good" | "ok" | "bad" | "none";
const TONE: Record<Status, Tone> = { good: "good", watch: "ok", bad: "bad", none: "none" };
const ICON: Record<Tone, string> = { good: "✓", ok: "!", bad: "✕", none: "–" };
const ICON_CLS: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  ok: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  none: "bg-fill text-muted",
};
const TEXT_CLS: Record<Tone, string> = { good: "text-good", ok: "text-warn", bad: "text-bad", none: "text-muted" };
const TOP_CLS: Record<Tone, string> = { good: "border-t-good", ok: "border-t-warn", bad: "border-t-bad", none: "border-t-line" };

const JOBS_SHOWN = 6;
const LIST_SHOWN = 5;

/** Most urgent jobs are red, the rest amber. */
const severity = (t: Todo): Tone => (t.handled ? "good" : t.priority >= 70 ? "bad" : "ok");
/** "Goal: at least 5 out of 10 say yes" as "goal 5 in 10". */
const shortGoal = (goal: string) => goal.replace(/^Goal: at least (\d+) out of (\d+).*$/, "goal $1 in $2").replace(/^Goal: /, "goal ");
const firstName = (name: string | null | undefined) => (name && name !== "Name not given" ? name.split(/\s+/)[0] : null);

type Range = "7" | "30" | "all";
const RANGE_KEY = "pestlaunch.today.range";
const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "all", label: "All" },
];
const RANGE_WORDS: Record<Range, string> = { "7": "the last 7 days", "30": "the last 30 days", all: "all time" };

function useRange(): [Range, (r: Range) => void] {
  const [range, setRange] = useState<Range>("all");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RANGE_KEY) as Range | null;
      if (saved && RANGES.some((r) => r.value === saved)) setRange(saved);
    } catch {
      // No storage: start from all time.
    }
  }, []);
  const choose = (r: Range) => {
    setRange(r);
    try {
      localStorage.setItem(RANGE_KEY, r);
    } catch {
      // Remembering is a convenience.
    }
  };
  return [range, choose];
}

export default function TodayPage() {
  useTitle("Today");
  const router = useRouter();
  const [range, setRange] = useRange();
  const days = range === "all" ? "" : `?days=${range}`;
  const { data, error, status, loading, reload } = useApi<Brief>(`/intel/v2/brief${days}`);
  const summary = useApi<ActionsSummary>("/intel/actions/summary");
  const boardApi = useApi<PipelineBoard>("/intel/v2/pipeline");
  const reps = useApi<RepCard[]>(`/intel/v2/reps${days}`).data;
  const business = useApi<Me>("/auth/me").data?.business_name ?? null;
  const actions = summary.data?.autopilot ? summary.data : null;
  const board = boardApi.data;
  const leadById = new Map((board ? [...board.open, ...board.closed] : []).map((l) => [l.id, l]));

  const [acting, setActing] = useState<Todo | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [peek, setPeek] = useState<Todo | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Draft the texts for anything new since the last visit, then show them.
  const drafted = useRef(false);
  useEffect(() => {
    if (drafted.current) return;
    drafted.current = true;
    api
      .post("/intel/actions/refresh")
      .then(() => Promise.all([reload(), summary.reload()]))
      .catch(() => undefined);
  }, [reload, summary]);
  const refreshAll = async () => {
    await Promise.all([reload(), summary.reload(), boardApi.reload()]);
  };
  const saveLead = useSaveLead(refreshAll);

  if (loading && !data) return <Loading />;
  if (error && !data) return <PageError status={status} onRetry={() => void reload()} />;
  if (!data) return null;

  const open = data.todo.filter((t) => !t.handled);
  const handled = data.todo.filter((t) => t.handled);
  const ready = open.filter((t) => t.actions?.[0]?.to_phone);
  const shown = showAll ? open : open.slice(0, JOBS_SHOWN);

  // What a job's one button does: the text that's already written, else the
  // customer's card (to call them), else the call itself.
  const doJob = (t: Todo) => {
    const lead = t.lead_id ? leadById.get(t.lead_id) : undefined;
    if (t.actions?.length) setActing(t);
    else if (lead) setCard(lead.id);
  };
  const jobButton = (t: Todo): string | null => {
    const a = t.actions?.[0];
    if (a) return a.label;
    const lead = t.lead_id ? leadById.get(t.lead_id) : undefined;
    if (lead) return `Call ${firstName(lead.name) ?? "them"}`;
    return null;
  };

  // A job about a call opens it beside the list; the rest go where they live.
  const look = (t: Todo) => (t.call_id ? setPeek(t) : router.push(t.href));

  const top = open[0];
  const verdictTone: Tone = !data.calls.analyzed ? "none" : top ? severity(top) : "good";
  const verdict = !data.calls.analyzed
    ? range === "all"
      ? "No calls yet. Add a call recording and this page fills in by itself."
      : `No calls in ${RANGE_WORDS[range]}. Pick All to see every call.`
    : top
      ? `${top.title}. ${top.why}${open.length > 1 ? ` ${open.length - 1} more thing${open.length > 2 ? "s" : ""} need${open.length > 2 ? "" : "s"} you.` : ""}`
      : "Nothing needs you right now. Every call is handled.";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold leading-tight tracking-title">Today</h1>
          <p className="mt-1 text-[15px] text-muted">{data.headline.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span role="group" aria-label="Calls from">
            <Segmented options={RANGES} value={range} onChange={setRange} />
          </span>
          <button className="btn-secondary" onClick={() => setUploadOpen(true)}>
            <UploadIcon className="h-4 w-4" />
            Add a call recording
          </button>
        </div>
      </div>

      {actions?.practice && (
        <p className="rounded-xl bg-warn-soft px-4 py-2.5 text-[14px]">
          <span className="font-semibold">Practice mode:</span> texts go to the{" "}
          <Link href="/v2/outbox" className="font-medium underline underline-offset-2">
            Texts page
          </Link>
          , not to real phones.
        </p>
      )}

      {/* The answer first: one sentence, one button. */}
      <section
        aria-label="What to do first"
        className={`flex flex-col gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:gap-4 ${
          verdictTone === "bad"
            ? "border-bad/25 bg-bad-soft"
            : verdictTone === "ok"
              ? "border-warn/25 bg-warn-soft"
              : verdictTone === "good"
                ? "border-good/25 bg-good-soft"
                : "border-line bg-surface"
        }`}
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-[17px] font-extrabold ${TEXT_CLS[verdictTone]}`} aria-hidden>
          {ICON[verdictTone]}
        </span>
        <p className="min-w-0 flex-1 text-[16px] font-semibold leading-snug">{verdict}</p>
        {top &&
          (jobButton(top) ? (
            <button className="btn-primary shrink-0" onClick={() => doJob(top)}>
              {jobButton(top)} →
            </button>
          ) : (
            <button className="btn-primary shrink-0" onClick={() => look(top)}>
              Listen →
            </button>
          ))}
      </section>

      {data.calls.analyzed > 0 && <Numbers cards={data.cards} board={board} />}

      <div className="grid gap-4 min-[1180px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] min-[1180px]:items-start">
        <section aria-label="Needs attention" className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold">
              Needs attention
              {open.length > 0 && <span className="rounded-full bg-bad px-2 py-px text-[12px] font-bold text-white">{open.length}</span>}
            </h2>
            {ready.length > 1 && (
              <button className="btn-secondary px-3 py-1.5 text-[14px]" onClick={() => setAllOpen(true)}>
                Send all {ready.length} texts
              </button>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">Most urgent first. Tap a name to see the call; the button does the job.</p>
          {open.length ? (
            <ul className="mt-2 space-y-2">
              {shown.map((t, i) => (
                <JobRow key={t.key ?? `${t.title}-${i}`} todo={t} button={jobButton(t)} onDo={() => doJob(t)} onLook={t.call_id ? () => look(t) : null} />
              ))}
            </ul>
          ) : (
            <p className="py-3 font-semibold text-good">✓ All clear. Every call was handled.</p>
          )}
          {open.length > JOBS_SHOWN && (
            <button className="mt-3 w-full rounded-xl border border-line py-2 text-[14px] font-medium text-link hover:bg-surface-hover" onClick={() => setShowAll((x) => !x)}>
              {showAll ? "Show less" : `Show ${open.length - JOBS_SHOWN} more`}
            </button>
          )}
        </section>

        <Done items={handled} summary={actions} />
      </div>

      <div className="grid gap-4 min-[1180px]:grid-cols-2 min-[1180px]:items-start">
        {reps && reps.length > 0 && <Team reps={reps} />}
        {board && board.open.length > 0 && <Deciding leads={board.open} onOpen={(l) => setCard(l.id)} />}
      </div>

      {data.accuracy && data.accuracy.calls > 0 && (
        <p className="px-1 text-[13px] text-muted">
          Managers kept <span className="font-semibold text-good">{Math.round(data.accuracy.pct)}%</span> of the AI&apos;s step marks · {data.accuracy.calls} call
          {data.accuracy.calls === 1 ? "" : "s"} corrected
        </p>
      )}

      {peek?.call_id && (
        <CallDrawer
          callId={peek.call_id}
          onClose={() => setPeek(null)}
          action={
            jobButton(peek)
              ? {
                  label: jobButton(peek)!,
                  onDo: () => {
                    const t = peek;
                    setPeek(null);
                    doJob(t);
                  },
                }
              : null
          }
        />
      )}
      {acting && (
        <ActionSheet
          open
          title={acting.title}
          options={acting.actions ?? []}
          summary={actions}
          onClose={() => setActing(null)}
          onDone={refreshAll}
        />
      )}
      {card && leadById.get(card) && (
        <Modal open onClose={() => setCard(null)} title={leadById.get(card)!.name}>
          <LeadCard
            as="div"
            lead={leadById.get(card)!}
            business={business}
            onChange={async (c) => {
              const ok = await saveLead(leadById.get(card)!, c);
              if (ok && c.stage) setCard(null);
              return ok;
            }}
          />
        </Modal>
      )}
      <SendAll open={allOpen} jobs={ready} summary={actions} onClose={() => setAllOpen(false)} onDone={refreshAll} />
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => void refreshAll()} logHref="/v2/calls" />
    </div>
  );
}

/** Four numbers, each coloured against its goal, each opening what's behind it. */
function Numbers({ cards, board }: { cards: PerformanceCard[]; board: PipelineBoard | null }) {
  const due = board?.summary.needs_action ?? null;
  const tiles = [
    ...cards
      .filter((c) => c.key !== "quality")
      .map((c) => ({
        key: c.key,
        label: c.label,
        value: c.of ? `${c.count} of ${c.of}` : "–",
        sub: c.of ? `${c.metric_label.toLowerCase()} · ${shortGoal(c.goal)}` : "Not enough calls yet",
        tone: TONE[c.status],
        href: c.action?.href ?? "/v2/calls",
      })),
    {
      key: "callbacks",
      label: "Call backs due",
      value: due === null ? "–" : String(due),
      sub: due === null ? "" : due ? `${money(board!.summary.open_value)} still deciding` : "All caught up",
      tone: (due === null ? "none" : due ? "bad" : "good") as Tone,
      href: "/v2/pipeline",
    },
  ];
  return (
    <section aria-label="How it's going" className="grid grid-cols-2 gap-3 min-[1180px]:grid-cols-4">
      {tiles.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`block rounded-xl border border-line border-t-[3px] bg-surface px-4 py-3.5 transition-colors hover:bg-surface-hover hover:no-underline ${TOP_CLS[t.tone]}`}
        >
          <span className="block text-[13px] font-medium text-ink/80">{t.label}</span>
          <span className="mt-1 flex items-center gap-2">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${ICON_CLS[t.tone]}`} aria-hidden>
              {ICON[t.tone]}
            </span>
            <span className={`tnum whitespace-nowrap text-[22px] font-bold leading-tight tracking-title sm:text-[26px] ${TEXT_CLS[t.tone]}`}>{t.value}</span>
          </span>
          <span className="mt-0.5 block text-[12.5px] text-muted">{t.sub}</span>
        </Link>
      ))}
    </section>
  );
}

/** One job: icon, what and why, one button. */
function JobRow({ todo, button, onDo, onLook }: { todo: Todo; button: string | null; onDo: () => void; onLook: (() => void) | null }) {
  const tone = severity(todo);
  const worth = todo.value ? ` · ${money(todo.value)} a year` : "";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-panel px-3 py-2.5">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${ICON_CLS[tone]}`} aria-hidden>
        {ICON[tone]}
      </span>
      {onLook ? (
        <button className="group min-w-[180px] flex-1 text-left" onClick={onLook}>
          <span className="block text-[15px] font-semibold text-ink group-hover:text-link">{todo.title}</span>
          <span className="block text-[13px] text-muted">
            {todo.why}
            {worth}
          </span>
        </button>
      ) : (
        <Link href={todo.href} className="min-w-[180px] flex-1 hover:no-underline">
          <span className="block text-[15px] font-semibold text-ink">{todo.title}</span>
          <span className="block text-[13px] text-muted">
            {todo.why}
            {worth}
          </span>
        </Link>
      )}
      {button ? (
        <button className="btn-primary w-full shrink-0 px-3.5 py-1.5 text-[14px] sm:w-auto" onClick={onDo}>
          {button} →
        </button>
      ) : onLook ? (
        <button className="btn-secondary w-full shrink-0 px-3.5 py-1.5 text-[14px] sm:w-auto" onClick={onLook}>
          Listen →
        </button>
      ) : (
        <Link href={todo.href} className="btn-secondary w-full shrink-0 px-3.5 py-1.5 text-[14px] hover:no-underline sm:w-auto">
          Listen →
        </Link>
      )}
    </li>
  );
}

/** What was done lately, and what customers said back. */
function Done({ items, summary }: { items: Todo[]; summary: ActionsSummary | null }) {
  const on = summary ? (Object.keys(summary.autopilot) as PreparedAction["kind"][]).filter((k) => summary.autopilot[k]) : [];
  return (
    <section aria-label="Done" className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold">Done</h2>
        <Link href="/v2/outbox" className="text-[14px] font-medium text-link">
          All texts →
        </Link>
      </div>
      {items.length ? (
        <ul className="mt-1">
          {items.slice(0, LIST_SHOWN).map((t) => {
            const a = t.handled as PreparedAction;
            return (
              <li key={t.key ?? t.title} className="flex items-start gap-2.5 border-t border-line py-2.5 first:border-t-0">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-good bg-good-soft text-[11px] font-extrabold text-good" aria-hidden>
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-muted line-through decoration-ink/20">{t.title}</span>
                  <span className="block text-[12.5px] text-muted">{handledText(a)}</span>
                  {a.reply_text && (
                    <span className="mt-1 block rounded-lg bg-accent-soft/70 px-2.5 py-1.5 text-[13px]">
                      <span className="font-semibold">{a.to_name ?? "They"} replied:</span> “{a.reply_text}”
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-muted">Nothing yet today. Texts you send show up here, with any replies.</p>
      )}
      {summary && (
        <p className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
          {on.length ? (
            <>
              <span className="font-semibold text-good">Autopilot on</span> for {on.map((k) => KIND_WORDS[k].many).join(" and ")}.{" "}
            </>
          ) : (
            <>Want these sent without asking? </>
          )}
          <Link href="/settings#autopilot" className="font-medium text-link">
            {on.length ? "Change" : "Turn on autopilot"}
          </Link>
        </p>
      )}
    </section>
  );
}

/** The team, lowest score first, with the one thing each should work on. */
function Team({ reps }: { reps: RepCard[] }) {
  const sorted = [...reps].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return (
    <section aria-label="Team" className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold">Team</h2>
        <span className="text-[13px] text-muted">Lowest score first</span>
      </div>
      <ul className="mt-1">
        {sorted.slice(0, LIST_SHOWN).map((r) => {
          const tone = TONE[r.status];
          return (
            <li key={r.id} className="border-t border-line first:border-t-0">
              <Link href={`/v2/reps/${r.id}`} className="group flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:no-underline">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-link">
                  {r.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </span>
                <span className="w-28 truncate text-[14px] font-semibold text-ink group-hover:text-link">{r.name}</span>
                <span className="h-2 min-w-[60px] flex-1 overflow-hidden rounded-full bg-fill">
                  <span
                    className={`block h-full rounded-full ${tone === "good" ? "bg-good" : tone === "ok" ? "bg-warn" : tone === "bad" ? "bg-bad" : "bg-ink/20"}`}
                    style={{ width: `${Math.max(4, Math.min(100, r.score ?? 0))}%` }}
                  />
                </span>
                <span className={`tnum w-11 text-right text-[14px] font-semibold ${TEXT_CLS[tone]}`}>{r.score === null ? "–" : `${Math.round(r.score)}%`}</span>
                <span
                  className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${
                    r.focus ? "border-bad/25 bg-bad-soft text-bad" : "border-good/25 bg-good-soft text-good"
                  }`}
                >
                  {r.focus ? `✕ ${r.focus.plain}` : "✓ On track"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {reps.length > LIST_SHOWN && (
        <Link href="/v2/reps" className="mt-2 block text-[14px] font-medium text-link">
          All {reps.length} people →
        </Link>
      )}
    </section>
  );
}

/** Customers still deciding, the most valuable first. */
function Deciding({ leads, onOpen }: { leads: PipelineLead[]; onOpen: (l: PipelineLead) => void }) {
  const top = [...leads].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, LIST_SHOWN);
  const total = leads.reduce((s, l) => s + (l.value ?? 0), 0);
  return (
    <section aria-label="Still deciding" className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold">Still deciding</h2>
        {total > 0 && <span className="text-[13px] font-semibold text-ink/80">{money(total)} in prices given</span>}
      </div>
      <ul className="mt-1">
        {top.map((l) => {
          const u = l.action ? URGENCY[l.action.urgency] : null;
          return (
            <li key={l.id} className="border-t border-line first:border-t-0">
              <button className="group flex w-full items-center gap-3 py-2.5 text-left" onClick={() => onOpen(l)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold group-hover:text-link">{l.name}</span>
                  <span className="block truncate text-[12.5px] text-muted">{l.service ?? "Pest control"}</span>
                </span>
                {u && <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold ${u.cls}`}>{u.label(l)}</span>}
                <span className="tnum w-16 text-right text-[14px] font-semibold">{l.value !== null ? money(l.value) : "–"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Link href="/v2/pipeline" className="mt-2 block text-[14px] font-medium text-link">
        Open the call back board →
      </Link>
    </section>
  );
}

/** Every written text in one go: a look first, then one tap. */
function SendAll({
  open,
  jobs,
  summary,
  onClose,
  onDone,
}: {
  open: boolean;
  jobs: Todo[];
  summary: ActionsSummary | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<Todo[]>([]);
  const [state, setState] = useState<Record<string, "sending" | "done" | "failed">>({});
  useEffect(() => {
    if (!open) return;
    setBatch(jobs);
    setState({});
    // Only when it opens, so a reload can't change the list mid-send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function send() {
    setBusy(true);
    let sent = 0;
    for (const t of batch) {
      const a = t.actions![0];
      setState((s) => ({ ...s, [a.id]: "sending" }));
      try {
        const res = await api.post<PreparedAction>(`/intel/actions/${a.id}/perform`, { body: null, phone: null });
        const ok = res.status === "done";
        if (ok) sent += 1;
        setState((s) => ({ ...s, [a.id]: ok ? "done" : "failed" }));
      } catch {
        setState((s) => ({ ...s, [a.id]: "failed" }));
      }
    }
    setBusy(false);
    toast(
      sent
        ? { message: `${sent} text${sent === 1 ? "" : "s"} ${summary?.practice ? "on the Texts page (practice)" : "sent"}` }
        : { message: failMessage(), tone: "error" },
    );
    onClose();
    await onDone();
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={`Send ${batch.length} texts`}>
      <p className="text-[14px] text-muted">Each one is written for that customer. Read them, then send them all.</p>
      <ul className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
        {batch.map((t) => {
          const a = t.actions![0];
          const s = state[a.id];
          return (
            <li key={a.id} className={`rounded-xl border px-3 py-2.5 ${s === "done" ? "border-good/30 bg-good-soft" : s === "failed" ? "border-bad/30 bg-bad-soft" : "border-line bg-panel"}`}>
              <p className="flex items-center justify-between gap-2 text-[14px] font-semibold">
                <span>
                  {a.label} <span className="font-normal text-muted">· {a.to_name ?? a.to_phone_pretty}</span>
                </span>
                {s === "sending" ? <Spinner className="h-4 w-4" /> : s === "done" ? <span className="text-good">✓</span> : s === "failed" ? <span className="text-bad">✕</span> : null}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[13px] text-ink/80">{a.body}</p>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy || !batch.length} onClick={() => void send()}>
          {busy && <Spinner className="h-4 w-4" />}
          Send all {batch.length}
        </button>
      </div>
      {summary?.practice && <p className="mt-3 text-[13px] text-muted">Practice mode: they go to the Texts page, not to phones.</p>}
    </Modal>
  );
}
