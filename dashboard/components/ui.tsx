"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { Grade } from "@/lib/api";
import {
  GRADE_LABEL,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  TONE_TEXT,
  initials,
  pct,
} from "@/lib/format";
import { AlertIcon } from "./icons";

export function Card({
  children,
  className = "",
  accent = false,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return <section className={`card ${accent ? "card-accent" : ""} ${className}`}>{children}</section>;
}

export function CardHeader({
  title,
  eyebrow,
  action,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h2 className="section-title">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Metric({
  label,
  value,
  tone = "none",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "none";
  hint?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] leading-tight text-muted">{label}</p>
      <p className={`tnum mt-1 text-[28px] font-semibold leading-none tracking-tight ${TONE_TEXT[tone]}`}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const GRADE_STYLE: Record<Grade, string> = {
  gold: "bg-gold-soft text-gold",
  green: "bg-good-soft text-good",
  below: "bg-bad-soft text-bad",
};

export function GradeBadge({ grade, size = "sm" }: { grade: Grade | null; size?: "sm" | "lg" }) {
  if (!grade) return <span className="text-sm text-faint">Not scored</span>;
  return (
    <span
      className={`chip ${GRADE_STYLE[grade]} ${size === "lg" ? "px-3 py-1 text-sm" : ""}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {GRADE_LABEL[grade]}
    </span>
  );
}

export function ScoreCell({
  score,
  max,
  grade,
}: {
  score: number | null;
  max: number | null;
  grade: Grade | null;
}) {
  if (score === null || !max) return <span className="text-sm text-faint">Not scored</span>;
  return (
    <div className="flex items-center gap-2.5">
      <span className="tnum w-11 text-sm font-semibold">
        {score}/{max}
      </span>
      <GradeBadge grade={grade} />
    </div>
  );
}

export function TypeBadge({ label, review }: { label: string | null; review?: boolean }) {
  if (!label) return <span className="text-sm text-faint">-</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="chip bg-panel text-ink ring-1 ring-line">{label}</span>
      {review && (
        <span className="chip bg-warn-soft text-warn" title="Call type needs review">
          <AlertIcon className="h-3 w-3" />
          Check type
        </span>
      )}
    </span>
  );
}

export function OutcomeText({ outcome }: { outcome: string | null }) {
  if (!outcome || outcome === "not_applicable") return <span className="text-faint">-</span>;
  const tone = OUTCOME_TONE[outcome] ?? "none";
  return <span className={`font-medium ${TONE_TEXT[tone]}`}>{OUTCOME_LABEL[outcome] ?? outcome}</span>;
}

export function Avatar({ name, size = 32 }: { name: string | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Single-series horizontal bar: one hue, value labelled in text. */
export function HitBar({
  label,
  value,
  detail,
  href,
  invert = false,
}: {
  label: string;
  value: number | null;
  detail?: string;
  href?: string;
  invert?: boolean;
}) {
  const width = Math.max(0, Math.min(100, value ?? 0));
  const body = (
    <div className="group py-1.5">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className={`truncate ${href ? "group-hover:text-accent" : ""}`}>{label}</span>
        <span className="tnum shrink-0 text-muted">
          {detail ?? pct(value)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-panel" title={`${label}: ${pct(value)}`}>
        <div
          className={`h-2 rounded-full ${invert ? "bg-[#9db9ec]" : "bg-accent"}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-xl bg-[#e3e6ec] p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg font-medium transition ${
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm"
          } ${o.value === value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-panel px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      aria-label="Loading"
    />
  );
}

export function Loading() {
  return (
    <div className="flex items-center gap-2 py-16 text-sm text-muted">
      <Spinner /> Loading
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/25 p-4 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="card w-full max-w-lg p-6 shadow-pop">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">{title}</h2>
          <button className="btn-ghost -mr-2 px-2" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
