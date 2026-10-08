"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApi, useTitle } from "@/lib/hooks";
import { BackIcon } from "@/components/icons";
import { Card, Empty, ErrorNote, Loading, Spinner } from "@/components/ui";
import { failMessage, useToast } from "@/components/v2/toast";

interface Message {
  id: string;
  direction: "out" | "in";
  purpose: string;
  body: string;
  phone: string;
  phone_pretty: string;
  name: string | null;
  to_owner: boolean;
  created_at: string;
}

interface Outbox {
  practice: boolean;
  messages: Message[];
}

interface Thread {
  phone: string;
  name: string;
  pretty: string;
  owner: boolean;
  messages: Message[];
}

/**
 * Practice mode: every text the app would have sent, as conversations, with
 * a box to answer as the person it went to. An answer here runs the same
 * code as a real text back: "1" does the first thing on the morning list,
 * a customer's reply is passed on to you.
 */
export default function OutboxPage() {
  useTitle("Outbox");
  const { data, error, loading, setData, reload } = useApi<Outbox>("/intel/outbox");
  const toast = useToast();
  const threads = useMemo(() => toThreads(data?.messages ?? []), [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-[760px] space-y-5">
      <Link href="/v2" className="-ml-1 inline-flex items-center gap-0.5 text-[15px] text-link hover:underline">
        <BackIcon className="h-4 w-4" /> Today
      </Link>
      <div>
        <h1 className="text-[28px] font-semibold tracking-title">Outbox</h1>
        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-ink/80">
          {data.practice
            ? "Practice mode is on. These texts are shown here instead of being sent. Answer any of them as the person it went to, and the app reacts as if they had texted back."
            : "Practice mode is off, so texts go to real phones. These are from when it was on."}{" "}
          <Link href="/settings#autopilot" className="text-link underline underline-offset-2">
            Settings
          </Link>
        </p>
      </div>

      {threads.length === 0 ? (
        <Card>
          <Empty title="Nothing here yet">
            Send something from Today, or use “Text me today&apos;s list now” in Settings.
          </Empty>
        </Card>
      ) : (
        threads.map((t) => (
          <Conversation
            key={t.phone}
            thread={t}
            canReply={data.practice}
            onReplied={setData}
            onError={(m) => toast({ message: m, tone: "error" })}
          />
        ))
      )}

      {data.messages.length > 0 && (
        <button
          className="btn-ghost min-h-[44px]"
          onClick={async () => {
            await api.delete("/intel/outbox");
            await reload();
          }}
        >
          Clear the Outbox
        </button>
      )}
    </div>
  );
}

function toThreads(messages: Message[]): Thread[] {
  const by = new Map<string, Thread>();
  // Newest conversation first; oldest message first inside it, like a phone.
  for (const m of messages) {
    const key = m.to_owner ? "owner" : m.phone;
    if (!by.has(key)) {
      by.set(key, {
        phone: m.to_owner ? (m.phone === "owner" ? "owner" : m.phone) : m.phone,
        name: m.to_owner ? "You (morning text)" : m.name ?? m.phone_pretty,
        pretty: m.to_owner ? "" : m.phone_pretty,
        owner: m.to_owner,
        messages: [],
      });
    }
    by.get(key)!.messages.unshift(m);
  }
  return [...by.values()];
}

function Conversation({
  thread,
  canReply,
  onReplied,
  onError,
}: {
  thread: Thread;
  canReply: boolean;
  onReplied: (o: Outbox) => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const first = thread.name.split(/\s+/)[0];
  const lastMenu = [...thread.messages].reverse().find((m) => m.purpose === "morning");
  const options = lastMenu ? (lastMenu.body.match(/^\d+\)/gm) ?? []).map((n) => n.replace(")", "")) : [];

  async function reply(body: string) {
    if (!body.trim()) return;
    setBusy(true);
    try {
      onReplied(await api.post<Outbox>("/intel/outbox/reply", { phone: thread.phone, text: body }));
      setText("");
    } catch (err) {
      onError(err instanceof ApiError && err.status === 400 ? err.message : failMessage());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-3">
        <p className="text-[15px] font-semibold">{thread.name}</p>
        {thread.pretty && <p className="text-[13px] text-muted">{thread.pretty}</p>}
      </div>
      <ul className="space-y-2.5 px-5 py-4">
        {thread.messages.map((m) => (
          <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : ""}`}>
            <div
              className={`max-w-[85%] whitespace-pre-line rounded-[18px] px-4 py-2.5 text-[15px] leading-[1.45] [overflow-wrap:anywhere] ${
                m.direction === "out" ? "bg-accent text-white" : "bg-bubble text-ink"
              }`}
            >
              <Linked text={m.body} light={m.direction === "out"} />
              <p className={`mt-1 text-[12px] ${m.direction === "out" ? "text-white" : "text-ink/80"}`}>
                {m.direction === "out" ? "From the app" : `From ${thread.owner ? "you" : first}`} ·{" "}
                {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {canReply && (
        <div className="space-y-2 border-t border-line px-5 py-3">
          {thread.owner && options.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Quick replies">
              {[...options, "ALL", "LIST"].map((o) => (
                <button key={o} className="btn-secondary min-h-[44px] min-w-[52px]" disabled={busy} onClick={() => void reply(o)}>
                  {o === "LIST" ? "List" : o === "ALL" ? "All" : o}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void reply(text);
            }}
          >
            <input
              className="input min-h-[44px] flex-1"
              placeholder={thread.owner ? "Reply as you, e.g. 1" : `Reply as ${first}`}
              aria-label={thread.owner ? "Reply as you" : `Reply as ${first}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1600}
            />
            <button className="btn-primary min-h-[44px]" disabled={busy || !text.trim()}>
              {busy && <Spinner className="h-4 w-4" />}
              Reply
            </button>
          </form>
        </div>
      )}
    </Card>
  );
}

/** Links in a text (the coaching card) open in a new tab. */
function Linked({ text, light }: { text: string; light: boolean }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className={`underline ${light ? "text-white" : "text-link"}`}>
            {p.includes("/coach/") ? "Open the coaching card" : p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
