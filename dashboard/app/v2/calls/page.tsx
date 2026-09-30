"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, type CallPage, type CallRow } from "@/lib/api";
import { CALL_TYPES, GRADE_LABEL, OUTCOME_LABEL, OUTCOME_TONE, date, duration } from "@/lib/format";
import { IN_PROGRESS, useApi, useTitle } from "@/lib/hooks";
import type { Status } from "@/lib/v2";
import { useCalls } from "@/components/calls-context";
import { ChevronIcon, SearchIcon } from "@/components/icons";
import { Avatar, Card, Empty, ErrorNote, Loading, Spinner } from "@/components/ui";
import { StatusPill } from "@/components/v2/kit";

const PAGE = 50;
const FILTERS = [
  { key: "", label: "All" },
  { key: "below", label: "Below standard" },
  { key: "disputed", label: "Your call" },
  { key: "review", label: "Check type" },
];
const OUTCOME_STATUS: Record<string, Status> = { good: "good", warn: "watch", bad: "bad", none: "none" };

export default function CallsV2() {
  return (
    <Suspense fallback={<Loading />}>
      <Calls />
    </Suspense>
  );
}

function Calls() {
  useTitle("Calls");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { refreshKey } = useCalls();
  const [search, setSearch] = useState(params.get("q") ?? "");
  useEffect(() => setSearch(params.get("q") ?? ""), [params]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  };
  const filter = params.get("grade") === "below" ? "below" : params.get("disputed") ? "disputed" : params.get("review") ? "review" : "";
  const setFilter = (key: string) => {
    const next = new URLSearchParams(params.toString());
    ["grade", "disputed", "review"].forEach((k) => next.delete(k));
    if (key === "below") next.set("grade", "below");
    if (key === "disputed") next.set("disputed", "1");
    if (key === "review") next.set("review", "1");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[220px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            set("q", search.trim());
          }}
        >
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted" />
          <input
            className="input rounded-full pl-9"
            placeholder="Search customer, rep or what was said"
            aria-label="Search calls"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        <select
          className="select w-auto rounded-full"
          value={params.get("type") ?? ""}
          onChange={(e) => set("type", e.target.value)}
          aria-label="Call type"
        >
          <option value="">All call types</option>
          {CALL_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
              filter === f.key ? "bg-ink text-canvas" : "bg-fill text-ink hover:bg-fill-hover"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorNote message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !items.length ? (
        <Card>
          <Empty title="No calls match">Try another filter.</Empty>
        </Card>
      ) : (
        <>
          <ul className="group-list">
            {items.map((c) => (
              <Row key={c.id} call={c} />
            ))}
          </ul>
          <div className="flex items-center justify-between px-1 text-[13px] text-muted">
            <span>
              {items.length} of {data?.total} calls
            </span>
            {items.length < (data?.total ?? 0) && (
              <button
                className="btn-secondary px-3 py-1 text-[13px]"
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
                {loadingMore && <Spinner className="h-3 w-3" />}
                Show more
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ call: c }: { call: CallRow }) {
  const busy = IN_PROGRESS.has(c.processing_status);
  const failed = c.processing_status === "failed";
  const tone = c.outcome ? OUTCOME_TONE[c.outcome] ?? "none" : "none";
  return (
    <li>
      <Link href={`/v2/calls/${c.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-hover">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{c.customer_name ?? c.external_ref ?? c.original_filename}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            <span>{c.call_type_label ?? "Call"}</span>
            {c.rep_name && (
              <span className="inline-flex items-center gap-1">
                · <Avatar name={c.rep_name} size={14} /> {c.rep_name}
              </span>
            )}
            <span>· {date(c.occurred_at ?? c.created_at)}</span>
            <span>· {duration(c.duration_seconds)}</span>
          </p>
        </div>
        <div className="hidden w-32 sm:block">
          {c.outcome && c.outcome !== "not_applicable" && (
            <StatusPill status={OUTCOME_STATUS[tone]} label={OUTCOME_LABEL[c.outcome] ?? c.outcome} />
          )}
        </div>
        <div className="w-40 text-right">
          {busy ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              <Spinner className="h-3 w-3" /> Processing
            </span>
          ) : failed ? (
            <span className="text-[13px] font-medium text-bad">Failed</span>
          ) : c.score !== null && c.score_max ? (
            <span className="inline-flex items-center gap-2">
              <span className="tnum text-[14px] font-medium">
                {c.score}/{c.score_max}
              </span>
              <StatusPill status={c.grade === "below" ? "bad" : "good"} label={c.grade ? GRADE_LABEL[c.grade] : "–"} />
            </span>
          ) : (
            <span className="text-[13px] text-muted">Not scored</span>
          )}
          {(c.disputed_steps > 0 || c.needs_review) && (
            <span className="mt-0.5 block text-[12px] text-warn">
              {c.disputed_steps > 0 ? "Your call on a step" : "Check type"}
            </span>
          )}
        </div>
        <ChevronIcon className="h-4 w-4 shrink-0 text-faint" />
      </Link>
    </li>
  );
}
