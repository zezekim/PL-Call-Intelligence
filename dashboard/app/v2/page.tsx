"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type Me } from "@/lib/api";
import { useApi, useTitle } from "@/lib/hooks";
import type { ActionsSummary, Brief, PerformanceCard, PipelineBoard, PipelineLead, PreparedAction, RepCard, Todo } from "@/lib/v2";
import { STATUS_BG, STATUS_TEXT } from "@/lib/v2";
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  MessageIcon,
  PhoneIcon,
  PlayIcon,
  SparkIcon,
  UploadIcon,
} from "@/components/icons";
import { Avatar, Loading, Modal, Spinner } from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { ActionSheet, KIND_WORDS, handledText } from "@/components/v2/act";
import { CallButton, HowDidItGo, LeadCard, useSaveLead, type LeadChange } from "@/components/v2/customer";
import { Meter, PageError } from "@/components/v2/kit";
import { failMessage, useToast } from "@/components/v2/toast";

/**
 * The whole business on one screen, and every part of it a button: how it's
 * going in one sentence, one big button that sends every text already
 * written, four numbers that open what's behind them, the jobs (one tap
 * each) and the team, weakest first.
 */
export default function TodayPage() {
  useTitle("Today");
  // Today is about what to do now, whatever period the other pages show.
  const { data, error, status, loading, reload } = useApi<Brief>("/intel/v2/brief");
  const summary = useApi<ActionsSummary>("/intel/actions/summary");
  const reps = useApi<RepCard[]>("/intel/v2/reps").data;
  const business = useApi<Me>("/auth/me").data?.business_name ?? null;
  const boardApi = useApi<PipelineBoard>("/intel/v2/pipeline");
  const board = boardApi.data;
  const leadById = new Map((board ? [...board.open, ...board.closed] : []).map((l) => [l.id, l]));
  const [card, setCard] = useState<string | null>(null);
  // Done-for-you extras are optional: an older or partial answer leaves them out.
  const actions = summary.data?.autopilot ? summary.data : null;
  const [acting, setActing] = useState<Todo | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Sent from this page: shown as done at once, before the list reloads.
  const [sentKeys, setSentKeys] = useState<string[]>([]);
  const [allJobs, setAllJobs] = useState(false);

  // Draft the actions for anything new since the last visit, then show them.
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

  const keyOf = (t: Todo, i: number) => t.key ?? `${t.title}-${i}`;
  const open = data.todo.map((t, i) => ({ t, k: keyOf(t, i) })).filter(({ t }) => !t.handled);
  // Ready to go with one tap: written and with a number to send to.
  const ready = open.filter(({ t, k }) => t.actions?.[0]?.to_phone && !sentKeys.includes(k));
  const readyValue = ready.reduce((sum, { t }) => sum + (t.value ?? 0), 0);
  const handled = data.todo.filter((t) => t.handled);

  const waiting = open.filter(({ k }) => !sentKeys.includes(k)).length;
  const shownJobs = allJobs ? open : open.slice(0, JOBS_SHOWN);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Hello verdict={data.calls.analyzed ? data.headline.title : null} />
        <button className="btn-secondary min-h-[48px] text-[16px]" onClick={() => setUploadOpen(true)}>
          <UploadIcon className="h-5 w-5" />
          Add a call recording
        </button>
      </div>

      {actions?.practice && (
        <p className="rounded-2xl bg-warn-soft px-5 py-3 text-[16px]">
          <span className="font-semibold">Practice mode:</span> nothing goes to real phones. You can see every text on
          the Texts page.
        </p>
      )}

      {ready.length > 0 && (
        <section
          aria-label="Do it all for me"
          className="flex flex-col gap-4 rounded-[24px] bg-accent-soft/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
        >
          <p className="text-[19px] leading-snug">
            <span className="font-semibold">I wrote {ready.length === 1 ? "1 text" : `${ready.length} texts`}</span> for the
            customers who need you
            {readyValue ? <> · worth <span className="font-semibold">${Math.round(readyValue).toLocaleString()} a year</span></> : ""}.
          </p>
          <button
            className="magic-button group min-h-[68px] shrink-0 rounded-[22px] px-8 text-[21px] font-semibold text-white"
            onClick={() => setAllOpen(true)}
          >
            <SparkIcon className="h-7 w-7 shrink-0 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
            Do it all for me
          </button>
        </section>
      )}

      {data.calls.analyzed > 0 && <Numbers cards={data.cards} board={board} />}

      <div className="grid gap-6 min-[1180px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] min-[1180px]:items-start">
        <section aria-label="Needs you" className="card p-4 sm:p-5">
          <PanelHead title="Needs you" count={waiting} />
          {open.length > 0 ? (
            <ul className="space-y-2.5">
              {shownJobs.map(({ t, k }) => {
                const lead = t.lead_id ? leadById.get(t.lead_id) ?? null : null;
                return (
                  <JobRow
                    key={k}
                    todo={t}
                    lead={lead}
                    sent={sentKeys.includes(k)}
                    practice={!!actions?.practice}
                    onOpen={lead ? () => setCard(lead.id) : t.actions?.length ? () => setActing(t) : null}
                    onSent={() => {
                      setSentKeys((s) => [...s, k]);
                      // Let the green tick show before the row moves to Done.
                      window.setTimeout(() => void refreshAll(), 1600);
                    }}
                    onLeadChange={(c) => lead && void saveLead(lead, c)}
                  />
                );
              })}
            </ul>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl bg-good-soft px-4 py-4">
              <span className="pop-in flex h-10 w-10 items-center justify-center rounded-full bg-good text-white">
                <CheckIcon className="h-6 w-6" />
              </span>
              <span className="text-[18px] font-semibold">All done! New jobs show up here by themselves.</span>
            </div>
          )}
          {open.length > JOBS_SHOWN && (
            <button className="btn-secondary mt-3 min-h-[48px] w-full text-[16px]" onClick={() => setAllJobs((x) => !x)}>
              {allJobs ? "Show less" : `Show ${open.length - JOBS_SHOWN} more`}
            </button>
          )}
        </section>

        <div className="space-y-6">
          {reps && reps.length > 0 && <Team reps={reps} />}
          {handled.length > 0 && <Handled items={handled} />}
          <Autopilot summary={actions} />
        </div>
      </div>

      {acting && (
        <ActionSheet
          open={!!acting}
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
      <DoItAll
        open={allOpen}
        jobs={ready.map(({ t, k }) => ({ todo: t, key: k }))}
        summary={actions}
        onClose={() => setAllOpen(false)}
        onSent={(keys) => setSentKeys((s) => [...s, ...keys])}
        onDone={refreshAll}
      />
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => void refreshAll()} logHref="/v2/calls" />
    </div>
  );
}

// The panels stay short; the rest is one tap away.
const JOBS_SHOWN = 6;
const TEAM_SHOWN = 5;

function PanelHead({ title, count, href, more }: { title: string; count?: number; href?: string; more?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-1">
      <h2 className="flex items-center gap-2 text-[20px] font-semibold">
        {title}
        {count ? (
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-[14px] font-semibold text-white">{count}</span>
        ) : null}
      </h2>
      {href && more && (
        <Link href={href} className="btn-secondary min-h-[40px] px-4 text-[15px] hover:no-underline">
          {more}
          <ChevronIcon className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

/** Four numbers, coloured against their goals. Each one opens what's behind it. */
function Numbers({ cards, board }: { cards: PerformanceCard[]; board: PipelineBoard | null }) {
  const tile =
    "flex flex-col rounded-[22px] border border-line bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:no-underline sm:p-5";
  const shown = cards.filter((c) => c.key !== "quality");
  const due = board?.summary.needs_action ?? null;
  return (
    <section aria-label="How it's going" className="grid grid-cols-2 gap-3 min-[1180px]:grid-cols-4">
      {shown.map((c) => (
        <Link key={c.key} href={c.action?.href ?? "/v2/reps"} className={tile}>
          <span className="text-[15px] font-semibold leading-snug text-ink/85">{c.label}</span>
          <span className={`tnum mt-2 text-[30px] font-semibold leading-none tracking-title ${STATUS_TEXT[c.status]}`}>
            {c.of ? `${c.count} of ${c.of}` : "–"}
          </span>
          <span className="mt-1 text-[14px] text-ink/75">{c.metric_label.toLowerCase()}</span>
          <span className="mt-3 block">
            <Meter value={c.value} target={c.target} status={c.status} label={`${c.label}, ${c.metric_label}`} />
          </span>
        </Link>
      ))}
      <Link href="/v2/pipeline" className={tile}>
        <span className="text-[15px] font-semibold leading-snug text-ink/85">Call backs waiting</span>
        <span className={`tnum mt-2 text-[30px] font-semibold leading-none tracking-title ${due ? "text-warn" : "text-good"}`}>
          {due ?? "–"}
        </span>
        <span className="mt-1 text-[14px] text-ink/75">
          {due === null ? "" : due ? `$${Math.round(board!.summary.open_value).toLocaleString()} still deciding` : "all caught up"}
        </span>
      </Link>
    </section>
  );
}

/** The team, weakest first, with the one thing each should work on. */
function Team({ reps }: { reps: RepCard[] }) {
  const sorted = [...reps].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return (
    <section aria-label="Your team" className="card p-4 sm:p-5">
      <PanelHead title="Your team" href="/v2/reps" more={reps.length > TEAM_SHOWN ? `All ${reps.length}` : "Open"} />
      <ul className="space-y-1">
        {sorted.slice(0, TEAM_SHOWN).map((r) => (
          <li key={r.id}>
            <Link
              href={`/v2/reps/${r.id}`}
              className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-surface-hover hover:no-underline"
            >
              <Avatar name={r.name} size={38} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[17px] font-semibold text-ink">{r.name}</span>
                  <span className={`tnum text-[17px] font-semibold ${STATUS_TEXT[r.status]}`}>
                    {r.score === null ? "–" : `${Math.round(r.score)}%`}
                  </span>
                </span>
                <span className="mt-1.5 block h-2 rounded-full bg-fill">
                  <span
                    className={`block h-full rounded-full ${STATUS_BG[r.status]}`}
                    style={{ width: `${Math.max(0, Math.min(100, r.score ?? 0))}%` }}
                  />
                </span>
                <span className="mt-1 block truncate text-[14px] text-ink/75">
                  {r.focus ? `Work on: ${r.focus.plain}` : "On track"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Good morning." and how the business is doing, in one sentence. */
function Hello({ verdict }: { verdict: string | null }) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="min-w-0">
      <h1 className="large-title">{hello}</h1>
      <p className="mt-2 text-[20px] leading-snug text-ink/85">
        {verdict ?? "Add a call recording and I'll tell you what to do."}
      </p>
    </div>
  );
}

/** "$588 a year", for the value of a job. */
function perYear(value: number | null | undefined): string | null {
  return value ? `$${Math.round(value).toLocaleString()} a year` : null;
}

/**
 * One job as one row: what it is on top, then its buttons. Call rings the
 * customer and then asks how it went; Text sends the text already written;
 * tapping the job itself opens the customer's card (or the text, to read
 * first).
 */
function JobRow({
  todo,
  lead,
  sent,
  practice,
  onOpen,
  onSent,
  onLeadChange,
}: {
  todo: Todo;
  lead: PipelineLead | null;
  sent: boolean;
  practice: boolean;
  onOpen: (() => void) | null;
  onSent: () => void;
  onLeadChange: (change: LeadChange) => void;
}) {
  const toast = useToast();
  const action = todo.actions?.[0];
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const worth = perYear(todo.value);
  const phone = lead?.phone ?? todo.phone ?? null;
  const pretty = lead?.phone_pretty || todo.phone_pretty;
  const sub = [action && !phone ? `I wrote: “${action.label}”` : null, worth].filter(Boolean).join(" · ");

  async function sendNow() {
    if (!action) return;
    setBusy(true);
    try {
      const done = await api.post<PreparedAction>(`/intel/actions/${action.id}/perform`, { body: null, phone: null });
      if (done.status !== "done") {
        toast({ message: done.error ?? failMessage(), tone: "error" });
        return;
      }
      const who = done.to_name ?? done.to_phone_pretty;
      toast({ message: practice ? `Done: ${who} (practice, on the Texts page)` : `Done: sent to ${who}` });
      onSent();
    } catch (err) {
      toast({ message: err instanceof ApiError && err.status === 400 ? err.message : failMessage(), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${sent ? "bg-good text-white" : "bg-accent-soft text-accent"}`}
        aria-hidden
      >
        {sent ? (
          <CheckIcon className="pop-in h-6 w-6" />
        ) : phone ? (
          <PhoneIcon className="h-5 w-5" />
        ) : action ? (
          <MessageIcon className="h-6 w-6" />
        ) : (
          <PlayIcon className="h-6 w-6" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[18px] font-semibold leading-snug">{todo.title}</span>
        <span className="mt-0.5 block text-[15px] text-ink/75">{sent ? "Done!" : sub || todo.why}</span>
      </span>
      {onOpen && !sent && <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />}
    </>
  );

  const textButton = action?.to_phone ? (
    <button
      className={`${phone ? "btn-secondary" : "btn-primary"} min-h-[52px] flex-1 rounded-2xl px-5 text-[17px] sm:flex-none`}
      disabled={busy}
      onClick={() => void sendNow()}
      aria-label={`Do it: ${action.label}`}
    >
      {busy ? <Spinner className="h-5 w-5" /> : <MessageIcon className="h-5 w-5" />}
      {phone ? "Send the text" : "Do it"}
    </button>
  ) : null;

  return (
    <li
      className={`rounded-[22px] border p-3 transition-all duration-300 ${
        sent ? "border-good/40 bg-good-soft" : "border-line bg-surface"
      }`}
    >
      {onOpen ? (
        <button
          className="flex w-full min-w-0 items-center gap-3 rounded-2xl p-1 text-left hover:bg-surface-hover"
          onClick={onOpen}
          disabled={sent}
          aria-label={lead ? `${todo.title}: open their card` : `${todo.title}: read the text first`}
        >
          {body}
        </button>
      ) : (
        <Link href={todo.href} className="flex w-full min-w-0 items-center gap-3 rounded-2xl p-1 hover:bg-surface-hover hover:no-underline">
          {body}
        </Link>
      )}
      {!sent && (
        <div className="mt-2.5">
          {asking && lead ? (
            <HowDidItGo
              name={lead.name}
              onCancel={() => setAsking(false)}
              onAnswer={(c) => {
                setAsking(false);
                onLeadChange(c);
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {phone && (
                <CallButton
                  phone={phone}
                  pretty={pretty}
                  name={lead?.name ?? null}
                  className="flex-1 sm:flex-none"
                  onCalled={lead ? () => window.setTimeout(() => setAsking(true), 600) : undefined}
                />
              )}
              {textButton}
              {!phone && !action?.to_phone && (
                <Link
                  href={todo.href}
                  className="btn-secondary min-h-[52px] flex-1 rounded-2xl px-5 text-[17px] hover:no-underline sm:flex-none"
                >
                  <PlayIcon className="h-4 w-4" />
                  Listen
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The magic button: a look at every text, then one tap sends them all, each
 * ticking off as it goes, and ends on what that was worth.
 */
function DoItAll({
  open,
  jobs,
  summary,
  onClose,
  onSent,
  onDone,
}: {
  open: boolean;
  jobs: { todo: Todo; key: string }[];
  summary: ActionsSummary | null;
  onClose: () => void;
  onSent: (keys: string[]) => void;
  onDone: () => void | Promise<void>;
}) {
  const toast = useToast();
  // Frozen when sending starts, so the list doesn't shift as rows finish.
  const [batch, setBatch] = useState<{ todo: Todo; key: string }[]>([]);
  const [state, setState] = useState<Record<string, "waiting" | "sending" | "done" | "failed">>({});
  const [phase, setPhase] = useState<"look" | "sending" | "finished">("look");
  const [autoBusy, setAutoBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhase("look");
    setState({});
    setBatch(jobs);
    // Only when it opens: later reloads must not reset a send in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const list = phase === "look" ? jobs : batch;
  const done = list.filter((j) => state[j.key] === "done");
  const failed = list.filter((j) => state[j.key] === "failed");
  const worth = done.reduce((sum, j) => sum + (j.todo.value ?? 0), 0);
  const kinds = [...new Set(done.map((j) => j.todo.actions![0].kind))].filter((k) => summary && !summary.autopilot[k]);

  async function sendAll() {
    const frozen = jobs;
    setBatch(frozen);
    setPhase("sending");
    const sent: string[] = [];
    for (const job of frozen) {
      setState((s) => ({ ...s, [job.key]: "sending" }));
      try {
        const res = await api.post<PreparedAction>(`/intel/actions/${job.todo.actions![0].id}/perform`, { body: null, phone: null });
        const ok = res.status === "done";
        if (ok) sent.push(job.key);
        setState((s) => ({ ...s, [job.key]: ok ? "done" : "failed" }));
      } catch {
        setState((s) => ({ ...s, [job.key]: "failed" }));
      }
    }
    onSent(sent);
    setPhase("finished");
    void onDone();
  }

  async function autopilotOn() {
    setAutoBusy(true);
    try {
      await Promise.all(kinds.map((kind) => api.put("/intel/actions/autopilot", { kind, on: true })));
      toast({ message: "Done. I'll do these for you from now on." });
      onClose();
      void onDone();
    } catch {
      toast({ message: failMessage(), tone: "error" });
    } finally {
      setAutoBusy(false);
    }
  }

  const title = phase === "finished" ? (done.length ? "All done!" : "That didn't go through") : phase === "sending" ? "Working on it…" : "Here's what I'll send";

  return (
    <Modal open={open} onClose={() => phase !== "sending" && onClose()} title={title}>
      {phase === "finished" && done.length === 0 && (
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-bad-soft text-bad">
            <AlertIcon className="h-10 w-10" />
          </span>
          <p className="mt-4 text-[19px]">Nothing was sent. Everything is still on your list, so you can try again in a minute.</p>
        </div>
      )}

      {phase === "finished" && done.length > 0 && (
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="pop-in flex h-20 w-20 items-center justify-center rounded-full bg-good text-white">
            <CheckIcon className="h-11 w-11" />
          </span>
          <p className="mt-4 text-[22px] font-semibold">
            {done.length} {done.length === 1 ? "customer" : "customers"} taken care of
          </p>
          {worth > 0 && (
            <p className="mt-1 text-[18px] font-semibold text-good">${Math.round(worth).toLocaleString()} a year you&apos;re going after</p>
          )}
          {failed.length > 0 && (
            <p className="mt-2 text-[16px] text-bad">
              {failed.length} didn&apos;t go. They&apos;re still on your list to try again.
            </p>
          )}
          {summary?.practice && <p className="mt-2 text-[15px] text-muted">Practice mode: they&apos;re on the Texts page.</p>}
        </div>
      )}

      {phase !== "finished" && (
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto" aria-label="The texts">
          {list.map((j) => {
            const a = j.todo.actions![0];
            const s = state[j.key];
            return (
              <li
                key={j.key}
                className={`flex items-start gap-3 rounded-2xl px-4 py-3 transition-colors duration-300 ${s === "done" ? "bg-good-soft" : s === "failed" ? "bg-bad-soft" : "bg-panel"}`}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden>
                  {s === "sending" ? (
                    <Spinner className="h-5 w-5" />
                  ) : s === "done" ? (
                    <span className="pop-in flex h-7 w-7 items-center justify-center rounded-full bg-good text-white">
                      <CheckIcon className="h-4 w-4" />
                    </span>
                  ) : (
                    <MessageIcon className="h-5 w-5 text-accent" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">
                    {a.label}
                    <span className="font-normal text-muted"> · {a.to_name ?? a.to_phone_pretty}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[14px] text-ink/75">{a.body}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {phase === "look" && (
          <>
            <button className="magic-button min-h-[64px] rounded-2xl text-[20px] font-semibold text-white" onClick={() => void sendAll()}>
              Send {jobs.length === 1 ? "it" : `all ${jobs.length}`}
            </button>
            <button className="btn-secondary min-h-[52px] text-[17px]" onClick={onClose}>
              Not now
            </button>
          </>
        )}
        {phase === "sending" && (
          <p className="text-center text-[17px] text-ink/80" aria-live="polite">
            {done.length + failed.length} of {list.length} done
          </p>
        )}
        {phase === "finished" && kinds.length > 0 && done.length > 0 && (
          <>
            <button className="magic-button min-h-[64px] rounded-2xl text-[19px] font-semibold text-white" disabled={autoBusy} onClick={() => void autopilotOn()}>
              {autoBusy && <Spinner className="h-5 w-5" />}
              Do this for me every day
            </button>
            <p className="text-center text-[14px] text-muted">
              I&apos;ll send {kinds.map((k) => KIND_WORDS[k].many).join(" and ")} by myself, 9am to 7pm. Turn it off any time.
            </p>
          </>
        )}
        {phase === "finished" && (
          <button className="btn-secondary min-h-[52px] text-[17px]" onClick={onClose}>
            {done.length ? "Great, thanks" : "OK"}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** What was done in the last few days, and what customers said back. */
function Handled({ items }: { items: Todo[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 3);
  return (
    <section aria-label="Done">
      <h2 className="mb-3 px-1 text-[20px] font-semibold text-good">Done</h2>
      <ul className="group-list">
        {shown.map((t) => {
          const a = t.handled as PreparedAction;
          return (
            <li key={t.key ?? t.title} className="flex items-start gap-3 px-5 py-3">
              <CheckIcon className="mt-1 h-5 w-5 shrink-0 text-good" />
              <div className="min-w-0 flex-1 text-[16px]">
                <p className="font-medium">{t.title}</p>
                <p className="text-[15px] text-ink/75">{handledText(a)}</p>
                {a.reply_text && (
                  <p className="mt-1.5 rounded-xl bg-accent-soft/60 px-3 py-2 text-[16px]">
                    <span className="font-medium">{a.to_name ?? "They"} replied:</span> “{a.reply_text}”
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > 3 && (
        <button className="btn-secondary mt-3 min-h-[48px] w-full text-[16px]" onClick={() => setAll((x) => !x)}>
          {all ? "Show less" : `Show ${items.length - 3} more`}
        </button>
      )}
    </section>
  );
}

/** What runs by itself, as one button. */
function Autopilot({ summary }: { summary: ActionsSummary | null }) {
  if (!summary) return null;
  const on = (Object.keys(summary.autopilot) as PreparedAction["kind"][]).filter((k) => summary.autopilot[k]);
  const auto = summary.done_today.filter((a) => a.auto).length;
  return (
    <Link
      href="/settings#autopilot"
      className="flex min-h-[64px] items-center gap-4 rounded-[22px] border border-line bg-surface px-5 py-3 shadow-sm hover:no-underline"
    >
      <SparkIcon className="h-6 w-6 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-[16px] text-ink">
        {on.length ? (
          <>
            <span className="font-semibold">Autopilot is on</span> for {on.map((k) => KIND_WORDS[k].many).join(" and ")}
            {auto ? `: ${auto} sent today.` : "."}
          </>
        ) : (
          <>
            <span className="font-semibold">Want this done without asking?</span> Turn on autopilot.
          </>
        )}
      </span>
      <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
    </Link>
  );
}
