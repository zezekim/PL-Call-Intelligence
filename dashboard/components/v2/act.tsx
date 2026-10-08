"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { ActionsSummary, PreparedAction } from "@/lib/v2";
import { CheckIcon } from "@/components/icons";
import { ErrorNote, Modal, Spinner } from "@/components/ui";
import { failMessage, useToast } from "@/components/v2/toast";

/** What autopilot would do for each kind, in the owner's words. */
export const KIND_WORDS: Record<PreparedAction["kind"], { many: string; detail: string }> = {
  text_customer: {
    many: "follow-up texts to customers",
    detail: "Quotes waiting on an answer, visits to confirm, problems to check on, and customers who cancelled.",
  },
  remind_rep: {
    many: "call-back requests to your team",
    detail: "A text to the person who took the call, with the number to ring and what to say.",
  },
  coach_rep: {
    many: "weekly coaching texts",
    detail: "Each person's one thing to work on, the words to say, and their own call to listen to.",
  },
};

/** After this many sends of one kind, offer to do them automatically. */
const OFFER_AFTER = 3;

/**
 * One tap to see exactly what will be sent, change it if you like, and send.
 * When a situation can be handled two ways (ask the rep to call, or text the
 * customer), both are offered, best first.
 */
export function ActionSheet({
  open,
  title,
  options,
  summary,
  onClose,
  onDone,
}: {
  open: boolean;
  title: string;
  options: PreparedAction[];
  summary: ActionsSummary | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const option = options[index] ?? options[0];
  const [body, setBody] = useState(option?.body ?? "");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ action: PreparedAction; count: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setSent(null);
    setError(null);
  }, [open]);
  useEffect(() => {
    setBody(option?.body ?? "");
    setPhone("");
    setError(null);
  }, [option?.id, option?.body]);

  if (!option) return null;
  const needsNumber = !option.to_phone;
  const other = options.find((o) => o.id !== option.id);
  const sentBefore = summary?.approvals[option.kind] ?? 0;
  const offerAutopilot = summary && !summary.autopilot[option.kind] && sentBefore + 1 >= OFFER_AFTER;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const done = await api.post<PreparedAction>(`/intel/actions/${option.id}/perform`, {
        body: body.trim() !== option.body ? body : null,
        phone: needsNumber ? phone : null,
      });
      if (done.status !== "done") {
        setError(done.error ?? failMessage());
        return;
      }
      if (offerAutopilot) {
        // Counted now: the summary reloads below with this send included.
        setSent({ action: done, count: sentBefore + 1 });
      } else {
        toast({ message: `Sent to ${done.to_name ?? done.to_phone_pretty}` });
        onClose();
      }
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? err.message : failMessage());
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      await api.post(`/intel/actions/${option.id}/dismiss`);
      toast({ message: "Taken off the list" });
      onClose();
      await onDone();
    } catch {
      setError(failMessage());
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Modal open={open} onClose={onClose} title="Sent">
        <p className="flex items-center gap-2 text-[15px]">
          <CheckIcon className="h-5 w-5 text-good" /> Sent to {sent.action.to_name ?? sent.action.to_phone_pretty}.
        </p>
        <AutopilotOffer
          kind={sent.action.kind}
          count={sent.count}
          onDone={() => {
            onClose();
            void onDone();
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title}>
      <div className="space-y-4">
        {options.length > 1 && (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How to handle it">
            {options.map((o, i) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={i === index}
                onClick={() => setIndex(i)}
                className={`min-h-[44px] rounded-full border px-4 text-[14px] font-medium transition-colors ${
                  i === index ? "border-accent bg-accent-soft/60 ring-1 ring-accent" : "border-line hover:bg-panel"
                }`}
              >
                {o.label}
                {i === 0 && <span className="ml-1.5 text-[12px] font-normal text-muted">best</span>}
              </button>
            ))}
          </div>
        )}

        <div className="text-[14px]">
          <p className="text-[13px] font-medium text-muted">To</p>
          {needsNumber ? (
            <label className="mt-1 block">
              <span className="block">{option.to_name ?? "Customer"}: we don&apos;t have a mobile number yet.</span>
              <input
                className="input mt-1.5 w-full"
                inputMode="tel"
                autoComplete="tel"
                placeholder="Mobile number, e.g. (555) 123-4567"
                aria-label={`Mobile number for ${option.to_name ?? "them"}`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <span className="mt-1 block text-[12px] text-muted">We&apos;ll remember it for next time.</span>
            </label>
          ) : (
            <p className="mt-0.5">
              {option.to_name ?? "Customer"} <span className="text-muted">· {option.to_phone_pretty}</span>
            </p>
          )}
        </div>

        <label className="block">
          <span className="text-[13px] font-medium text-muted">The text (you can change it)</span>
          <textarea
            className="input mt-1 w-full text-[15px] leading-relaxed"
            rows={Math.min(8, Math.max(4, Math.ceil(body.length / 52)))}
            maxLength={600}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <span className="mt-0.5 block text-right text-[12px] text-muted">{body.length} / 600</span>
        </label>

        {error && <ErrorNote message={error} />}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button className="btn-ghost min-h-[44px]" disabled={busy} onClick={() => void dismiss()}>
            Not needed
          </button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="btn-secondary min-h-[44px]" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary min-h-[44px] px-6 text-[15px]"
              disabled={busy || !body.trim() || (needsNumber && !phone.trim())}
              onClick={() => void send()}
            >
              {busy && <Spinner className="h-4 w-4" />}
              Send text
            </button>
          </div>
        </div>
        {other && index === 0 && (
          <p className="text-[12px] text-muted">Prefer the other way? Pick “{other.label}” above.</p>
        )}
      </div>
    </Modal>
  );
}

/** "You've sent 3 of these. Want me to just do them?" */
export function AutopilotOffer({
  kind,
  count,
  onDone,
}: {
  kind: PreparedAction["kind"];
  count: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const words = KIND_WORDS[kind];
  return (
    <div className="mt-5 rounded-2xl bg-accent-soft/60 p-4">
      <p className="text-[15px] font-semibold">
        You&apos;ve sent {count} {words.many} yourself. Want me to send them for you from now on?
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink/80">
        {words.detail} Only between 9am and 7pm, Monday to Saturday. You can turn it off any time in Settings.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          className="btn-primary min-h-[44px]"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.put("/intel/actions/autopilot", { kind, on: true });
              toast({ message: `I'll send ${words.many} for you` });
              onDone();
            } catch {
              toast({ message: failMessage(), tone: "error" });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner className="h-4 w-4" />}
          Yes, do these for me
        </button>
        <button className="btn-secondary min-h-[44px]" onClick={onDone}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** "Mike was asked to call · 10:02" (and the customer's answer, if any). */
export function handledText(a: PreparedAction): string {
  const who = a.to_name ?? a.to_phone_pretty;
  const verb =
    a.kind === "remind_rep" ? `${who} was asked to call` : a.kind === "coach_rep" ? `${who} got the tip` : `Texted ${who}`;
  const by = a.auto ? " by autopilot" : "";
  const at = a.done_at ? ` · ${new Date(a.done_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "";
  return `${verb}${by}${at}`;
}
