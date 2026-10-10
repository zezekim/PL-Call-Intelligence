/*
 * The PestLaunch look: an app icon, and a small coloured tile for each part of
 * the app, the way a phone's settings give every section its own colour so it
 * can be found by colour before it is read.
 */

/** The app icon: a shield with a tick on a green-to-blue tile. */
export function AppMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.25)] ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.27,
        background: "linear-gradient(145deg, #30d158 0%, #12a37f 45%, #0a6cdb 100%)",
      }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
        <path d="M12 2.8 19 5.6v5.6c0 4.6-3 8.4-7 9.9-4-1.5-7-5.3-7-9.9V5.6z" fill="white" fillOpacity="0.95" />
        <path d="m8.6 12.1 2.3 2.3 4.6-4.8" stroke="#0f8f6a" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export type Tint = "orange" | "green" | "indigo" | "blue" | "teal" | "gray";

const TINT: Record<Tint, string> = {
  orange: "linear-gradient(180deg, #ffab3d, #ff8a00)",
  green: "linear-gradient(180deg, #43d86a, #28b14c)",
  indigo: "linear-gradient(180deg, #7a78ff, #5552d9)",
  blue: "linear-gradient(180deg, #3d9bff, #0a72e8)",
  teal: "linear-gradient(180deg, #45c6dc, #1fa3bd)",
  gray: "linear-gradient(180deg, #a1a1a8, #86868d)",
};

/** A section's coloured tile with its picture in white. */
export function Tile({ tint, size = 28, children }: { tint: Tint; size?: number; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center text-white [&_svg]:h-[62%] [&_svg]:w-[62%] [&_svg]:stroke-[2]"
      style={{ width: size, height: size, borderRadius: size * 0.26, background: TINT[tint] }}
      aria-hidden
    >
      {children}
    </span>
  );
}
