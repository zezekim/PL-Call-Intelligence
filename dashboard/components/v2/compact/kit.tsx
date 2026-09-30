"use client";

import type { Status } from "@/lib/v2";
import { STATUS_BG, STATUS_SOFT, STATUS_TEXT, STATUS_WORD } from "@/lib/v2";

/** Status in words and colour together, never colour alone. */
export function StatusPill({ status, label }: { status: Status; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold ${STATUS_SOFT[status]} ${STATUS_TEXT[status]}`}
    >
      <span className={`h-[6px] w-[6px] rounded-full ${STATUS_BG[status]}`} aria-hidden />
      {label ?? STATUS_WORD[status]}
    </span>
  );
}

/**
 * A value against its target. The fill is always "how much went right", in the
 * status colour, with a tick where the target sits: a long red bar can't be
 * mistaken for good news.
 */
export function Meter({
  value,
  target,
  status,
  label,
}: {
  value: number | null;
  target?: number;
  status: Status;
  label: string;
}) {
  const width = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div
      className="relative h-[6px] rounded-full bg-fill"
      role="img"
      aria-label={`${label}: ${value === null ? "no data" : `${Math.round(value)}%`}${
        target !== undefined ? `, target ${Math.round(target)}%` : ""
      }`}
    >
      <div className={`h-full rounded-full ${STATUS_BG[status]}`} style={{ width: `${width}%` }} />
      {target !== undefined && (
        <span
          className="absolute -top-[3px] h-[12px] w-[2px] rounded-full bg-ink/60"
          style={{ left: `calc(${Math.min(100, target)}% - 1px)` }}
          aria-hidden
        />
      )}
    </div>
  );
}

export function Change({ value }: { value: number | null }) {
  if (value === null || Math.abs(value) < 0.5) return null;
  const up = value > 0;
  return (
    <span className={`tnum text-[12px] font-medium ${up ? "text-good" : "text-bad"}`}>
      {up ? "▲ up" : "▼ down"} {Math.abs(Math.round(value))}
    </span>
  );
}

export function Trend({ trend }: { trend: "up" | "down" | "steady" | null }) {
  if (!trend) return null;
  const map = {
    up: { text: "Improving", cls: "text-good", icon: "↗" },
    down: { text: "Slipping", cls: "text-bad", icon: "↘" },
    steady: { text: "Steady", cls: "text-muted", icon: "→" },
  }[trend];
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${map.cls}`}>
      <span aria-hidden>{map.icon}</span>
      {map.text}
    </span>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-end justify-between gap-4 px-1">
        <div>
          <h2 className="text-[19px] font-semibold tracking-title">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
