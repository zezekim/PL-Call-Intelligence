"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CallsContext } from "@/components/calls-context";
import { UploadIcon } from "@/components/icons";
import { UploadDialog } from "@/components/upload-dialog";
import { bigButton, easyLink } from "@/components/v2/kit";

type Range = "7" | "30" | "all";
type Size = "normal" | "large";

const TABS = [
  {
    href: "/v2",
    label: "Today",
    icon: "☀︎",
    title: "Today",
    intro: "How the business is doing, and what to do first.",
    v1: "/calls",
  },
  {
    href: "/v2/pipeline",
    label: "Call back",
    icon: "☎︎",
    title: "People to call back",
    intro: "These people asked about a service but have not said yes or no. Call them, then tell us what they said.",
    v1: "/calls/pipeline",
  },
  {
    href: "/v2/reps",
    label: "Team",
    icon: "☺︎",
    title: "Your team",
    intro: "How each person handles calls, and what to teach them next.",
    v1: "/calls/reps",
  },
  {
    href: "/v2/calls",
    label: "All calls",
    icon: "☰",
    title: "All calls",
    intro: "Every call we have listened to. Tap a call to hear it and see how it went.",
    v1: "/calls/log",
  },
];

const RANGE_KEY = "pestlaunch.range";
const SIZE_KEY = "pestlaunch.textsize";

export default function V2Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [range, setRange] = useState<Range>("all");
  const [size, setSize] = useState<Size>("normal");
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RANGE_KEY) as Range | null;
      if (saved === "7" || saved === "30" || saved === "all") setRange(saved);
      if (window.localStorage.getItem(SIZE_KEY) === "large") setSize("large");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const remember = (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  };

  const days = range === "all" ? null : Number(range);
  const query = useCallback(
    (path: string) => (days ? `${path}${path.includes("?") ? "&" : "?"}days=${days}` : path),
    [days],
  );
  const refresh = () => setRefreshKey((k) => k + 1);

  const tab = TABS.find((t) => t.href === pathname);
  const ranged = tab && tab.href !== "/v2/pipeline";

  return (
    <CallsContext.Provider value={{ days, refreshKey, query }}>
      {/* Larger text scales the whole page, so nothing gets cut off. */}
      <div style={size === "large" ? { zoom: 1.2 } : undefined}>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Calls sections" className="flex flex-wrap gap-2">
            {TABS.map((t) => {
              const active = t.href === pathname || (t.href !== "/v2" && pathname.startsWith(t.href));
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-[52px] items-center gap-2 rounded-full px-5 text-[18px] font-semibold transition-colors ${
                    active ? "bg-ink text-canvas" : "bg-fill text-ink hover:bg-fill-hover"
                  }`}
                >
                  <span aria-hidden className="text-[20px]">
                    {t.icon}
                  </span>
                  {t.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2" role="group" aria-label="Text size">
            <span className="text-[16px] font-medium text-ink/80">Text size</span>
            {(["normal", "large"] as Size[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSize(s);
                  remember(SIZE_KEY, s);
                }}
                aria-pressed={size === s}
                className={`min-h-[44px] rounded-full px-4 font-semibold transition-colors ${
                  s === "large" ? "text-[20px]" : "text-[16px]"
                } ${size === s ? "bg-ink text-canvas" : "bg-fill text-ink hover:bg-fill-hover"}`}
              >
                {s === "normal" ? "Normal" : "Larger"}
              </button>
            ))}
          </div>
        </div>

        {tab && (
          <header className="mb-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-3xl">
                <h1 className="text-[40px] font-bold leading-tight tracking-title">{tab.title}</h1>
                <p className="mt-2 text-[20px] leading-relaxed text-ink/80">{tab.intro}</p>
              </div>
              <button className={bigButton.primary} onClick={() => setUploadOpen(true)}>
                <UploadIcon className="h-5 w-5" />
                Add call recordings
              </button>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
              {ranged && (
                <label className="inline-flex items-center gap-3 text-[18px] font-medium">
                  Show calls from
                  <select
                    className="min-h-[48px] rounded-xl border-2 border-line bg-surface px-4 text-[18px] font-semibold text-ink"
                    value={range}
                    onChange={(e) => {
                      const v = e.target.value as Range;
                      setRange(v);
                      remember(RANGE_KEY, v);
                    }}
                  >
                    <option value="all">All time</option>
                    <option value="30">The last 30 days</option>
                    <option value="7">The last 7 days</option>
                  </select>
                </label>
              )}
              <Link href={tab.v1} className={`text-[17px] ${easyLink}`}>
                Switch to the old version
              </Link>
            </div>
          </header>
        )}

        <div key={pathname} className="animate-page-in">
          {children}
        </div>
      </div>
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} logHref="/v2/calls" />
    </CallsContext.Provider>
  );
}
