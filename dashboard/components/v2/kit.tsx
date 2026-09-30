"use client";

import Link from "next/link";
import type { Status } from "@/lib/v2";
import { STATUS_WORD } from "@/lib/v2";

/*
 * Building blocks for the v2 screens, designed for people who find most
 * software hard: large text, big targets, plain words, and status that is
 * always a shape plus a word, never colour alone.
 */

// Icons use the same deep colours in light and dark, so the white symbol
// inside always stands out.
const STATUS_STYLE: Record<Status, { bg: string; icon: string }> = {
  good: { bg: "bg-good-soft", icon: "bg-[#146c2e]" },
  watch: { bg: "bg-warn-soft", icon: "bg-[#a84f00]" },
  bad: { bg: "bg-bad-soft", icon: "bg-[#a3001a]" },
  none: { bg: "bg-panel", icon: "bg-[#5e5e63]" },
};

/** ✓ good, ! could be better, ✕ needs work: each has its own shape. */
export function StatusIcon({ status, size = 22 }: { status: Status; size?: number }) {
  const s = STATUS_STYLE[status];
  const glyph = { good: "✓", watch: "!", bad: "✕", none: "–" }[status];
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center font-bold text-white ${s.icon} ${
        status === "watch" ? "rounded-[6px] rotate-45" : "rounded-full"
      }`}
      style={{ width: size, height: size, fontSize: size * 0.6 }}
    >
      <span className={status === "watch" ? "-rotate-45" : ""}>{glyph}</span>
    </span>
  );
}

export function StatusBadge({ status, label, large }: { status: Status; label?: string; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full font-semibold text-ink ${
        STATUS_STYLE[status].bg
      } ${large ? "px-4 py-2 text-[18px]" : "px-3 py-1.5 text-[16px]"}`}
    >
      <StatusIcon status={status} size={large ? 22 : 18} />
      {label ?? STATUS_WORD[status]}
    </span>
  );
}

/** A plain progress bar: how much went right, with the goal marked and labelled. */
export function GoalBar({ value, goal, status }: { value: number | null; goal?: number; status: Status }) {
  const width = Math.max(0, Math.min(100, value ?? 0));
  const fill = { good: "bg-good", watch: "bg-[#c25e00]", bad: "bg-bad", none: "bg-subtle" }[status];
  return (
    <div className={`relative ${goal !== undefined ? "pb-6" : ""}`} aria-hidden>
      <div className="h-4 overflow-hidden rounded-full bg-fill">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
      </div>
      {goal !== undefined && (
        <div className="absolute top-[-4px] flex flex-col items-center" style={{ left: `${Math.min(100, goal)}%`, transform: "translateX(-50%)" }}>
          <span className="h-6 w-[3px] rounded-full bg-ink" />
          <span className="mt-0.5 text-[14px] font-semibold text-ink">Goal</span>
        </div>
      )}
    </div>
  );
}

const BUTTON =
  "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-6 text-[18px] font-semibold transition-colors focus-visible:ring-[4px] focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50";

// Filled buttons use fixed deep colours in both themes, so white text keeps
// at least 7:1 contrast (WCAG AAA) whatever the appearance setting.
export const bigButton = {
  primary: `${BUTTON} bg-[#0055aa] text-white hover:bg-[#004a94]`,
  secondary: `${BUTTON} bg-fill text-ink hover:bg-fill-hover`,
  good: `${BUTTON} bg-[#0f5c26] text-white hover:bg-[#0b4a1e]`,
  danger: `${BUTTON} border-2 border-bad bg-bad-soft text-ink hover:bg-bad/20`,
};

/** Links read as dark text with a blue underline: high contrast, still clearly a link. */
export const easyLink =
  "font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4 hover:decoration-[3px]";

export function BigLink({
  href,
  children,
  kind = "primary",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  kind?: keyof typeof bigButton;
  className?: string;
}) {
  return (
    <Link href={href} className={`${bigButton[kind]} ${className}`}>
      {children}
    </Link>
  );
}

export function Section({
  title,
  intro,
  children,
  className = "",
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="text-[26px] font-bold leading-tight tracking-title">{title}</h2>
      {intro && <p className="mt-1.5 max-w-3xl text-[18px] leading-relaxed text-ink/80">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A white panel with generous padding and a clear edge. */
export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[22px] border-2 border-line bg-surface p-6 ${className}`}>{children}</div>;
}

export function Trend({ trend }: { trend: "up" | "down" | "steady" | null }) {
  if (!trend) return null;
  const map = {
    up: { text: "Getting better", icon: "↑", status: "good" as const },
    down: { text: "Getting worse", icon: "↓", status: "bad" as const },
    steady: { text: "About the same", icon: "→", status: "none" as const },
  }[trend];
  return (
    <span className="inline-flex items-center gap-1.5 text-[16px] font-semibold text-ink">
      <span aria-hidden className={map.status === "good" ? "text-good" : map.status === "bad" ? "text-bad" : ""}>
        {map.icon}
      </span>
      {map.text}
    </span>
  );
}

/** "Show more" that says exactly what will appear. */
export function Reveal({
  open,
  onToggle,
  more,
  less = "Show less",
}: {
  open: boolean;
  onToggle: () => void;
  more: string;
  less?: string;
}) {
  return (
    <button className={bigButton.secondary} onClick={onToggle} aria-expanded={open}>
      <span aria-hidden>{open ? "▲" : "▼"}</span>
      {open ? less : more}
    </button>
  );
}
