"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, type Me } from "@/lib/api";
import { useApi, useTitle } from "@/lib/hooks";
import type { ActionsSummary, Brief, PerformanceCard, PipelineBoard, PipelineLead, PreparedAction, RepCard, Status, Todo } from "@/lib/v2";
import { money } from "@/lib/v2";
import { Tile, type Tint } from "@/components/brand";
import { CallBackIcon, CheckIcon, HomeIcon, MessageIcon, PhoneIcon, PlayIcon, TeamIcon, UploadIcon } from "@/components/icons";
import { Loading, Modal, Spinner } from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { ActionSheet, KIND_WORDS, actionLabel, handledText } from "@/components/v2/act";
import { CallDrawer } from "@/components/v2/call-drawer";
import { LeadCard, displayName, personLabel, useSaveLead } from "@/components/v2/customer";
import { PageError } from "@/components/v2/kit";
import { failMessage, useToast } from "@/components/v2/toast";

/**
 * Today is one thing at a time. A greeting, then one card, Up next, with one
 * big button that does the job. "Later" puts it at the back of the line; when
 * a job is done the next one slides in. Below sit small widgets for how the
 * business is going, the team, and the customers still deciding.
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

const COMING_UP = 3;
const LIST_SHOWN = 5;

/** Most urgent jobs are red, the rest amber. */
const severity = (t: Todo): Tone => (t.handled ? "good" : t.priority >= 70 ? "bad" : "ok");
/** How it's going, in a word. */
const VERDICT: Record<Tone, string> = { good: "Good", ok: "Okay", bad: "Not good", none: "Too early to tell" };
/** What each number counts, in everyday words. */
const TILE: Record<string, { label: string; tint: Tint; icon: (p: { className?: string }) => React.ReactNode; line: (count: number, of: number) => string }> = {
  sales: { label: "New callers", tint: "green", icon: PhoneIcon, line: (n, of) => `${n} of ${of} said yes` },
  retention: { label: "Wanted to cancel", tint: "orange", icon: HomeIcon, line: (n, of) => `${n} of ${of} stayed` },
  service: { label: "Had a problem", tint: "indigo", icon: CheckIcon, line: (n, of) => `${n} of ${of} got it fixed` },
};
/** 41 days as "6 weeks": the way a person says it. */
function timeWords(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : null);
const firstName = (name: string | null | undefined) => (name && name !== "Name not given" ? name.split(/\s+/)[0] : null);

/** "Good morning", by the clock of whoever is looking. */
function useGreeting(): { hello: string; date: string } {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  if (!now) return { hello: "Hello", date: "" };
  const h = now.getHours();
  return {
    hello: h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening",
    date: now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
  };
}

export default function TodayPage() {
  useTitle("Today");
  const router = useRouter();
  const { hello, date } = useGreeting();
  const { data, error, status, loading, reload } = useApi<Brief>("/intel/v2/brief");
  const summary = useApi<ActionsSummary>("/intel/actions/summary");
  const boardApi = useApi<PipelineBoard>("/intel/v2/pipeline");
  const reps = useApi<RepCard[]>("/intel/v2/reps").data;
  const business = useApi<Me>("/auth/me").data?.business_name ?? null;
  const actions = summary.data?.autopilot ? summary.data : null;
  const board = boardApi.data;
  const leadById = new Map((board ? [...board.open, ...board.closed] : []).map((l) => [l.id, l]));

  const [acting, setActing] = useState<Todo | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [peek, setPeek] = useState<Todo | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Jobs put off with "Later" this visit go to the back of the line.
  const [later, setLater] = useState<string[]>([]);

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

  const keyOf = (t: Todo, i = 0) => t.key ?? `${t.title}-${i}`;
  const waiting = data.todo.filter((t) => !t.handled);
  const open = [...waiting.filter((t) => !later.includes(keyOf(t))), ...later.map((k) => waiting.find((t) => keyOf(t) === k)).filter((t): t is Todo => !!t)];
  const handled = data.todo.filter((t) => t.handled);
  const ready = open.filter((t) => t.actions?.[0]?.to_phone);

  // What a job's one button does: the text that's already written, else the
  // customer's card (to call them), else the call itself.
  const doJob = (t: Todo) => {
    const lead = t.lead_id ? leadById.get(t.lead_id) : undefined;
    if (t.actions?.length) setActing(t);
    else if (lead) setCard(lead.id);
    else look(t);
  };
  // Each button says what will happen when it's pressed.
  const jobButton = (t: Todo): string => {
    const a = t.actions?.[0];
    if (a) return actionLabel(a, t.customer);
    const lead = t.lead_id ? leadById.get(t.lead_id) : undefined;
    if (lead) return `Call ${firstName(lead.name) ?? "them"}`;
    return "Hear what happened";
  };
  // A job about a call opens it beside the page; the rest go where they live.
  const look = (t: Todo) => (t.call_id ? setPeek(t) : router.push(t.href));

  const top = open[0];
  const next = open.slice(1, 1 + COMING_UP);
  const total = waiting.length;
  const doneCount = handled.length;

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="min-h-[22px] text-[15px] font-semibold uppercase tracking-wide text-ink/75">{date}</p>
          <h1 className="text-[34px] font-bold leading-tight tracking-title sm:text-[40px]">{hello}</h1>
          <p className="mt-1 text-[18px] text-ink/75">
            {total ? `${total} thing${total === 1 ? "" : "s"} to do today.` : "You're all caught up."}
          </p>
        </div>
        <button className="btn-secondary" onClick={() => setUploadOpen(true)}>
          <UploadIcon className="h-4 w-4" />
          Add a call
        </button>
      </header>

      {actions?.practice && (
        <p className="rounded-2xl bg-warn-soft px-4 py-3 text-[16px]">
          <span className="font-semibold">Practice mode is on.</span> Texts appear on the{" "}
          <Link href="/v2/outbox" className="font-medium underline underline-offset-2">
            Texts page
          </Link>{" "}
          instead of going to phones.
        </p>
      )}

      <div className="grid grid-cols-1 gap-7 min-[1180px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] min-[1180px]:items-start min-[1180px]:gap-5">
      {!data.calls.analyzed ? (
        <Empty onAdd={() => setUploadOpen(true)} />
      ) : top ? (
        <UpNext
          key={keyOf(top)}
          todo={top}
          place={doneCount + 1}
          of={doneCount + total}
          button={jobButton(top)}
          onDo={() => doJob(top)}
          onLook={top.call_id && (top.actions?.length || (top.lead_id && leadById.get(top.lead_id))) ? () => look(top) : null}
          onLater={open.length > 1 ? () => setLater((l) => [...l.filter((k) => k !== keyOf(top)), keyOf(top)]) : null}
        />
      ) : (
        <AllDone count={doneCount} />
      )}

      {next.length > 0 && (
        <section aria-label="Coming up" className="settle">
          <div className="mb-2 flex items-center justify-between gap-2 px-1 min-[1180px]:-mt-2">
            <h2 className="text-[20px] font-semibold tracking-title">Coming up</h2>
            <button className="press min-h-[44px] rounded-full px-3 text-[16px] font-medium text-link hover:bg-accent-soft/60" onClick={() => setListOpen(true)}>
              See all {total}
            </button>
          </div>
          <ul className="group-list">
            {next.map((t, i) => (
              <li key={keyOf(t, i)}>
                <button
                  className="press flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover"
                  onClick={() => (t.call_id ? look(t) : doJob(t))}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold ${ICON_CLS[severity(t)]}`} aria-hidden>
                    {ICON[severity(t)]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold">{t.title}</span>
                    <span className="block truncate text-[15px] text-ink/70">{t.plain ?? t.why}</span>
                  </span>
                  <span className="text-[22px] text-ink/30" aria-hidden>
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>

      {data.calls.analyzed > 0 && <Numbers cards={data.cards} board={board} />}

      <div className="settle grid grid-cols-1 gap-4 min-[1180px]:grid-cols-3 min-[1180px]:items-start">
        <Done items={handled} summary={actions} />
        {reps && reps.length > 0 && <Team reps={reps} />}
        {board && board.open.length > 0 && <Deciding leads={board.open} onOpen={(l) => setCard(l.id)} />}
      </div>

      {listOpen && (
        <Modal open onClose={() => setListOpen(false)} title={`Everything to do (${total})`}>
          {ready.length > 1 && (
            <button
              className="btn-secondary mb-3 w-full"
              onClick={() => {
                setListOpen(false);
                setAllOpen(true);
              }}
            >
              Send all {ready.length} texts at once
            </button>
          )}
          <ul className="space-y-2" aria-label="Your to-do list">
            {open.map((t, i) => (
              <JobRow
                key={keyOf(t, i)}
                todo={t}
                button={jobButton(t)}
                onDo={() => {
                  setListOpen(false);
                  doJob(t);
                }}
                onLook={
                  t.call_id
                    ? () => {
                        setListOpen(false);
                        look(t);
                      }
                    : null
                }
              />
            ))}
          </ul>
        </Modal>
      )}
      {peek?.call_id && (
        <CallDrawer
          callId={peek.call_id}
          onClose={() => setPeek(null)}
          action={
            peek.actions?.length || (peek.lead_id && leadById.get(peek.lead_id))
              ? {
                  label: jobButton(peek),
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
          customer={acting.customer}
          summary={actions}
          onClose={() => setActing(null)}
          onDone={refreshAll}
        />
      )}
      {card && leadById.get(card) && (
        <Modal open onClose={() => setCard(null)} title={displayName(leadById.get(card)!.name)}>
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

/**
 * The one job to do now: who, why, and one big button. A ring shows how far
 * through the day you are.
 */
function UpNext({
  todo,
  place,
  of,
  button,
  onDo,
  onLook,
  onLater,
}: {
  todo: Todo;
  place: number;
  of: number;
  button: string;
  onDo: () => void;
  onLook: (() => void) | null;
  onLater: (() => void) | null;
}) {
  const tone = severity(todo);
  const name = firstName(todo.customer);
  return (
    <section aria-label="Up next" className="card-in relative overflow-hidden rounded-[30px] border border-hairline bg-surface p-6 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.25)] sm:p-8">
      <span
        className={`pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-60 blur-3xl ${tone === "bad" ? "bg-bad-soft" : "bg-warn-soft"}`}
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-3">
        <p className="text-[15px] font-semibold uppercase tracking-wide text-ink/75">Up next</p>
        <Progress place={place} of={of} />
      </div>
      <div className="relative mt-4 flex items-start gap-4">
        <span
          className={`hidden h-14 w-14 shrink-0 items-center justify-center rounded-full text-[22px] font-bold sm:flex ${tone === "bad" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}
          aria-hidden
        >
          {name ? name[0].toUpperCase() : ICON[tone]}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[26px] font-bold leading-tight tracking-title sm:text-[30px]">{todo.title}</h2>
          <p className="mt-2 text-[19px] leading-snug text-ink/80">{todo.plain ?? todo.why}</p>
        </div>
      </div>
      <button className="btn-primary relative mt-7 min-h-[60px] w-full text-[19px] font-semibold shadow-[0_14px_30px_-12px_rgb(var(--accent)/0.7)]" onClick={onDo}>
        {button} →
      </button>
      {(onLook || onLater) && (
        <div className={`relative mt-3 grid gap-3 ${onLook && onLater ? "grid-cols-2" : "grid-cols-1"}`}>
          {onLook && (
            <button className="btn-secondary min-h-[52px] px-3 text-[17px]" onClick={onLook}>
              <PlayIcon className="h-3.5 w-3.5" />
              What happened?
            </button>
          )}
          {onLater && (
            <button className="btn-secondary min-h-[52px] px-3 text-[17px]" onClick={onLater}>
              Later
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** "3 of 13" as a ring that fills as the day gets done. */
function Progress({ place, of }: { place: number; of: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const done = Math.max(0, place - 1) / Math.max(1, of);
  return (
    <span className="flex items-center gap-2 text-[16px] font-semibold text-ink/70">
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="4" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="rgb(var(--good))"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - done)}
          style={{ transition: "stroke-dashoffset 800ms var(--ease-apple)" }}
        />
      </svg>
      {place} of {of}
    </span>
  );
}

/** Nothing left: a tick that draws itself. */
function AllDone({ count }: { count: number }) {
  return (
    <section aria-label="Up next" className="card-in rounded-[30px] border border-hairline bg-surface px-6 py-10 text-center shadow-[0_20px_50px_-24px_rgba(0,0,0,0.25)]">
      <span className="ring-pop mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-good text-white">
        <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" aria-hidden>
          <path className="draw-check" d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h2 className="mt-5 text-[28px] font-bold tracking-title">You&apos;re all caught up</h2>
      <p className="mx-auto mt-2 max-w-[36ch] text-[18px] text-ink/75">
        {count ? `${count} thing${count === 1 ? "" : "s"} done. ` : ""}New jobs show up here by themselves.
      </p>
    </section>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <section aria-label="Up next" className="card-in rounded-[30px] border border-hairline bg-surface px-6 py-10 text-center">
      <h2 className="text-[26px] font-bold tracking-title">Let&apos;s get started</h2>
      <p className="mx-auto mt-2 max-w-[38ch] text-[18px] text-ink/75">Add a call recording. PestLaunch listens to it and tells you what to do next.</p>
      <button className="btn-primary mt-6 min-h-[56px] px-8 text-[18px]" onClick={onAdd}>
        <UploadIcon className="h-5 w-5" />
        Add a call
      </button>
    </section>
  );
}

/** Four widgets, each saying in a word how one part of the business is going. */
function Numbers({ cards, board }: { cards: PerformanceCard[]; board: PipelineBoard | null }) {
  const due = board?.summary.needs_action ?? null;
  const tiles = [
    ...cards
      .filter((c) => TILE[c.key])
      .map((c) => {
        const tone = c.of ? TONE[c.status] : "none";
        return {
          key: c.key,
          label: TILE[c.key].label,
          tint: TILE[c.key].tint,
          Icon: TILE[c.key].icon,
          word: VERDICT[tone],
          line: c.of ? TILE[c.key].line(c.count, c.of) : "No calls like this yet",
          tone,
          href: c.action?.href ?? "/v2/calls",
        };
      }),
    {
      key: "callbacks",
      label: "People to call back",
      tint: "blue" as Tint,
      Icon: CallBackIcon,
      word: due === null ? VERDICT.none : due ? `${due} waiting` : "All done",
      line: due === null ? "" : due ? `${due === 1 ? "1 person is" : `${due} people are`} waiting for a call` : "Nobody is waiting",
      tone: (due === null ? "none" : due ? "bad" : "good") as Tone,
      href: "/v2/pipeline",
    },
  ];
  return (
    <section aria-label="How it's going">
      <h2 className="mb-2 px-1 text-[20px] font-semibold tracking-title">How it&apos;s going</h2>
      <div className="settle grid grid-cols-2 gap-3 min-[1180px]:grid-cols-4">
        {tiles.map(({ key, label, tint, Icon, word, line, tone, href }) => (
          <Link
            key={key}
            href={href}
            className="press block rounded-[22px] border border-hairline bg-surface p-4 shadow-card hover:no-underline hover:shadow-md"
          >
            <span className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
              <Tile tint={tint} size={26}>
                <Icon />
              </Tile>
              <span className="text-[15px] font-semibold leading-tight text-ink/75">{label}</span>
            </span>
            <span className={`mt-2.5 block text-[19px] font-bold leading-tight sm:mt-3 sm:text-[22px] ${TEXT_CLS[tone]}`}>
              <span className="mr-1 text-[15px]" aria-hidden>
                {ICON[tone]}
              </span>
              {word}
            </span>
            <span className="mt-1 block text-[15px] text-ink/70">{line}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** One job: who and why in one sentence, one button that does it. */
function JobRow({ todo, button, onDo, onLook }: { todo: Todo; button: string | null; onDo: () => void; onLook: (() => void) | null }) {
  const tone = severity(todo);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-panel px-3.5 py-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${ICON_CLS[tone]}`} aria-hidden>
        {ICON[tone]}
      </span>
      <div className="min-w-[min(100%,300px)] flex-1">
        <p className="text-[17px] font-semibold text-ink">{todo.title}</p>
        <p className="text-[16px] leading-snug text-ink/80">{todo.plain ?? todo.why}</p>
        {onLook && button && (
          <button className="mt-0.5 block min-h-[44px] text-left text-[16px] font-medium text-link underline underline-offset-2" onClick={onLook}>
            What happened on the call?
          </button>
        )}
      </div>
      {button ? (
        <button className="btn-primary ml-10 min-h-[48px] w-[calc(100%-2.5rem)] shrink-0 px-4 text-[16px] sm:w-auto" onClick={onDo}>
          {button} →
        </button>
      ) : onLook ? (
        <button className="btn-primary ml-10 min-h-[48px] w-[calc(100%-2.5rem)] shrink-0 px-4 text-[16px] sm:w-auto" onClick={onLook}>
          Hear what happened →
        </button>
      ) : (
        <Link href={todo.href} className="btn-primary ml-10 min-h-[48px] w-[calc(100%-2.5rem)] shrink-0 px-4 text-[16px] hover:no-underline sm:w-auto">
          Open →
        </Link>
      )}
    </li>
  );
}

/** What was done lately, and what customers said back. */
function Done({ items, summary }: { items: Todo[]; summary: ActionsSummary | null }) {
  const on = summary ? (Object.keys(summary.autopilot) as PreparedAction["kind"][]).filter((k) => summary.autopilot[k]) : [];
  return (
    <section aria-label="Done" className="rounded-[22px] border border-hairline bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-[19px] font-semibold">
          <Tile tint="teal" size={28}>
            <MessageIcon />
          </Tile>
          Done
        </h2>
        <Link href="/v2/outbox" className="inline-flex min-h-[44px] items-center text-[16px] font-medium text-link">
          See all texts →
        </Link>
      </div>
      {items.length ? (
        <ul className="mt-1">
          {items.slice(0, LIST_SHOWN).map((t) => {
            const a = t.handled as PreparedAction;
            return (
              <li key={t.key ?? t.title} className="flex items-start gap-2.5 border-t border-line py-2.5 first:border-t-0">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-good bg-good-soft text-[12px] font-extrabold text-good" aria-hidden>
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">{t.title}</span>
                  <span className="block text-[15px] text-ink/80">{handledText(a)}</span>
                  {a.reply_text && (
                    <span className="mt-1 block rounded-lg bg-accent-soft/70 px-2.5 py-1.5 text-[15px]">
                      <span className="font-semibold">{a.to_name ?? "They"} wrote back:</span> “{a.reply_text}”
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 text-[16px] text-ink/80">Nothing yet. Texts you send show up here, and so do the answers.</p>
      )}
      {summary && (
        <p className="mt-3 border-t border-line pt-3 text-[15px] text-ink/80">
          {on.length ? (
            <>
              <span className="font-semibold text-good">The app sends {on.map((k) => KIND_WORDS[k].many).join(" and ")} by itself.</span>{" "}
            </>
          ) : (
            <>Want the app to send these texts by itself? </>
          )}
          <Link href="/settings#autopilot" className="font-medium text-link">
            {on.length ? "Change that" : "Turn that on"}
          </Link>
        </p>
      )}
    </section>
  );
}

/** The team, whoever needs help most first, with the one thing to work on. */
function Team({ reps }: { reps: RepCard[] }) {
  const sorted = [...reps].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return (
    <section aria-label="Your team" className="rounded-[22px] border border-hairline bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-2.5 text-[19px] font-semibold">
        <Tile tint="indigo" size={28}>
          <TeamIcon />
        </Tile>
        Your team
      </h2>
      <p className="text-[15px] text-ink/80">Who needs help first.</p>
      <ul className="mt-1">
        {sorted.slice(0, LIST_SHOWN).map((r) => (
          <li key={r.id} className="border-t border-line first:border-t-0">
            <Link href={`/v2/reps/${r.id}`} className="group flex min-h-[56px] items-center gap-3 py-2.5 hover:no-underline">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-bold text-link">
                {r.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold text-ink group-hover:text-link">{personLabel(r.name)}</span>
                <span className={`block text-[15px] ${r.focus ? "text-bad" : "text-good"}`}>
                  {r.focus ? `✕ Needs to work on: ${r.focus.plain}` : "✓ Doing well"}
                </span>
              </span>
              <span className="text-[20px] text-muted" aria-hidden>
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {reps.length > LIST_SHOWN && (
        <Link href="/v2/reps" className="inline-flex min-h-[44px] items-center text-[16px] font-medium text-link">
          See all {reps.length} people →
        </Link>
      )}
    </section>
  );
}

/** Customers who got a price and haven't said yes, the biggest first. */
function Deciding({ leads, onOpen }: { leads: PipelineLead[]; onOpen: (l: PipelineLead) => void }) {
  const top = [...leads].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, LIST_SHOWN);
  return (
    <section aria-label="Waiting for a yes" className="rounded-[22px] border border-hairline bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-2.5 text-[19px] font-semibold">
        <Tile tint="green" size={28}>
          <CallBackIcon />
        </Tile>
        Waiting for a yes
      </h2>
      <p className="text-[15px] text-ink/80">People who haven&apos;t decided. Press a name to call them.</p>
      <ul className="mt-1">
        {top.map((l) => {
          const days = daysSince(l.last_contact_at);
          return (
            <li key={l.id} className="border-t border-line first:border-t-0">
              <button className="group flex min-h-[56px] w-full items-center gap-3 py-2.5 text-left" onClick={() => onOpen(l)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold group-hover:text-link">{displayName(l.name)}</span>
                  <span className={`block text-[15px] ${days !== null && days >= 7 ? "text-bad" : "text-ink/80"}`}>
                    {days === null ? "Not called yet" : days === 0 ? "Talked to today" : `No call in ${timeWords(days)}`}
                  </span>
                </span>
                {l.value !== null && <span className="tnum text-[16px] font-semibold">{money(l.value)}</span>}
                <span className="text-[20px] text-muted" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Link href="/v2/pipeline" className="inline-flex min-h-[44px] items-center text-[16px] font-medium text-link">
        See everyone to call back →
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
                  {actionLabel(a, t.customer)} <span className="font-normal text-muted">· {a.to_phone_pretty}</span>
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
