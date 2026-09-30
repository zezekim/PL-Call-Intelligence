"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { plural } from "@/lib/easy";
import { useApi, useTitle } from "@/lib/hooks";
import type { Brief, PerformanceCard, Todo } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { ErrorNote, Loading } from "@/components/ui";
import { BigLink, GoalBar, Panel, Reveal, Section, StatusBadge, StatusIcon, easyLink } from "@/components/v2/kit";

export default function TodayV2() {
  useTitle("Today");
  const { query, refreshKey } = useCalls();
  const { data, error, loading, reload } = useApi<Brief>(query("/intel/v2/brief"));

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;
  if (!data.calls.analyzed) {
    return (
      <Panel>
        <p className="text-[24px] font-bold">No calls yet</p>
        <p className="mt-2 text-[18px] text-ink/80">
          Press “Add call recordings” at the top of the page. We will listen to each call and fill in this page.
        </p>
      </Panel>
    );
  }

  const [sales, retention, service] = data.cards;

  return (
    <div className="space-y-12">
      <Message brief={data} />

      <Section title="How things are going" intro="Three questions about your customers. Each one has a goal.">
        <div className="space-y-4">
          {[sales, retention, service].map((c) => (
            <Question key={c.key} card={c} />
          ))}
        </div>
      </Section>

      <DoFirst items={data.todo} />
      <Teach brief={data} />
      <Footer brief={data} />
    </div>
  );
}

function Message({ brief }: { brief: Brief }) {
  const { status, title, detail } = brief.headline;
  const bg = { good: "bg-good-soft", watch: "bg-warn-soft", bad: "bg-bad-soft", none: "bg-panel" }[status];
  return (
    <div className={`flex gap-5 rounded-[22px] px-7 py-6 ${bg}`} role="status">
      <StatusIcon status={status} size={40} />
      <div className="min-w-0">
        <p className="text-[16px] font-semibold uppercase tracking-wide text-ink/80">The most important thing</p>
        <p className="mt-1 text-[28px] font-bold leading-snug tracking-title">{title}</p>
        {detail && <p className="mt-3 max-w-3xl text-[20px] leading-relaxed">{detail}</p>}
      </div>
    </div>
  );
}

function Question({ card }: { card: PerformanceCard }) {
  const none = !card.of;
  return (
    <Panel>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
        <div>
          <StatusBadge status={none ? "none" : card.status} />
          <h3 className="mt-3 text-[26px] font-bold leading-tight tracking-title">{card.label}</h3>
          <p className="mt-1 text-[20px] text-ink/80">{card.question}</p>
        </div>
        <div>
          {none ? (
            <p className="text-[20px] text-ink/80">{card.detail}.</p>
          ) : (
            <>
              <p className="text-[36px] font-bold leading-none tracking-title">
                {card.count} out of {card.of}{" "}
                <span className="text-[22px] font-semibold text-ink/80">{card.metric_label.toLowerCase()}</span>
              </p>
              <div className="mt-4">
                <GoalBar value={card.value} goal={card.target} status={card.status} />
              </div>
              <p className="text-[17px] text-ink/80">{card.goal}.</p>
            </>
          )}
        </div>
      </div>
      {!none && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t-2 border-line pt-5">
          <p className="text-[20px] leading-relaxed">{card.why}</p>
          {card.action && (
            <BigLink href={card.action.href} kind="secondary">
              {card.action.label} →
            </BigLink>
          )}
        </div>
      )}
    </Panel>
  );
}

const FIRST = 3;

function DoFirst({ items }: { items: Todo[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <Section title="Do these first" intro={items.length ? "The most important one is at the top." : undefined}>
      {items.length === 0 ? (
        <Panel className="flex items-center gap-4">
          <StatusIcon status="good" size={32} />
          <p className="text-[22px] font-semibold">Nothing needs you right now.</p>
        </Panel>
      ) : (
        <>
          <ol className="space-y-3">
            {shown.map((t, i) => (
              <li key={`${t.title}-${i}`}>
                <Panel className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span
                    aria-hidden
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[22px] font-bold ${
                      i === 0 ? "bg-[#a3001a] text-white" : "bg-fill text-ink"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[22px] font-bold leading-snug">
                      <span className="sr-only">Number {i + 1}: </span>
                      {t.title}
                    </p>
                    <p className="mt-1 text-[18px] leading-relaxed text-ink/80">{t.why}</p>
                  </div>
                  <BigLink href={t.href} kind={i === 0 ? "primary" : "secondary"} className="shrink-0">
                    {t.cta} →
                  </BigLink>
                </Panel>
              </li>
            ))}
          </ol>
          {items.length > FIRST && (
            <div className="mt-4">
              <Reveal
                open={all}
                onToggle={() => setAll((a) => !a)}
                more={`Show ${plural(items.length - FIRST, "more thing")} to do`}
              />
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function Teach({ brief }: { brief: Brief }) {
  const c = brief.coaching;
  const quality = brief.cards[3];
  if (!c) return null;
  const tip = c.tip;
  return (
    <Section
      title="What to teach the team this week"
      intro={
        quality.of
          ? `Each call has 12 to 17 steps to follow. Right now the team does about ${Math.round(
              (quality.value ?? 0) / 10,
            )} out of 10 of them.`
          : undefined
      }
    >
      <Panel>
        <p className="text-[18px] font-semibold text-ink/80">Practise this step</p>
        <p className="mt-1 text-[32px] font-bold leading-tight tracking-title">{c.focus.plain}</p>
        <p className="mt-2 text-[20px] leading-relaxed">{c.focus.meaning}</p>
        <p className="mt-3 inline-flex items-center gap-2 text-[20px] font-semibold">
          <StatusIcon status="bad" size={22} />
          Skipped on {c.focus.missed} of {c.focus.of} calls
        </p>

        {tip && (
          <div className="mt-6 rounded-[18px] bg-panel p-6">
            <p className="text-[18px] font-semibold text-ink/80">Teach them to say something like:</p>
            <p className="mt-2 text-[22px] leading-relaxed">“{tip.try_saying}”</p>
            <div className="mt-5">
              <BigLink
                href={`/v2/calls/${tip.call_id}${tip.start !== null ? `?t=${Math.floor(tip.start)}` : ""}`}
                kind="secondary"
              >
                ▶ Hear the moment on a real call
              </BigLink>
            </div>
          </div>
        )}

        {c.reps.length > 0 && (
          <p className="mt-6 text-[20px] leading-relaxed">
            <span className="font-semibold">Start with: </span>
            {c.reps
              .slice(0, 3)
              .map((r) => r.rep)
              .join(", ")}
            .
          </p>
        )}
        {c.strength && (
          <p className="mt-4 flex items-start gap-3 border-t-2 border-line pt-5 text-[20px] leading-relaxed">
            <StatusIcon status="good" size={24} />
            <span>
              <span className="font-semibold">The team is good at: </span>
              {c.strength.plain} (done on {c.strength.met} of {c.strength.of} calls).
            </span>
          </p>
        )}
      </Panel>
    </Section>
  );
}

function Footer({ brief }: { brief: Brief }) {
  const links: { href: string; text: string }[] = [];
  if (brief.review.disputed_calls)
    links.push({
      href: "/v2/calls?disputed=1",
      text: `${plural(brief.review.disputed_calls, "call needs", "calls need")} your decision`,
    });
  if (brief.review.type_checks)
    links.push({
      href: "/v2/calls?review=1",
      text: `${plural(brief.review.type_checks, "call")} may be the wrong type`,
    });
  if (brief.calls.failed)
    links.push({ href: "/v2/calls?status=failed", text: `${plural(brief.calls.failed, "recording")} could not be read` });
  return (
    <div className="space-y-2 border-t-2 border-line pt-6 text-[18px]">
      <p>
        We listened to <span className="font-semibold">{plural(brief.calls.analyzed, "call")}</span>
        {brief.calls.processing ? ` and are still working on ${brief.calls.processing}` : ""}.
      </p>
      {links.map((l) => (
        <p key={l.href}>
          <Link href={l.href} className={easyLink}>
            {l.text} →
          </Link>
        </p>
      ))}
      {brief.receptionist_number && (
        <p>
          Try the AI receptionist: call{" "}
          <a className={easyLink} href={`tel:${brief.receptionist_number}`}>
            {brief.receptionist_number}
          </a>
        </p>
      )}
    </div>
  );
}
