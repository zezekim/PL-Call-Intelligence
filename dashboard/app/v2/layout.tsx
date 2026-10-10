"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { businessZone } from "@/lib/format";
import { CallsContext } from "@/components/calls-context";
import { UploadIcon } from "@/components/icons";
import { Segmented } from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { ToastProvider } from "@/components/v2/toast";

type Range = "7" | "30" | "all";

// Each page says in one sentence what it is for. The sidebar (or the bar
// along the bottom of a phone) moves between them. Today draws its own
// header: it is one job at a time, with nothing else on the page.
const TABS = [
  { href: "/v2/pipeline", title: "People to call back", about: "Customers still deciding. Call them before they go somewhere else." },
  { href: "/v2/reps", title: "Your team", about: "How each person is doing on their calls." },
  { href: "/v2/calls", title: "All calls", about: "Every call, newest first. Tap one to hear it." },
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
  const [asOf, setAsOf] = useState(() => new Date().toISOString());

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
          <div className="mb-8">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
              <div className="min-w-0">
                <h1 className="large-title">{tab.title}</h1>
                <p className="mt-2 text-[16px] leading-snug text-ink/80">{tab.about}</p>
              </div>
              <button className="btn-primary" onClick={() => setUploadOpen(true)}>
                <UploadIcon className="h-4 w-4" />
                Add a call recording
              </button>
            </div>
            {ranged && (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="text-[16px] text-ink/80">Calls from</span>
                <Segmented
                  value={range}
                  onChange={changeRange}
                  options={[
                    { value: "7", label: "Past week" },
                    { value: "30", label: "Past month" },
                    { value: "all", label: "All time" },
                  ]}
                />
                <span className="text-[15px] text-ink/70">{updated(asOf, Math.max(now, Date.parse(asOf)))}</span>
              </div>
            )}
          </div>
        )}
        <div key={pathname} className="animate-page-in">
          {children}
        </div>
        <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} logHref="/v2/calls" />
      </ToastProvider>
    </CallsContext.Provider>
  );
}
