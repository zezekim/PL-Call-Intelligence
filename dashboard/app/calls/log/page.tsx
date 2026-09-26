"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { CallPage, CallRow, RepSummary } from "@/lib/api";
import { CALL_TYPES, date, duration } from "@/lib/format";
import { IN_PROGRESS, useApi, useTitle } from "@/lib/hooks";
import { useCalls } from "@/components/calls-context";
import { startProgress } from "@/components/route-progress";
import { SearchIcon } from "@/components/icons";
import {
  Avatar,
  Card,
  Empty,
  ErrorNote,
  Loading,
  OutcomeText,
  ScoreCell,
  Spinner,
  TypeBadge,
} from "@/components/ui";

export default function CallLogPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CallLog />
    </Suspense>
  );
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  queued_analysis: "Queued",
  transcribing: "Transcribing",
  analyzing: "Scoring",
  failed: "Failed",
};

function CallLog() {
  useTitle("Call Log");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { refreshKey } = useCalls();
  const [search, setSearch] = useState(params.get("q") ?? "");

  useEffect(() => setSearch(params.get("q") ?? ""), [params]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  };

  const apiParams = new URLSearchParams();
  const map: Record<string, string> = {
    q: "q",
    type: "call_type",
    lens: "lens",
    rep: "rep_id",
    grade: "grade",
    status: "status",
    review: "review",
    source: "source",
  };
  Object.entries(map).forEach(([ui, key]) => {
    const v = params.get(ui);
    if (v) apiParams.set(key, ui === "review" ? "true" : v);
  });
  apiParams.set("limit", "200");

  const { data, error, loading, reload } = useApi<CallPage>(`/intel/calls?${apiParams}`, {
    poll: (d) => d.items.some((c) => IN_PROGRESS.has(c.processing_status)),
  });
  const reps = useApi<RepSummary[]>("/intel/reps");

  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);

  const activeFilters = ["type", "lens", "rep", "grade", "status", "review", "source", "q"].filter((k) =>
    params.get(k),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[200px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", search.trim());
          }}
        >
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted" />
          <input
            className="input rounded-full pl-9"
            placeholder="Search customer, rep, transcript or call ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => search.trim() !== (params.get("q") ?? "") && setParam("q", search.trim())}
          />
        </form>
        <select
          className="select w-auto rounded-full"
          value={params.get("type") ?? ""}
          onChange={(e) => setParam("type", e.target.value)}
          aria-label="Call type"
        >
          <option value="">All call types</option>
          {CALL_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          className="select w-auto rounded-full"
          value={params.get("rep") ?? ""}
          onChange={(e) => setParam("rep", e.target.value)}
          aria-label="Rep"
        >
          <option value="">All reps</option>
          {(reps.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          className="select w-auto rounded-full"
          value={params.get("grade") ?? ""}
          onChange={(e) => setParam("grade", e.target.value)}
          aria-label="Grade"
        >
          <option value="">All grades</option>
          <option value="gold">Gold</option>
          <option value="green">Green</option>
          <option value="below">Below standard</option>
        </select>
        {activeFilters.length > 0 && (
          <button className="btn-ghost" onClick={() => router.replace(pathname)}>
            Clear
          </button>
        )}
      </div>

      {params.get("lens") && (
        <p className="footnote px-1">
          Showing {params.get("lens")} calls{params.get("review") ? " that need a type check" : ""}.
        </p>
      )}
      {params.get("review") && !params.get("lens") && (
        <p className="footnote px-1">
          Showing calls whose type could not be determined confidently. Open one to confirm it.
        </p>
      )}

      {error && <ErrorNote message={error} />}

      <Card className="overflow-hidden">
        {loading && !data ? (
          <div className="px-6">
            <Loading />
          </div>
        ) : !data?.items.length ? (
          <div className="p-6">
            <Empty title={activeFilters.length ? "No calls match these filters" : "No calls yet"}>
              {activeFilters.length ? "Try clearing a filter." : "Upload recordings to get started."}
            </Empty>
          </div>
        ) : (
          <>
            <table className="hidden w-full text-left text-[14px] md:table">
              <thead className="border-b border-line text-[12px] text-muted">
                <tr>
                  <th className="px-6 py-3 font-medium">Call</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 font-medium">Rep</th>
                  <th className="px-3 py-3 font-medium">Outcome</th>
                  <th className="px-3 py-3 font-medium">Score</th>
                  <th className="px-3 py-3 text-right font-medium">Length</th>
                  <th className="px-6 py-3 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition-colors hover:bg-[#fafafa]"
                    onClick={() => {
                      startProgress();
                      router.push(`/calls/${c.id}`);
                    }}
                  >
                    <td className="max-w-[280px] px-6 py-3.5">
                      <Link href={`/calls/${c.id}`} className="block" onClick={(e) => e.stopPropagation()}>
                        <span className="block truncate text-[15px] font-medium tracking-tightish">
                          {c.customer_name ?? c.external_ref ?? c.original_filename}
                        </span>
                        <span className="block truncate text-[12px] text-muted">
                          {c.source === "twilio" ? "AI receptionist call" : c.external_ref ?? c.original_filename}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <StatusOr call={c}>
                        <TypeBadge label={c.call_type_label} review={c.needs_review} />
                      </StatusOr>
                    </td>
                    <td className="px-3 py-3">
                      {c.rep_name ? (
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={c.rep_name} size={22} />
                          {c.rep_name}
                        </span>
                      ) : (
                        <span className="text-faint">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <OutcomeText outcome={c.outcome} />
                    </td>
                    <td className="px-3 py-3">
                      {c.processing_status === "done" && (
                        <ScoreCell score={c.score} max={c.score_max} grade={c.grade} />
                      )}
                    </td>
                    <td className="tnum px-3 py-3 text-right text-muted">{duration(c.duration_seconds)}</td>
                    <td className="tnum px-6 py-3 text-right text-muted">
                      {date(c.occurred_at ?? c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-line md:hidden">
              {data.items.map((c) => (
                <li key={c.id}>
                  <Link href={`/calls/${c.id}`} className="block px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {c.customer_name ?? c.external_ref ?? c.original_filename}
                        </p>
                        <p className="text-xs text-muted">
                          {[c.external_ref, c.rep_name, duration(c.duration_seconds)]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <OutcomeText outcome={c.outcome} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusOr call={c}>
                        <TypeBadge label={c.call_type_label} review={c.needs_review} />
                      </StatusOr>
                      {c.processing_status === "done" && (
                        <ScoreCell score={c.score} max={c.score_max} grade={c.grade} />
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-6 py-3 text-[12px] text-muted">
              {data.total} call{data.total === 1 ? "" : "s"}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

function StatusOr({ call, children }: { call: CallRow; children: React.ReactNode }) {
  if (call.processing_status === "done") return <>{children}</>;
  if (call.processing_status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-bad" title={call.processing_error ?? ""}>
        <span className="h-[7px] w-[7px] rounded-full bg-bad" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <Spinner className="h-3 w-3" />
      {STATUS_LABEL[call.processing_status] ?? "Processing"}
    </span>
  );
}
