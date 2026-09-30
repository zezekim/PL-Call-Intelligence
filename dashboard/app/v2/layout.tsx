"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { dateTime } from "@/lib/format";
import { CallsContext } from "@/components/calls-context";
import { ENVIRONMENTS, EnvironmentDialog, useEnvironment } from "@/components/environment";
import { RefreshIcon, UploadIcon } from "@/components/icons";
import { Segmented } from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { bigButton } from "@/components/v2/kit";
import {
  TEXT_SIZES,
  TEXT_SIZE_EVENT,
  TEXT_SIZE_KEY,
  type TextSize,
  TextSizeContext,
  readTextSize,
} from "@/components/v2/text-size";

type Range = "7" | "30" | "all";

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

export default function V2Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [range, setRange] = useState<Range>("all");
  const [size, setSizeState] = useState<TextSize>("small");
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [asOf, setAsOf] = useState(() => new Date().toISOString());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RANGE_KEY) as Range | null;
      if (saved === "7" || saved === "30" || saved === "all") setRange(saved);
      setSizeState(readTextSize());
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
  const setSize = (s: TextSize) => {
    setSizeState(s);
    remember(TEXT_SIZE_KEY, s);
    window.dispatchEvent(new Event(TEXT_SIZE_EVENT));
  };
  const changeRange = (v: Range) => {
    setRange(v);
    remember(RANGE_KEY, v);
  };

  const days = range === "all" ? null : Number(range);
  const query = useCallback(
    (path: string) => (days ? `${path}${path.includes("?") ? "&" : "?"}days=${days}` : path),
    [days],
  );
  const refresh = () => {
    setRefreshKey((k) => k + 1);
    setAsOf(new Date().toISOString());
  };

  const tab = TABS.find((t) => t.href === pathname);
  // The call-back list shows open deals whatever the period, so it has no range.
  const ranged = !!tab && tab.href !== "/v2/pipeline";
  const header = { tab, ranged, range, changeRange, asOf, refresh };

  return (
    <TextSizeContext.Provider value={{ size, setSize }}>
      <CallsContext.Provider value={{ days, refreshKey, query }}>
        {/* The same slim bar in every mode and never zoomed, so the picker
            stays exactly where it was clicked while the page below changes. */}
        <div className="mb-6 flex min-h-[40px] flex-wrap items-center justify-between gap-3">
          <Link
            href={tab?.v1 ?? "/calls"}
            className="text-[14px] font-medium text-ink underline decoration-accent decoration-2 underline-offset-4"
          >
            You are on the new version · see the old one
          </Link>
          <SizeSwitch size={size} setSize={setSize} />
        </div>
        {/* Larger text scales the page, so nothing gets cut off. */}
        <div style={size === "large" ? { zoom: 1.2 } : undefined}>
          {size === "small" ? (
            <CompactHeader {...header} onUpload={() => setUploadOpen(true)} onEnv={() => setEnvOpen(true)} />
          ) : (
            <EasyHeader {...header} onUpload={() => setUploadOpen(true)} />
          )}
          <div key={`${pathname}:${size}`} className="animate-page-in">
            {children}
          </div>
        </div>
        <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} logHref="/v2/calls" />
        <EnvironmentDialog open={envOpen} onClose={() => setEnvOpen(false)} />
      </CallsContext.Provider>
    </TextSizeContext.Provider>
  );
}

interface HeaderProps {
  tab: (typeof TABS)[number] | undefined;
  ranged: boolean;
  range: Range;
  changeRange: (r: Range) => void;
  asOf: string;
  refresh: () => void;
  onUpload: () => void;
}

// --- Small: the compact layout ------------------------------------------------------

function CompactHeader({
  tab,
  ranged,
  range,
  changeRange,
  asOf,
  refresh,
  onUpload,
  onEnv,
}: HeaderProps & { onEnv: () => void }) {
  const pathname = usePathname();
  const { env } = useEnvironment();
  return (
    <div className="mb-7">
      {tab && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <h1 className="large-title">{tab.title}</h1>
              <p className="footnote mt-1.5">
                {ranged ? (range === "all" ? "All calls" : `Last ${range} days`) : "People who haven't decided"} ·
                updated {dateTime(asOf)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={onEnv} className="btn-secondary gap-2 px-3.5" title="Change environment">
                <span className={`h-[7px] w-[7px] rounded-full ${env === "local" ? "bg-[#ff9f0a]" : "bg-[#30d158]"}`} />
                {ENVIRONMENTS.find((e) => e.value === env)?.label}
              </button>
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
              <button className="btn-secondary px-3" aria-label="Refresh" title="Refresh" onClick={refresh}>
                <RefreshIcon className="h-4 w-4" />
              </button>
              <button className="btn-primary" onClick={onUpload}>
                <UploadIcon className="h-4 w-4" />
                Upload
              </button>
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
                  className={`flex-1 whitespace-nowrap rounded-[7px] px-2 py-[5px] text-center text-[13px] font-medium transition-all duration-150 sm:flex-none sm:px-4 ${
                    pathname === t.href ? "bg-thumb text-ink shadow-thumb" : "text-ink/70 hover:text-ink"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// --- Normal and Larger: the accessible layout ---------------------------------------------

function EasyHeader({ tab, ranged, range, changeRange, onUpload }: HeaderProps) {
  const pathname = usePathname();
  return (
    <>
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
      </div>

      {tab && (
        <header className="mb-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-3xl">
              <h1 className="text-[40px] font-bold leading-tight tracking-title">{tab.title}</h1>
              <p className="mt-2 text-[20px] leading-relaxed text-ink/80">{tab.intro}</p>
            </div>
            <button className={bigButton.primary} onClick={onUpload}>
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
                  onChange={(e) => changeRange(e.target.value as Range)}
                >
                  <option value="all">All time</option>
                  <option value="30">The last 30 days</option>
                  <option value="7">The last 7 days</option>
                </select>
              </label>
            )}
          </div>
        </header>
      )}
    </>
  );
}

/** Three "A"s, each drawn at the size it gives: small, but obvious. */
function SizeSwitch({ size, setSize }: { size: TextSize; setSize: (s: TextSize) => void }) {
  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label="Text size">
      <span className="text-[14px] font-medium text-ink/80">Text size</span>
      <div className="flex h-10 items-center rounded-full bg-fill p-1">
        {TEXT_SIZES.map((s) => (
          <button
            key={s.value}
            role="radio"
            aria-checked={size === s.value}
            aria-label={s.label}
            title={s.label}
            onClick={() => setSize(s.value)}
            className={`flex h-8 w-10 items-center justify-center rounded-full font-semibold leading-none transition-colors ${s.glyph} ${
              size === s.value ? "bg-surface text-ink shadow-thumb" : "text-ink/70 hover:text-ink"
            }`}
          >
            A
          </button>
        ))}
      </div>
    </div>
  );
}
