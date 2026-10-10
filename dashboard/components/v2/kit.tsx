"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "@/components/icons";
import type { Status } from "@/lib/v2";
import { STATUS_BG, STATUS_SOFT, STATUS_TEXT, STATUS_WORD } from "@/lib/v2";

/** Status in words and colour together, never colour alone. */
export function StatusPill({ status, label }: { status: Status; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[16px] font-semibold ${STATUS_SOFT[status]} ${STATUS_TEXT[status]}`}
    >
      <span className={`h-2 w-2 rounded-full ${STATUS_BG[status]}`} aria-hidden />
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
      className="relative h-[10px] rounded-full bg-fill"
      role="img"
      aria-label={`${label}: ${value === null ? "no data" : `${Math.round(value)}%`}${
        target !== undefined ? `, target ${Math.round(target)}%` : ""
      }`}
    >
      <div className={`h-full rounded-full ${STATUS_BG[status]}`} style={{ width: `${width}%` }} />
      {target !== undefined && (
        <span
          className="absolute -top-[4px] h-[18px] w-[3px] rounded-full bg-ink/70"
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
    <span className={`tnum text-[15px] font-medium ${up ? "text-good" : "text-bad"}`}>
      {up ? "▲ up" : "▼ down"} {Math.abs(Math.round(value))}
    </span>
  );
}

export function Trend({ trend }: { trend: "up" | "down" | "steady" | null }) {
  if (!trend) return null;
  const map = {
    up: { text: "Getting better", cls: "text-good", icon: "↗" },
    down: { text: "Getting worse", cls: "text-bad", icon: "↘" },
    steady: { text: "About the same", cls: "text-ink/70", icon: "→" },
  }[trend];
  return (
    <span className={`inline-flex items-center gap-1 text-[15px] font-medium ${map.cls}`}>
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
      <div className="mb-4 flex items-end justify-between gap-4 px-1">
        <div>
          <h2 className="text-[22px] font-semibold tracking-title">{title}</h2>
          {subtitle && <p className="mt-1 text-[17px] text-ink/80">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * When a page can't load: plain words and one way forward, never the server's
 * developer message. A link to something deleted (404, or a malformed id: 422)
 * says so, with a way back.
 */
export function PageError({
  status,
  onRetry,
  back,
  thing = "page",
}: {
  status: number | null;
  onRetry?: () => void;
  back?: { href: string; label: string };
  thing?: string;
}) {
  const missing = status === 404 || status === 422;
  return (
    <div className="card mx-auto max-w-md px-6 py-12 text-center">
      <p className="text-[18px] font-semibold tracking-tightish">
        {missing ? `This ${thing} isn't here anymore` : "We couldn't load this"}
      </p>
      <p className="mx-auto mt-1.5 max-w-xs text-[16px] text-muted">
        {missing
          ? "It may have been deleted, or the link is incomplete."
          : status === 0
            ? "Check your internet connection, then try again."
            : "Something went wrong on our side. Try again in a moment."}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {!missing && onRetry && (
          <button className="btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
        {back && (
          <Link href={back.href} className={missing ? "btn-primary" : "btn-secondary"}>
            {back.label}
          </Link>
        )}
      </div>
    </div>
  );
}

/** "Show 4 more" / "Show less": secondary detail stays one tap away, never lost. */
export function MoreToggle({
  open,
  onToggle,
  count,
  noun,
  className = "",
}: {
  open: boolean;
  onToggle: () => void;
  count: number;
  noun?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className={`inline-flex min-h-[40px] items-center gap-1 text-[16px] font-medium text-link hover:underline ${className}`}
    >
      {open ? "Show less" : `Show ${count} more${noun ? ` ${noun}` : ""}`}
      <ChevronIcon className={`h-3.5 w-3.5 transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
    </button>
  );
}

/** The ••• button: rarely used actions, kept out of the way until wanted. */
export function MoreMenu({
  items,
  label = "More actions",
}: {
  items: { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; separated?: boolean }[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const first = box.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const all = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
      const i = all.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        all[(i + 1) % all.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        all[(i - 1 + all.length) % all.length]?.focus();
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        ref={button}
        className="btn-secondary px-4"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
        More
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="animate-menu-in absolute right-0 top-full z-40 mt-1.5 w-64 origin-top-right rounded-[14px] border border-hairline bg-surface/95 p-1.5 shadow-pop backdrop-blur-xl"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separated && <div className="mx-2 my-1 h-px bg-line" aria-hidden />}
              <button
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex w-full items-center rounded-[8px] px-3 py-[7px] text-left text-[16px] transition-colors hover:bg-fill focus:bg-fill focus:outline-none disabled:opacity-40 ${
                  item.danger ? "text-bad" : "text-ink"
                }`}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Loading placeholders shaped like the page that is coming -------------------

const bone = "animate-pulse rounded-lg bg-fill";

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="group-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className={`${bone} h-3.5`} style={{ width: `${44 - (i % 3) * 8}%` }} />
            <div className={`${bone} h-3 w-1/3`} />
          </div>
          <div className={`${bone} h-5 w-20 rounded-full`} />
        </div>
      ))}
    </div>
  );
}

export function CallSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className={`${bone} h-4 w-20`} />
      <div className="card space-y-3 p-6">
        <div className={`${bone} h-3 w-28`} />
        <div className={`${bone} h-7 w-64`} />
        <div className={`${bone} h-3 w-48`} />
        <div className={`${bone} mt-4 h-3.5 w-full max-w-2xl`} />
        <div className={`${bone} h-3.5 w-4/5 max-w-xl`} />
      </div>
      <div className="grid gap-5 min-[1180px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="card h-[420px] animate-pulse" />
        <div className="card h-[260px] animate-pulse" />
      </div>
    </div>
  );
}

export function PersonSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className={`${bone} h-4 w-16`} />
      <div className="card flex items-center gap-4 p-6">
        <div className="h-[52px] w-[52px] animate-pulse rounded-full bg-fill" />
        <div className="flex-1 space-y-2.5">
          <div className={`${bone} h-6 w-48`} />
          <div className={`${bone} h-3.5 w-2/3`} />
        </div>
      </div>
      <div className="grid gap-4 min-[1180px]:grid-cols-3">
        <div className="card h-44 animate-pulse" />
        <div className="card h-44 animate-pulse" />
        <div className="card h-44 animate-pulse" />
      </div>
    </div>
  );
}
