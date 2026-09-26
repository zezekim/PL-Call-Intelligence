"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CheckIcon } from "./icons";

export interface FollowUpItem {
  id: string;
  action: string;
  owner?: string | null;
  due?: string | null;
  status?: "open" | "done";
  done_by?: string | null;
  call_id?: string;
  customer?: string | null;
  assignee_id?: string | null;
  assignee?: string | null;
}

interface TeamMember {
  id: string;
  email: string;
}

const firstName = (email: string) => titleCase(email.split("@")[0].split(/[._-]/)[0]);

/**
 * A checklist of promises made on calls. Ticking one marks it done for the
 * whole team; ticked items stay visible (struck through) until the page is
 * reloaded, so a mis-tap can be undone.
 */
export function FollowUpList({
  items,
  linkToCall = false,
  onChange,
}: {
  items: FollowUpItem[];
  linkToCall?: boolean;
  onChange?: () => void;
}) {
  const [status, setStatus] = useState<Record<string, "open" | "done">>({});
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const team = useApi<TeamMember[]>("/intel/team");

  async function assign(item: FollowUpItem, assigneeId: string) {
    const previous = assigned[item.id] ?? item.assignee_id ?? "";
    setAssigned((a) => ({ ...a, [item.id]: assigneeId }));
    try {
      await api.patch(`/intel/follow-ups/${item.id}`, { assignee_id: assigneeId });
      onChange?.();
    } catch {
      setAssigned((a) => ({ ...a, [item.id]: previous }));
    }
  }

  async function toggle(item: FollowUpItem) {
    const current = status[item.id] ?? item.status ?? "open";
    const next = current === "done" ? "open" : "done";
    setStatus((s) => ({ ...s, [item.id]: next }));
    setBusy(item.id);
    try {
      await api.patch(`/intel/follow-ups/${item.id}`, { status: next });
      onChange?.();
    } catch {
      setStatus((s) => ({ ...s, [item.id]: current }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="divide-y divide-line">
      {items.map((f) => {
        const done = (status[f.id] ?? f.status ?? "open") === "done";
        const meta = [linkToCall ? f.customer : null, f.owner ? titleCase(f.owner) : null, f.due]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={f.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <button
              role="checkbox"
              aria-checked={done}
              aria-label={done ? "Mark as not done" : "Mark as done"}
              disabled={busy === f.id}
              onClick={() => toggle(f)}
              className={`mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                done ? "border-[#34c759] bg-[#34c759] text-white" : "border-neutral hover:border-accent"
              }`}
            >
              {done && <CheckIcon className="h-3 w-3" />}
            </button>
            <div className="min-w-0 flex-1">
              {linkToCall && f.call_id ? (
                <Link
                  href={`/calls/${f.call_id}`}
                  className={`text-[14px] leading-snug hover:text-link ${done ? "text-muted line-through" : ""}`}
                >
                  {f.action}
                </Link>
              ) : (
                <p className={`text-[14px] leading-snug ${done ? "text-muted line-through" : ""}`}>{f.action}</p>
              )}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[12px] text-muted">
                {meta && <span>{meta}</span>}
                {done && f.done_by && !status[f.id] && <span>· done by {f.done_by}</span>}
                {(team.data?.length ?? 0) > 0 && (
                  <>
                    {(meta || (done && f.done_by)) && <span aria-hidden>·</span>}
                    <select
                      className="cursor-pointer appearance-none rounded bg-transparent text-[12px] text-link hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      aria-label={`Assign "${f.action}"`}
                      value={assigned[f.id] ?? f.assignee_id ?? ""}
                      onChange={(e) => void assign(f, e.target.value)}
                    >
                      <option value="">Assign</option>
                      {team.data!.map((u) => (
                        <option key={u.id} value={u.id}>
                          {firstName(u.email)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
