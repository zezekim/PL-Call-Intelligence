"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { businessZone } from "@/lib/format";
import { CallsContext } from "@/components/calls-context";
import { ENVIRONMENTS, EnvironmentDialog, useEnvironment } from "@/components/environment";
import { UploadIcon } from "@/components/icons";
import { Segmented } from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { MoreMenu } from "@/components/v2/kit";
import { ToastProvider } from "@/components/v2/toast";

type Range = "7" | "30" | "all";

const TABS = [
  { href: "/v2", label: "Today", title: "Today", v1: "/calls" },
  { href: "/v2/pipeline", label: "Call back", title: "People to call back", v1: "/calls/pipeline" },
  { href: "/v2/reps", label: "Team", title: "Your team", v1: "/calls/reps" },
  { href: "/v2/calls", label: "All calls", title: "All calls", v1: "/calls/log" },
];

const RANGE_KEY = "pestlaunch.range";
// Coming back to the window after this long fetches fresh numbers by itself.
const STALE_MS = 60_000;

/** "Updated just now", "Updated 5 min ago", then the time. */
function updated(iso: string, now: number): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins} min ago`;
  return `Updated ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: businessZone() })}`;
}

export default function V2Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [range, setRange] = useState<Range>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const { env } = useEnvironment();
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  // Set in the browser, so it is today where the business is.
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: businessZone(),
      }),
    );
  }, [asOf]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RANGE_KEY) as Range | null;
      if (saved === "7" || saved === "30" || saved === "all") setRange(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const changeRange = (value: Range) => {
    setRange(value);
    try {
      window.localStorage.setItem(RANGE_KEY, value);
    } catch {
      /* storage unavailable */
    }
  };

  const days = range === "all" ? null : Number(range);
  const query = useCallback(
    (path: string) => (days ? `${path}${path.includes("?") ? "&" : "?"}days=${days}` : path),
    [days],
  );
  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setAsOf(new Date().toISOString());
  }, []);

  // Fresh when the owner comes back to the tab, without them having to ask.
  const asOfRef = useRef(asOf);
  asOfRef.current = asOf;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - Date.parse(asOfRef.current) > STALE_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // Keeps "Updated 3 min ago" honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const tab = TABS.find((t) => t.href === pathname);
  // The call-back list shows everyone still deciding, whatever the period.
  const ranged = tab && tab.href !== "/v2/pipeline";

  return (
    <CallsContext.Provider value={{ days, refreshKey, query }}>
      <ToastProvider>
        {tab && (
          <div className="mb-7">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
              <div className="min-w-0">
                <h1 className="large-title">
                  {tab.title}
                  {tab.href === "/v2" && today && <span className="font-normal text-muted">, {today}</span>}
                </h1>
                <p className="footnote mt-1.5">
                  {ranged ? (range === "all" ? "All calls" : `Last ${range} days`) : "Everyone still deciding"} ·{" "}
                  {updated(asOf, Math.max(now, Date.parse(asOf)))} ·{" "}
                  <Link href={tab.v1} className="hover:text-link hover:underline" title="This is version 2. Open version 1.">
                    See v1
                  </Link>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {ranged && (
                  <Segmented
                    size="sm"
                    value={range}
                    onChange={changeRange}
                    options={[
                      { value: "7", label: "7D" },
                      { value: "30", label: "30D" },
                      { value: "all", label: "All" },
                    ]}
                  />
                )}
                <button className="btn-primary" onClick={() => setUploadOpen(true)}>
                  <UploadIcon className="h-4 w-4" />
                  Upload
                </button>
                <MoreMenu
                  items={[
                    { label: "Refresh", onSelect: refresh },
                    {
                      label: `Transcribe with: ${ENVIRONMENTS.find((e) => e.value === env)?.label ?? "Cloud"}`,
                      onSelect: () => setEnvOpen(true),
                    },
                  ]}
                />
              </div>
            </div>
            <div className="mt-6">
              <div className="flex w-full rounded-[9px] bg-fill p-[2px] sm:inline-flex sm:w-auto" role="tablist">
                {TABS.map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    role="tab"
                    aria-selected={pathname === t.href}
                    className={`flex-1 whitespace-nowrap rounded-[7px] px-1.5 py-[5px] text-center text-[13px] font-medium transition-all duration-150 sm:flex-none sm:px-4 ${
                      pathname === t.href ? "bg-thumb text-ink shadow-thumb" : "text-ink/70 hover:text-ink"
                    }`}
                  >
                    {t.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
        <div key={pathname} className="animate-page-in">
          {children}
        </div>
        <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} logHref="/v2/calls" />
        <EnvironmentDialog open={envOpen} onClose={() => setEnvOpen(false)} />
      </ToastProvider>
    </CallsContext.Provider>
  );
}
