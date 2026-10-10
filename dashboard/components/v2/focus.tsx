"use client";

/*
 * Pieces shared by the one-thing-at-a-time screens (Today, Call back): how far
 * through you are, and the moment it's all done.
 */

/** "3 of 13" as a ring that fills as the work gets done. */
export function Progress({ place, of }: { place: number; of: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const done = Math.max(0, place - 1) / Math.max(1, of);
  return (
    <span className="flex items-center gap-2 text-[16px] font-semibold text-ink/75">
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="4" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="rgb(var(--good))"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - done)}
          style={{ transition: "stroke-dashoffset 800ms var(--ease-apple)" }}
        />
      </svg>
      {place} of {of}
    </span>
  );
}

/** A green circle whose tick draws itself. */
export function Tick({ size = 80 }: { size?: number }) {
  return (
    <span className="ring-pop mx-auto flex items-center justify-center rounded-full bg-good text-white" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" style={{ width: size / 2, height: size / 2 }} fill="none">
        <path className="draw-check" d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** The card shown when there is nothing left to do. */
export function AllDone({ label = "Up next", title, body }: { label?: string; title: string; body: string }) {
  return (
    <section
      aria-label={label}
      className="card-in rounded-[30px] border border-hairline bg-surface px-6 py-10 text-center shadow-[0_20px_50px_-24px_rgba(0,0,0,0.25)]"
    >
      <Tick />
      <h2 className="mt-5 text-[28px] font-bold tracking-title">{title}</h2>
      <p className="mx-auto mt-2 max-w-[36ch] text-[18px] text-ink/75">{body}</p>
    </section>
  );
}
