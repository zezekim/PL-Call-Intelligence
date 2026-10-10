"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Grade } from "@/lib/api";
import {
  GRADE_LABEL,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  TONE_TEXT,
  initials,
  pct,
} from "@/lib/format";
import { AlertIcon, ChevronIcon } from "./icons";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHeader({
  title,
  eyebrow,
  action,
  subtitle,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  action?: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-0.5">{eyebrow}</p>}
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="footnote mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Metric({
  label,
  value,
  tone = "none",
  hint,
  size = "lg",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "none";
  hint?: React.ReactNode;
  size?: "lg" | "md";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] leading-tight text-muted">{label}</p>
      <p
        className={`tnum mt-1.5 font-semibold leading-none tracking-title ${
          size === "lg" ? "text-[30px]" : "text-[24px]"
        } ${TONE_TEXT[tone]}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

const GRADE_DOT: Record<Grade, string> = {
  gold: "bg-[#c99a00]",
  green: "bg-good",
  below: "bg-bad",
};

const GRADE_TEXT: Record<Grade, string> = {
  gold: "text-gold",
  green: "text-good",
  below: "text-bad",
};

export function GradeBadge({ grade, size = "sm" }: { grade: Grade | null; size?: "sm" | "lg" }) {
  if (!grade) return <span className="text-[13px] text-muted">Not scored</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium ${GRADE_TEXT[grade]} ${
        size === "lg" ? "text-[15px]" : "text-[13px]"
      }`}
    >
      <span className={`h-[7px] w-[7px] rounded-full ${GRADE_DOT[grade]}`} aria-hidden />
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
  if (score === null || !max) return <span className="text-[13px] text-muted">Not scored</span>;
  return (
    <div className="flex items-center gap-3">
      <span className="tnum whitespace-nowrap text-[14px] font-medium">
        {score}
        <span className="text-faint">/{max}</span>
      </span>
      <GradeBadge grade={grade} />
    </div>
  );
}

export function TypeBadge({ label, review }: { label: string | null; review?: boolean }) {
  if (!label) return <span className="text-[13px] text-faint">-</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[14px]">{label}</span>
      {review && (
        <span className="chip bg-warn-soft text-warn" title="Call type needs review">
          Check type
        </span>
      )}
    </span>
  );
}

export function OutcomeText({ outcome }: { outcome: string | null }) {
  if (!outcome || outcome === "not_applicable") return <span className="text-faint">-</span>;
  const tone = OUTCOME_TONE[outcome] ?? "none";
  return <span className={`text-[14px] font-medium ${TONE_TEXT[tone]}`}>{OUTCOME_LABEL[outcome] ?? outcome}</span>;
}

export function Avatar({ name, size = 32 }: { name: string | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#8e8e93] font-medium text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Single-series horizontal bar: one hue, the value always in text beside it. */
export function HitBar({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: number | null;
  detail?: string;
  href?: string;
  invert?: boolean;
}) {
  const width = Math.max(0, Math.min(100, value ?? 0));
  const body = (
    <div className="group py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className={`truncate text-[14px] ${href ? "group-hover:text-link" : ""}`}>{label}</span>
        <span className="tnum shrink-0 text-[13px] text-muted">{detail ?? pct(value)}</span>
      </div>
      <div className="h-[5px] rounded-full bg-fill" title={`${label}: ${pct(value)}`}>
        <div className="h-[5px] rounded-full bg-accent" style={{ width: `${width}%` }} />
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
    <div className="inline-flex rounded-[9px] bg-fill p-[2px]" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-[7px] font-medium transition-all duration-150 ${
            size === "sm" ? "px-3 py-[3px] text-[12px]" : "px-4 py-[7px] text-[15px]"
          } ${o.value === value ? "bg-thumb text-ink shadow-thumb" : "text-ink/70 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GroupRow({
  href,
  onClick,
  children,
  chevron = true,
}: {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
  chevron?: boolean;
}) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">{children}</div>
      {chevron && <ChevronIcon className="h-4 w-4 shrink-0 text-faint" />}
    </>
  );
  const cls = "group-row w-full text-left transition-colors hover:bg-surface-hover";
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  if (onClick)
    return (
      <button onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  return <div className="group-row">{inner}</div>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-[17px] font-semibold tracking-tightish">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-sm text-[14px] text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-[2px] border-current border-r-transparent opacity-70 ${className}`}
      aria-label="Loading"
    />
  );
}

export function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-fill" />
      <div className="card h-32 animate-pulse" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card h-48 animate-pulse" />
        <div className="card h-48 animate-pulse" />
        <div className="card h-48 animate-pulse" />
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-bad-soft px-4 py-3 text-[14px] text-bad">
      <AlertIcon className="mt-[2px] h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus moves into a dialog, stays there, and goes back when it closes; Escape closes it. */
export function useDialog(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // Keyboard focus stays inside the dialog and returns to where it was.
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const first = dialog?.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    ) ?? dialog?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (!items.length) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
    // The ref is stable; only opening and closing matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
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
  const ref = useRef<HTMLDivElement>(null);
  useDialog(open, onClose, ref);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 p-3 backdrop-blur-[6px] sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[460px] rounded-[22px] bg-surface/95 p-6 shadow-pop backdrop-blur-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-[19px] font-semibold tracking-title">{title}</h2>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full bg-fill text-[13px] text-muted hover:bg-fill-hover"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
