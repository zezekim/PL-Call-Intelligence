"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { clock, date } from "@/lib/format";
import { CALL_TYPE_PLAIN, GRADE_PLAIN, OUTCOME_PLAIN } from "@/lib/easy";
import { useApi, useTitle } from "@/lib/hooks";
import type { RepBrief, Status, StepStat } from "@/lib/v2";
import { STATUS_TEXT, personName, rateStatus } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { BackIcon, CheckIcon, ChevronIcon, CrossIcon, PlayIcon } from "@/components/icons";
import { ApiError, api } from "@/lib/api";
import { Avatar, Card, Spinner } from "@/components/ui";
import { personLabel } from "@/components/v2/customer";
import { failMessage, useToast } from "@/components/v2/toast";
import { Meter, PageError, PersonSkeleton, StatusPill, Trend } from "@/components/v2/kit";
import type { Grade } from "@/lib/api";

const PERSON_WORD: Record<Status, string> = { good: "Doing well", watch: "Okay", bad: "Needs help", none: "Too early to tell" };
/** A share of the call's steps in words, not a percentage. */
const share = (pct: number) => (pct >= 85 ? "almost all" : pct >= 65 ? "most" : pct >= 45 ? "about half" : pct >= 25 ? "less than half" : "very little");

export default function RepPage() {
  const { id } = useParams<{ id: string }>();
  const { query, refreshKey } = useCalls();
  const { data: rep, error, status, loading, reload } = useApi<RepBrief>(query(`/intel/v2/reps/${id}`));
  useTitle(rep?.name ?? "Team");
  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !rep) return <PersonSkeleton />;
  if (error && !rep) {
    return (
      <PageError status={status} thing="person" onRetry={() => void reload()} back={{ href: "/v2/reps", label: "Back to Team" }} />
    );
  }
  if (!rep) return null;

  return (
    <div className="space-y-6">
      <Link href="/v2/reps" className="-ml-1 inline-flex min-h-[44px] items-center gap-0.5 text-[16px] text-link hover:underline">
        <BackIcon className="h-4 w-4" /> Back to your team
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <Avatar name={rep.name} size={52} />
            <div className="min-w-0">
              <h1 className="text-[28px] font-semibold leading-tight tracking-title">{personLabel(rep.name)}</h1>
              <p className="mt-2 max-w-2xl text-[17px] leading-relaxed">{rep.verdict}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className={`text-[28px] font-semibold leading-none tracking-title ${STATUS_TEXT[rep.status]}`}>
              {rep.score === null ? "Too early to tell" : PERSON_WORD[rep.status]}
            </p>
            {rep.score !== null && <p className="mt-1.5 text-[16px] text-ink/80">Does {share(rep.score)} of what a good call needs</p>}
            <div className="mt-2 flex justify-end">
              <Trend trend={rep.trend} />
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4 text-[16px]">
          <Fact label="Calls checked" value={String(rep.scored)} />
          <Fact label="Good calls" value={`${rep.meeting_standard} of ${rep.scored}`} />
          <Fact
            label="New callers who said yes"
            value={rep.decided ? `${rep.sold} of ${rep.decided}` : "–"}
            hint={rep.decided ? undefined : "No new callers yet"}
          />
        </div>
      </Card>

      {/* One step to teach, why, and the words to use: the same shape as Today. */}
      <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <Heading tone="bad" title="Teach next" />
          {rep.focus ? (
            <div className="mt-3">
              <p className="text-[20px] font-semibold leading-tight tracking-title">{rep.focus.plain}</p>
              <p className="mt-0.5 text-[16px] text-ink/80">{rep.focus.meaning}</p>
              <p className="mt-1 text-[16px] font-semibold text-bad">
                Skipped on {rep.focus.missed} of {rep.focus.of} calls
              </p>
              {rep.coach && (
                <div className="mt-4 rounded-2xl bg-panel p-4">
                  {rep.coach.what_happened && (
                    <p className="text-[16px] leading-relaxed text-ink/80">{rep.coach.what_happened}</p>
                  )}
                  <p className="mt-2 text-[16px] font-semibold">Next time, say this:</p>
                  <p className="mt-1 text-[16px] leading-relaxed">“{rep.coach.try_saying}”</p>
                  <Link
                    href={`/v2/calls/${rep.coach.call_id}${rep.coach.start !== null ? `?t=${Math.floor(rep.coach.start)}` : ""}`}
                    className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-[16px] font-medium text-link underline underline-offset-2"
                  >
                    <PlayIcon className="h-3 w-3" />
                    Hear that moment on the call with {personName(rep.coach.customer) ?? "a customer"}
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-[16px] text-muted">Nothing stands out to teach right now.</p>
          )}
          <TextMe rep={rep} onSaved={reload} />
        </Card>

        <Card className="p-5">
          <Heading tone="good" title="Good at" />
          {rep.strengths.length ? (
            <ul className="mt-3 space-y-3">
              {rep.strengths.map((s) => (
                <StepLine key={s.step} step={s} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[16px] text-muted">No step is done well every time yet.</p>
          )}
          {rep.strength_example && (
            <Link
              href={`/v2/calls/${rep.strength_example.call_id}${rep.strength_example.start !== null ? `?t=${Math.floor(rep.strength_example.start)}` : ""}`}
              className="mt-4 block rounded-2xl bg-good-soft p-4 transition hover:brightness-[0.98]"
            >
              <p className="text-[16px] font-medium">{rep.strength_example.title}</p>
              {rep.strength_example.quote && (
                <p className="mt-1 text-[16px] leading-relaxed">“{rep.strength_example.quote}”</p>
              )}
              <p className="mt-2 inline-flex items-center gap-1 text-[15px] text-link">
                <PlayIcon className="h-2.5 w-2.5" /> Hear it
                {rep.strength_example.start !== null && ` at ${clock(rep.strength_example.start)}`}
              </p>
            </Link>
          )}
        </Card>

      </div>

      <RecentCalls rep={rep} />
      <AllSteps steps={rep.steps} />
    </div>
  );
}

/** Their mobile: for their weekly tip, and for call-back requests from Today. */
function TextMe({ rep, onSaved }: { rep: RepBrief; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [editing, setEditing] = useState(!rep.phone);
  const [value, setValue] = useState(rep.phone_pretty ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = rep.name.split(/\s+/)[0];
  if (/receptionist/i.test(rep.name)) return null;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/intel/reps/${rep.id}/phone`, { phone: value });
      toast({ message: value.trim() ? `Saved. ${first} will get their tip by text.` : "Number removed" });
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? err.message : failMessage());
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-5 border-t border-line pt-4 text-[16px]">
      <p className="font-medium">Send {first} this tip by text</p>
      <p className="mt-0.5 text-ink/80">
        Every Monday, {first} gets the one thing to work on, the words to say, and a link to hear it on their own call.
        Today can also ask {first} to call customers back.
      </p>
      {editing ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className="input min-h-[44px] flex-1"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Mobile number, e.g. (555) 123-4567"
            aria-label={`${first}'s mobile number`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button className="btn-primary min-h-[44px]" disabled={busy || (!value.trim() && !rep.phone)} onClick={() => void save()}>
            {busy && <Spinner className="h-4 w-4" />}
            Save
          </button>
        </div>
      ) : (
        <p className="mt-2">
          Texts go to <span className="font-medium">{rep.phone_pretty}</span>.{" "}
          <button className="text-link underline underline-offset-2" onClick={() => setEditing(true)}>
            Change
          </button>
        </p>
      )}
      {error && <p className="mt-2 text-[15px] text-bad">{error}</p>}
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[15px] text-muted">{label}</p>
      <p className="tnum mt-0.5 text-[18px] font-semibold">{value}</p>
      {hint && <p className="text-[15px] text-muted">{hint}</p>}
    </div>
  );
}

function Heading({ tone, title }: { tone: "good" | "bad"; title: string }) {
  const cls = { good: "bg-good", bad: "bg-bad" }[tone];
  const Icon = tone === "good" ? CheckIcon : CrossIcon;
  return (
    <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-title">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-white ${cls}`}>
        <Icon className="h-3 w-3" />
      </span>
      {title}
    </h2>
  );
}

function StepLine({ step }: { step: StepStat }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-[16px]">
        <span className="font-medium">{step.plain}</span>
        <span className="tnum text-muted">
          done on {step.met} of {step.of}
        </span>
      </div>
      <div className="mt-1.5">
        <Meter value={step.hit_rate} status={rateStatus(step.hit_rate)} label={step.plain} />
      </div>
    </li>
  );
}

function RecentCalls({ rep }: { rep: RepBrief }) {
  const calls = rep.calls_list.slice(0, 5);
  if (!calls.length) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="text-[19px] font-semibold tracking-title">Recent calls</h2>
        {rep.calls_list.length > calls.length && (
          <Link href={`/v2/calls?rep=${rep.id}&who=${encodeURIComponent(rep.name)}`} className="text-[15px] font-medium text-link hover:underline">
            See all {rep.calls_list.length}
          </Link>
        )}
      </div>
      <ul className="group-list">
        {calls.map((c) => (
          <li key={c.call_id}>
            <Link href={`/v2/calls/${c.call_id}`} className="flex items-center gap-4 px-5 py-3 text-[16px] transition-colors hover:bg-surface-hover">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{personName(c.customer) ?? "Caller with no name"}</span>
                <span className="text-muted">
                  {" "}
                  · {CALL_TYPE_PLAIN[c.call_type] ?? c.call_type} · {date(c.when)}
                  {c.outcome && c.outcome !== "not_applicable" && ` · ${OUTCOME_PLAIN[c.outcome] ?? c.outcome}`}
                </span>
              </span>
              {c.grade && (
                <StatusPill
                  status={c.grade === "below" ? "bad" : "good"}
                  label={GRADE_PLAIN[c.grade as Grade]}
                />
              )}
              <ChevronIcon className="h-4 w-4 text-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AllSteps({ steps }: { steps: StepStat[] }) {
  // The detail behind the three cards above: there when wanted.
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <section>
      <button className="flex min-h-[44px] w-full items-center justify-between px-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          <span className="text-[19px] font-semibold tracking-title">Every step</span>
          <span className="ml-2 text-[16px] text-ink/70">Each part of a good call, and how often {"it's"} done.</span>
        </span>
        <ChevronIcon className={`h-4 w-4 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <Card className="mt-3 p-5">
          <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {steps.map((s) => (
              <StepLine key={s.step} step={s} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
