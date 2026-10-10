"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApi, useTitle } from "@/lib/hooks";
import type { ActionsSummary, Brief, PreparedAction, Todo } from "@/lib/v2";
import {
  AlertIcon,
  CallBackIcon,
  CheckIcon,
  ChevronIcon,
  MessageIcon,
  PlayIcon,
  SparkIcon,
  TeamIcon,
  UploadIcon,
} from "@/components/icons";
import { Loading, Modal, Spinner } from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { ActionSheet, KIND_WORDS, handledText } from "@/components/v2/act";
import { PageError } from "@/components/v2/kit";
import { failMessage, useToast } from "@/components/v2/toast";

/**
 * Buttons, not reading. The texts are already written, so the page leads with
 * one big button that sends them all; every job below is one tap; and the
 * other pages are big tiles at the bottom.
 */
export default function TodayPage() {
  useTitle("Today");
  // Today is about what to do now, whatever period the other pages show.
  const { data, error, status, loading, reload } = useApi<Brief>("/intel/v2/brief");
  const summary = useApi<ActionsSummary>("/intel/actions/summary");
  // Done-for-you extras are optional: an older or partial answer leaves them out.
  const actions = summary.data?.autopilot ? summary.data : null;
  const [acting, setActing] = useState<Todo | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Sent from this page: shown as done at once, before the list reloads.
  const [sentKeys, setSentKeys] = useState<string[]>([]);

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
    await Promise.all([reload(), summary.reload()]);
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <PageError status={status} onRetry={() => void reload()} />;
  if (!data) return null;

  const keyOf = (t: Todo, i: number) => t.key ?? `${t.title}-${i}`;
  const open = data.todo.map((t, i) => ({ t, k: keyOf(t, i) })).filter(({ t }) => !t.handled);
  // Ready to go with one tap: written and with a number to send to.
  const ready = open.filter(({ t, k }) => t.actions?.[0]?.to_phone && !sentKeys.includes(k));
  const readyValue = ready.reduce((sum, { t }) => sum + (t.value ?? 0), 0);
  const handled = data.todo.filter((t) => t.handled);

  return (
    <div className="mx-auto max-w-[760px] space-y-8">
      <Hello open={open.filter(({ k }) => !sentKeys.includes(k)).length} ready={ready.length} analyzed={data.calls.analyzed > 0} />

      {actions?.practice && (
        <p className="rounded-2xl bg-warn-soft px-5 py-3 text-[16px]">
          <span className="font-semibold">Practice mode:</span> nothing goes to real phones. You can see every text on
          the Texts page.
        </p>
      )}

      {ready.length > 0 && (
        <section aria-label="Do it all for me" className="text-center">
          <button
            className="magic-button group relative inline-flex min-h-[88px] w-full items-center justify-center gap-3 rounded-[28px] px-8 text-[24px] font-semibold text-white sm:text-[26px]"
            onClick={() => setAllOpen(true)}
          >
            <SparkIcon className="h-8 w-8 shrink-0 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
            Do it all for me
          </button>
          <p className="mt-3 text-[17px] text-ink/80">
            Sends {ready.length === 1 ? "the text" : `all ${ready.length} texts`} I wrote
            {readyValue ? ` · worth $${Math.round(readyValue).toLocaleString()} a year` : ""}. You see {ready.length === 1 ? "it" : "them"} first.
          </p>
        </section>
      )}

      {open.length > 0 && (
        <section aria-label="Your jobs">
          <h2 className="mb-3 px-1 text-[20px] font-semibold">{ready.length ? "Or tap one at a time" : "Your jobs"}</h2>
          <ul className="space-y-3">
            {open.map(({ t, k }) => (
              <JobRow
                key={k}
                todo={t}
                sent={sentKeys.includes(k)}
                practice={!!actions?.practice}
                onOpen={() => setActing(t)}
                onSent={() => {
                  setSentKeys((s) => [...s, k]);
                  // Let the green tick show before the row moves to Done.
                  window.setTimeout(() => void refreshAll(), 1600);
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {open.length === 0 && data.calls.analyzed > 0 && (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <span className="pop-in flex h-20 w-20 items-center justify-center rounded-full bg-good-soft">
            <CheckIcon className="h-11 w-11 text-good" />
          </span>
          <p className="mt-4 text-[26px] font-semibold">All done!</p>
          <p className="mt-1 text-[18px] text-ink/80">New jobs show up here by themselves as calls come in.</p>
        </div>
      )}

      <Tiles onUpload={() => setUploadOpen(true)} />

      {handled.length > 0 && <Handled items={handled} />}
      <Autopilot summary={actions} />

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

/** "Good morning." and, in one line, how much there is to do. */
function Hello({ open, ready, analyzed }: { open: number; ready: number; analyzed: boolean }) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  let line: string;
  if (!analyzed) line = "Add a call recording below and I'll tell you what to do.";
  else if (open <= 0) line = "Nothing needs you right now.";
  else if (ready > 0) line = `${open} ${open === 1 ? "thing needs" : "things need"} you. I already wrote ${ready === 1 ? "1 text" : `${ready} texts`}.`;
  else line = `${open} ${open === 1 ? "thing needs" : "things need"} you.`;
  return (
    <div>
      <h1 className="large-title">{hello}</h1>
      <p className="mt-2 text-[21px] leading-snug text-ink/85">{line}</p>
    </div>
  );
}

/** "$588 a year", for the value of a job. */
function perYear(value: number | null | undefined): string | null {
  return value ? `$${Math.round(value).toLocaleString()} a year` : null;
}

/**
 * One job as one big row. The button on the right does it there and then;
 * anywhere else on the row opens the text to read or change first.
 */
function JobRow({
  todo,
  sent,
  practice,
  onOpen,
  onSent,
}: {
  todo: Todo;
  sent: boolean;
  practice: boolean;
  onOpen: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const action = todo.actions?.[0];
  const [busy, setBusy] = useState(false);
  const worth = perYear(todo.value);
  const sub = [action ? `I wrote: “${action.label}”` : null, worth].filter(Boolean).join(" · ");

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

  const rowClass = `flex w-full flex-col gap-3 rounded-[22px] border px-4 py-4 text-left transition-all duration-300 sm:flex-row sm:items-center sm:gap-4 sm:px-5 ${
    sent ? "border-good/40 bg-good-soft" : "border-line bg-surface shadow-sm hover:-translate-y-0.5 hover:shadow-md"
  }`;
  const body = (
    <>
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${sent ? "bg-good text-white" : "bg-accent-soft text-accent"}`}
        aria-hidden
      >
        {sent ? <CheckIcon className="pop-in h-6 w-6" /> : action ? <MessageIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[19px] font-semibold leading-snug">{todo.title}</span>
        <span className="mt-0.5 block text-[15px] text-ink/75">{sent ? "Done!" : sub || todo.why}</span>
      </span>
    </>
  );

  return (
    <li className={rowClass}>
      {action ? (
        <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={onOpen} disabled={sent} aria-label={`${todo.title}: read the text first`}>
          {body}
        </button>
      ) : (
        <Link href={todo.href} className="flex min-w-0 flex-1 items-center gap-4 hover:no-underline">
          {body}
        </Link>
      )}
      {sent ? null : action?.to_phone ? (
        <button
          className="btn-primary min-h-[56px] w-full shrink-0 rounded-2xl px-5 text-[18px] sm:w-auto"
          disabled={busy}
          onClick={() => void sendNow()}
          aria-label={`Do it: ${action.label}`}
        >
          {busy ? <Spinner className="h-5 w-5" /> : <CheckIcon className="h-5 w-5" />}
          Do it
        </button>
      ) : action ? (
        <button className="btn-secondary min-h-[56px] w-full shrink-0 rounded-2xl px-5 text-[17px] sm:w-auto" onClick={onOpen}>
          Add number
        </button>
      ) : (
        <Link href={todo.href} className="btn-secondary min-h-[56px] w-full shrink-0 rounded-2xl px-5 text-[17px] hover:no-underline sm:w-auto">
          Listen
        </Link>
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

/** The other pages, as big buttons. */
function Tiles({ onUpload }: { onUpload: () => void }) {
  const tile =
    "flex min-h-[112px] flex-col items-start justify-between gap-3 rounded-[22px] border border-line bg-surface p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:no-underline";
  const items = [
    { href: "/v2/pipeline", label: "Who to call back", icon: CallBackIcon },
    { href: "/v2/reps", label: "How my team is doing", icon: TeamIcon },
    { href: "/v2/calls", label: "Listen to calls", icon: PlayIcon },
    { href: "/v2/outbox", label: "Texts I sent", icon: MessageIcon },
  ];
  return (
    <section aria-label="Go to">
      <h2 className="mb-3 px-1 text-[20px] font-semibold">What else?</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={tile}>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Icon className="h-6 w-6" />
            </span>
            <span className="flex w-full items-center justify-between gap-2 text-[17px] font-semibold text-ink">
              {label}
              <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
            </span>
          </Link>
        ))}
        <button className={tile} onClick={onUpload}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
            <UploadIcon className="h-6 w-6" />
          </span>
          <span className="text-[17px] font-semibold">Add a call recording</span>
        </button>
      </div>
    </section>
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
