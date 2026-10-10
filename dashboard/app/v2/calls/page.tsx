"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, type CallPage, type CallRow } from "@/lib/api";
import { CALL_TYPES, OUTCOME_TONE, date } from "@/lib/format";
import { CALL_TYPE_PLAIN, GRADE_PLAIN, OUTCOME_PLAIN, spokenMinutes } from "@/lib/easy";
import { IN_PROGRESS, useApi, useTitle } from "@/lib/hooks";
import type { Status } from "@/lib/v2";
import { personName } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { repWords } from "@/components/v2/customer";
import { ChevronIcon, CrossIcon, SearchIcon } from "@/components/icons";
import { Card, Empty, Spinner } from "@/components/ui";
import { ListSkeleton, PageError, StatusPill } from "@/components/v2/kit";
import { failMessage, useToast } from "@/components/v2/toast";

const PAGE = 50;
const FILTERS = [
  { key: "", label: "All calls" },
  { key: "below", label: "Need work" },
  { key: "disputed", label: "Need your decision" },
  { key: "review", label: "Might be the wrong kind" },
];
// Linked from Today's footer; only offered while it is the one being shown.
const FAILED = { key: "failed", label: "Could not read" };
const OUTCOME_STATUS: Record<string, Status> = { good: "good", warn: "watch", bad: "bad", none: "none" };
// Pages loaded with "Show more", kept per search so Back returns to the same list.
const extraPages = new Map<string, CallRow[]>();

export default function CallsPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <Calls />
    </Suspense>
  );
}

function Calls() {
  useTitle("All calls");
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { refreshKey, query } = useCalls();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setSearch(params.get("q") ?? "");
  }, [params]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  };
  const filter =
    params.get("grade") === "below"
      ? "below"
      : params.get("disputed")
        ? "disputed"
        : params.get("review")
          ? "review"
          : params.get("status") === "failed"
            ? "failed"
            : "";
  const filters = filter === "failed" ? [...FILTERS, FAILED] : FILTERS;
  const setFilter = (key: string) => {
    const next = new URLSearchParams(params.toString());
    ["grade", "disputed", "review", "status"].forEach((k) => next.delete(k));
    if (key === "below") next.set("grade", "below");
    if (key === "disputed") next.set("disputed", "1");
    if (key === "review") next.set("review", "1");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  };

  const q = new URLSearchParams();
  if (params.get("q")) q.set("q", params.get("q")!);
  if (params.get("type")) q.set("call_type", params.get("type")!);
  if (params.get("rep")) q.set("rep_id", params.get("rep")!);
  if (params.get("grade")) q.set("grade", params.get("grade")!);
  if (params.get("status")) q.set("status", params.get("status")!);
  if (params.get("disputed")) q.set("disputed", "true");
  if (params.get("review")) q.set("review", "true");
  q.set("limit", String(PAGE));
  // The period picker above applies here as on every other tab.
  const qs = query(`/intel/calls?${q}`).split("?")[1];

  // Results follow the typing, a moment after it pauses.
  useEffect(() => {
    if (!typed.current) return;
    const timer = window.setTimeout(() => {
      typed.current = false;
      if (search.trim() !== (params.get("q") ?? "")) set("q", search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { data, error, status, loading, reload } = useApi<CallPage>(`/intel/calls?${qs}`, {
    poll: (d) => d.items.some((c) => IN_PROGRESS.has(c.processing_status)),
  });
  const [more, setMoreState] = useState<CallRow[]>(() => extraPages.get(qs) ?? []);
  const setMore = (rows: CallRow[]) => {
    extraPages.set(qs, rows);
    setMoreState(rows);
  };
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => setMoreState(extraPages.get(qs) ?? []), [qs]);
  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);
  const items = data ? [...data.items, ...more.filter((m) => !data.items.some((c) => c.id === m.id))] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[220px] flex-1"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            typed.current = false;
            set("q", search.trim());
          }}
        >
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted" />
          <input
            type="search"
            className="input rounded-full pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
            placeholder="Search names or words said"
            aria-label="Search calls by customer, team member or words said"
            value={search}
            onChange={(e) => {
              typed.current = true;
              setSearch(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search) {
                typed.current = false;
                setSearch("");
                set("q", "");
              }
            }}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                typed.current = false;
                setSearch("");
                set("q", "");
              }}
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-[16px] font-bold text-ink/60 hover:bg-fill"
            >
              ✕
            </button>
          )}
        </form>
        <select
          className="select w-auto rounded-full"
          value={params.get("type") ?? ""}
          onChange={(e) => set("type", e.target.value)}
          aria-label="Call type"
        >
          <option value="">Every kind of call</option>
          {CALL_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {CALL_TYPE_PLAIN[t.value] ?? t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
        {params.get("rep") && (
          <button
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              next.delete("rep");
              next.delete("who");
              router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
            }}
            aria-label="Show everyone's calls"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-ink px-4 text-[16px] font-medium text-canvas"
          >
            Only {params.get("who") || "one person"}
            <CrossIcon className="h-2.5 w-2.5" />
          </button>
        )}
        {filters.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`min-h-[44px] rounded-full px-4 text-[16px] font-medium transition-colors ${
              filter === f.key ? "bg-ink text-canvas" : "bg-fill text-ink hover:bg-fill-hover"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <ListSkeleton />
      ) : error && !data ? (
        <PageError status={status} onRetry={() => void reload()} />
      ) : !items.length ? (
        <Card>
          <Empty title="No calls found">
            {params.get("q") ? `Nothing matches “${params.get("q")}”.` : "Nothing here right now."}{" "}
            {(params.toString() !== "") && (
              <button
                className="text-link hover:underline"
                onClick={() => {
                  typed.current = false;
                  setSearch("");
                  router.replace(pathname);
                }}
              >
                Show all calls
              </button>
            )}
          </Empty>
        </Card>
      ) : (
        <>
          <ul className="group-list">
            {items.map((c) => (
              <Row key={c.id} call={c} />
            ))}
          </ul>
          <div className="flex items-center justify-between px-1 text-[16px] text-ink/70">
            <span>
              {items.length === data?.total ? `Showing all ${items.length} call${items.length === 1 ? "" : "s"}` : `Showing ${items.length} of ${data?.total} calls`}
            </span>
            {items.length < (data?.total ?? 0) && (
              <button
                className="btn-secondary"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  try {
                    const next = new URLSearchParams(qs);
                    next.set("offset", String(items.length));
                    const page = await api.get<CallPage>(`/intel/calls?${next}`);
                    setMore([...more, ...page.items]);
                  } catch {
                    toast({ message: failMessage(), tone: "error" });
                  } finally {
                    setLoadingMore(false);
                  }
                }}
              >
                {loadingMore && <Spinner className="h-3 w-3" />}
                Show more calls
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// How the call was handled, said about the call (the pill beside it says how it ended).
const HANDLED: Record<string, string> = { gold: "Great call", green: "Good call", below: "Call needs work" };

function Row({ call: c }: { call: CallRow }) {
  const busy = IN_PROGRESS.has(c.processing_status);
  const failed = c.processing_status === "failed";
  const tone = c.outcome ? OUTCOME_TONE[c.outcome] ?? "none" : "none";
  const meta = [
    CALL_TYPE_PLAIN[c.call_type ?? ""] ?? "Call",
    c.rep_name ? `with ${repWords(c.rep_name)}` : null,
    date(c.occurred_at ?? c.created_at),
    spokenMinutes(c.duration_seconds),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <Link href={`/v2/calls/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-hover hover:no-underline sm:gap-4 sm:px-5">
        <span
          className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-[17px] font-bold sm:flex ${
            tone === "good" ? "bg-good-soft text-good" : tone === "bad" ? "bg-bad-soft text-bad" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-fill text-ink/70"
          }`}
          aria-hidden
        >
          {(personName(c.customer_name) ?? "?")[0].toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold">{personName(c.customer_name) ?? "Caller with no name"}</p>
          <p className="mt-0.5 text-[16px] text-ink/70">{meta}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            {c.outcome && c.outcome !== "not_applicable" && (
              <StatusPill status={OUTCOME_STATUS[tone]} label={OUTCOME_PLAIN[c.outcome] ?? c.outcome} />
            )}
            {busy ? (
              <span className="inline-flex items-center gap-1.5 text-[16px] text-ink/70">
                <Spinner className="h-3.5 w-3.5" /> Still being checked
              </span>
            ) : failed ? (
              <span className="text-[16px] font-medium text-bad">Could not be read</span>
            ) : c.grade ? (
              <StatusPill status={c.grade === "below" ? "bad" : "good"} label={HANDLED[c.grade] ?? GRADE_PLAIN[c.grade]} />
            ) : null}
            {(c.disputed_steps > 0 || c.needs_review) && (
              <span className="text-[16px] font-medium text-warn">{c.disputed_steps > 0 ? "Needs your decision" : "Might be the wrong kind of call"}</span>
            )}
          </p>
        </div>
        <ChevronIcon className="h-4 w-4 shrink-0 text-faint" />
      </Link>
    </li>
  );
}
