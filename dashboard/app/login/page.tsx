"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, setToken } from "@/lib/api";
import { useTitle } from "@/lib/hooks";
import { AppMark } from "@/components/brand";
import { askForEnvironmentNext } from "@/components/environment";
import { CallBackIcon, CheckIcon, MessageIcon, TeamIcon } from "@/components/icons";
import { Spinner } from "@/components/ui";

/*
 * The front door. It looks like a phone's lock screen for the business: the
 * time, and the kind of news PestLaunch brings arriving one after another,
 * over light that slowly drifts. Then one card, two boxes, one button.
 */

// Examples of what the app says, so a first-time visitor sees what it does.
const NEWS = [
  { icon: CallBackIcon, tint: "#28b14c", app: "New call", text: "Maureen asked about mice. She was given a price of $649." },
  { icon: CheckIcon, tint: "#0a72e8", app: "Said yes", text: "Jordan booked a quarterly plan. Nice work, Kristen." },
  { icon: MessageIcon, tint: "#1fa3bd", app: "Text sent", text: "Pamela got a friendly reminder about her visit on Thursday." },
  { icon: TeamIcon, tint: "#5552d9", app: "Your team", text: "Griffin is getting better at explaining the plan." },
];
const EVERY_MS = 3200;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [shake, setShake] = useState(0);
  useTitle("Sign in");
  // The night sky reaches the window's edges, scrollbar space included.
  useEffect(() => {
    document.documentElement.classList.add("night");
    return () => document.documentElement.classList.remove("night");
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError(!email.trim() ? "Type your email first." : "Type your password first.");
      setShake((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ access_token: string }>("/auth/login", { email: email.trim(), password });
      setToken(result.access_token);
      setDone(true);
      askForEnvironmentNext();
      // A beat to see the tick, then the day opens.
      window.setTimeout(() => router.replace("/v2"), 450);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
      setShake((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#060a1a] text-white">
      <Aurora />

      <div className="relative mx-auto grid min-h-[100dvh] max-w-[1180px] items-center gap-6 px-5 py-7 sm:gap-10 sm:py-10 lg:grid-cols-[1.1fr_minmax(0,440px)] lg:gap-16 lg:px-10">
        <section aria-label="What PestLaunch does" className="fade-in">
          <div className="flex items-center gap-3">
            <AppMark size={44} />
            <span className="text-[22px] font-semibold tracking-title">PestLaunch</span>
          </div>
          <Clock />
          <p className="mt-3 max-w-[30ch] text-[20px] font-semibold leading-snug tracking-title text-white/95 sm:mt-4 sm:text-[26px]">
            Every call answered. Every customer followed up.
          </p>
          <p className="mt-3 hidden max-w-[46ch] text-[17px] leading-relaxed text-white/75 sm:block">
            PestLaunch listens to your calls, tells you who to call back, and helps your team get better. All in plain words.
          </p>
          <News />
        </section>

        <form
          key={shake}
          onSubmit={submit}
          noValidate
          className={`sheet-in w-full rounded-[30px] border border-white/15 bg-white/[0.09] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl sm:p-8 ${shake ? "shake" : ""}`}
        >
          <h1 className="text-[30px] font-bold tracking-title">Welcome back</h1>
          <p className="mt-1 text-[17px] text-white/75">Sign in to see your day.</p>

          <label className="mt-6 block sm:mt-7">
            <span className="mb-2 block text-[15px] font-medium text-white/85">Email</span>
            <input
              type="email"
              inputMode="email"
              className="w-full rounded-2xl border border-white/15 bg-white/[0.08] px-4 py-3.5 text-[18px] text-white placeholder:text-white/40 focus:border-white/40 focus:bg-white/[0.12] focus:outline-none focus:ring-4 focus:ring-white/10"
              placeholder="you@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-2 block text-[15px] font-medium text-white/85">Password</span>
            <span className="relative block">
              <input
                type={show ? "text" : "password"}
                className="w-full rounded-2xl border border-white/15 bg-white/[0.08] py-3.5 pl-4 pr-20 text-[18px] text-white placeholder:text-white/40 focus:border-white/40 focus:bg-white/[0.12] focus:outline-none focus:ring-4 focus:ring-white/10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="press absolute right-2 top-1/2 min-h-[40px] -translate-y-1/2 rounded-xl px-3 text-[15px] font-medium text-white/80 hover:bg-white/10"
                onClick={() => setShow((s) => !s)}
                aria-pressed={show}
              >
                {show ? "Hide" : "Show"}
              </button>
            </span>
          </label>

          {error && (
            <p role="alert" className="mt-4 rounded-2xl bg-[#ff453a]/15 px-4 py-3 text-[16px] font-medium text-[#ffb3ad]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className={`press mt-6 flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl text-[19px] font-semibold shadow-[0_12px_30px_-10px_rgba(48,209,88,0.6)] transition-colors ${
              done ? "bg-[#30d158] text-[#04210d]" : "bg-white text-[#0b1020] hover:bg-white/90"
            }`}
          >
            {done ? (
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden>
                <path className="draw-check" d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : busy ? (
              <Spinner className="h-5 w-5" />
            ) : null}
            {done ? "Opening your day" : "Sign in"}
            {!busy && !done && <span aria-hidden>→</span>}
          </button>
          <p className="mt-5 text-center text-[15px] text-white/60">Forgot your password? Ask the person who set up PestLaunch.</p>
        </form>
      </div>
    </div>
  );
}

/** Soft colour that drifts behind everything, the way a lock screen breathes. */
function Aurora() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <span className="aurora left-[-10%] top-[-20%] h-[60vmax] w-[60vmax] bg-[#13a37f]" />
      <span className="aurora aurora-2 right-[-15%] top-[10%] h-[55vmax] w-[55vmax] bg-[#0a5bd8]" />
      <span className="aurora aurora-3 bottom-[-30%] left-[20%] h-[50vmax] w-[50vmax] bg-[#6b4cff]" />
      <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(6,10,26,0.55)_75%)]" />
    </div>
  );
}

/** The real time and date, big, like a phone that's just been picked up. */
function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="mt-6 min-h-[86px] sm:mt-10 sm:min-h-[120px] lg:mt-14" aria-hidden>
      {now && (
        <>
          <p className="text-[17px] font-semibold text-white/80">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <p className="tnum text-[60px] font-bold leading-none tracking-[-0.04em] text-white/95 sm:text-[96px]">
            {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/, "")}
          </p>
        </>
      )}
    </div>
  );
}

/** What PestLaunch tells you, arriving like notifications. */
function News() {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setN((x) => x + 1), EVERY_MS);
    return () => window.clearInterval(t);
  }, []);
  // The newest on top, two older ones behind it.
  const shown = [0, 1, 2].map((i) => ({ ...NEWS[(n - i + NEWS.length * 10) % NEWS.length], key: n - i, depth: i }));
  return (
    <div className="relative mt-8 hidden h-[130px] max-w-[440px] sm:block" aria-hidden>
      {shown.map(({ icon: Icon, tint, app, text, key, depth }) => (
        <div
          key={key}
          className={`absolute inset-x-0 top-0 flex items-start gap-3 rounded-[22px] border border-white/15 bg-[#26304d]/85 p-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-700 [&>*]:transition-opacity [&>*]:duration-500 ${
            depth === 0 ? "notify-in" : "[&>*]:opacity-0"
          }`}
          style={{
            // Older ones tuck underneath, showing just their edge.
            transform: `translateY(${depth * 13}px) scale(${1 - depth * 0.05})`,
            opacity: 1 - depth * 0.25,
            zIndex: 3 - depth,
            transitionTimingFunction: "var(--ease-apple)",
          }}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-white" style={{ background: tint }}>
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between text-[14px] font-semibold uppercase tracking-wide text-white/70">
              {app}
              <span className="font-normal normal-case tracking-normal text-white/55">{depth === 0 ? "now" : `${depth * 3}m ago`}</span>
            </span>
            <span className="mt-0.5 block text-[16px] leading-snug text-white/95">{text}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
