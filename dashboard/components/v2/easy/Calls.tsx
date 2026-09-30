"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, type CallPage, type CallRow } from "@/lib/api";
import { CALL_TYPE_PLAIN, GRADE_PLAIN, OUTCOME_PLAIN, OUTCOME_STATUS, plural, spokenLength } from "@/lib/easy";
import { date } from "@/lib/format";
import { IN_PROGRESS, useApi, useTitle } from "@/lib/hooks";
import { useCalls } from "@/components/calls-context";
import { ErrorNote, Loading, Spinner } from "@/components/ui";
import { Panel, StatusBadge, bigButton } from "@/components/v2/kit";

const PAGE = 20;
const FILTERS = [
  { key: "", label: "All calls" },
  { key: "below", label: "Calls that need work" },
  { key: "disputed", label: "Calls that need your decision" },
  { key: "review", label: "Calls that may be the wrong type" },
];

export function CallsEasy() {
  return (
    <Suspense fallback={<Loading />}>
      <AllCalls />
    </Suspense>
  );
}

function AllCalls() {
  useTitle("All calls");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { refreshKey } = useCalls();
  const [search, setSearch] = useState(params.get("q") ?? "");
  useEffect(() => setSearch(params.get("q") ?? ""), [params]);

  const go = (next: URLSearchParams) => router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  const filter = params.get("grade") === "below" ? "below" : params.get("disputed") ? "disputed" : params.get("review") ? "review" : "";
  const setFilter = (key: string) => {
    const next = new URLSearchParams(params.toString());
    ["grade", "disputed", "review", "status"].forEach((k) => next.delete(k));
    if (key === "below") next.set("grade", "below");
    if (key === "disputed") next.set("disputed", "1");
    if (key === "review") next.set("review", "1");
    go(next);
  };

  const q = new URLSearchParams();
  if (params.get("q")) q.set("q", params.get("q")!);
  if (params.get("type")) q.set("call_type", params.get("type")!);
  if (params.get("grade")) q.set("grade", params.get("grade")!);
  if (params.get("status")) q.set("status", params.get("status")!);
  if (params.get("disputed")) q.set("disputed", "true");
  if (params.get("review")) q.set("review", "true");
  q.set("limit", String(PAGE));
  const qs = q.toString();

  const { data, error, loading, reload } = useApi<CallPage>(`/intel/calls?${qs}`, {
    poll: (d) => d.items.some((c) => IN_PROGRESS.has(c.processing_status)),
  });
  const [more, setMore] = useState<CallRow[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => setMore([]), [qs]);
  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);
  const items = data ? [...data.items, ...more.filter((m) => !data.items.some((c) => c.id === m.id))] : [];

  return (
    <div className="space-y-6">
      <Panel className="space-y-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = new URLSearchParams(params.toString());
            if (search.trim()) next.set("q", search.trim());
            else next.delete("q");
            go(next);
          }}
        >
          <label htmlFor="find" className="block text-[20px] font-semibold">
            Find a call
          </label>
          <p className="text-[17px] text-ink/80">Type a customer&apos;s name, a team member&apos;s name, or words that were said.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              id="find"
              className="min-h-[52px] min-w-[240px] flex-1 rounded-[14px] border-2 border-line bg-surface px-4 text-[20px] focus:border-accent focus:outline-none focus:ring-[4px] focus:ring-accent/30"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className={bigButton.primary} type="submit">
              Find
            </button>
            {params.get("q") && (
              <button
                className={bigButton.secondary}
                type="button"
                onClick={() => {
                  setSearch("");
                  const next = new URLSearchParams(params.toString());
                  next.delete("q");
                  go(next);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </form>

        <div>
          <p className="text-[20px] font-semibold">Show</p>
          <div className="mt-3 flex flex-wrap gap-3" role="radiogroup" aria-label="Which calls to show">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`inline-flex min-h-[52px] items-center gap-2 rounded-full border-2 px-5 text-[18px] font-semibold transition-colors ${
                  filter === f.key ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink hover:border-ink/40"
                }`}
              >
                <span aria-hidden>{filter === f.key ? "●" : "○"}</span>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {error && <ErrorNote message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !items.length ? (
        <Panel>
          <p className="text-[22px] font-semibold">No calls found.</p>
          <p className="mt-1 text-[18px] text-ink/80">Try “All calls”, or clear the search.</p>
        </Panel>
      ) : (
        <>
          <p className="text-[20px]">
            Showing {items.length} of {plural(data?.total ?? 0, "call")}. The newest are at the top.
          </p>
          <ul className="space-y-3">
            {items.map((c) => (
              <Row key={c.id} call={c} />
            ))}
          </ul>
          {items.length < (data?.total ?? 0) && (
            <button
              className={bigButton.secondary}
              disabled={loadingMore}
              onClick={async () => {
                setLoadingMore(true);
                try {
                  const next = new URLSearchParams(qs);
                  next.set("offset", String(items.length));
                  const page = await api.get<CallPage>(`/intel/calls?${next}`);
                  setMore((m) => [...m, ...page.items]);
                } finally {
                  setLoadingMore(false);
                }
              }}
            >
              {loadingMore && <Spinner className="h-4 w-4" />}
              Show more calls
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Row({ call: c }: { call: CallRow }) {
  const busy = IN_PROGRESS.has(c.processing_status);
  const failed = c.processing_status === "failed";
  const outcome = c.outcome && OUTCOME_PLAIN[c.outcome];
  return (
    <li>
      <Link href={`/v2/calls/${c.id}`} className="block rounded-[22px] focus-visible:ring-[4px] focus-visible:ring-accent/50">
        <Panel className="transition-colors hover:border-accent">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[22px] font-bold leading-snug">{c.customer_name ?? "Customer not named"}</p>
              <p className="mt-1 text-[18px] text-ink/80">
                {CALL_TYPE_PLAIN[c.call_type ?? ""] ?? "Call"}
                {c.rep_name ? ` · answered by ${c.rep_name}` : ""} · {date(c.occurred_at ?? c.created_at)} ·{" "}
                {spokenLength(c.duration_seconds)}
              </p>
            </div>
            <span aria-hidden className="text-[26px] text-ink/60">→</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {busy ? (
              <span className="inline-flex items-center gap-2 text-[18px] font-semibold">
                <Spinner className="h-4 w-4" /> Still listening to this call…
              </span>
            ) : failed ? (
              <StatusBadge status="bad" label="Could not read this recording" />
            ) : (
              <>
                {outcome && <StatusBadge status={OUTCOME_STATUS[c.outcome!] ?? "none"} label={outcome} />}
                {c.grade && (
                  <StatusBadge
                    status={c.grade === "below" ? "bad" : "good"}
                    label={`Call steps: ${GRADE_PLAIN[c.grade].toLowerCase()} (${c.score} of ${c.score_max})`}
                  />
                )}
                {c.disputed_steps > 0 && <StatusBadge status="watch" label="Needs your decision" />}
                {c.needs_review && <StatusBadge status="watch" label="May be the wrong type" />}
              </>
            )}
          </div>
        </Panel>
      </Link>
    </li>
  );
}
