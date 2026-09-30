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

type Range = "7" | "30" | "all";

const TABS = [
  { href: "/v2", label: "Today", title: "Today", v1: "/calls" },
  { href: "/v2/pipeline", label: "Call back", title: "People to call back", v1: "/calls/pipeline" },
  { href: "/v2/reps", label: "Team", title: "Your team", v1: "/calls/reps" },
  { href: "/v2/calls", label: "All calls", title: "All calls", v1: "/calls/log" },
];

const RANGE_KEY = "pestlaunch.range";

export default function V2Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [range, setRange] = useState<Range>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const { env } = useEnvironment();
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
  const refresh = () => {
    setRefreshKey((k) => k + 1);
    setAsOf(new Date().toISOString());
  };

  const tab = TABS.find((t) => t.href === pathname);
  // The call-back list shows everyone still deciding, whatever the period.
  const ranged = tab && tab.href !== "/v2/pipeline";

  return (
    <CallsContext.Provider value={{ days, refreshKey, query }}>
      {tab && (
        <div className="mb-7">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="large-title">{tab.title}</h1>
                <Link
                  href={tab.v1}
                  className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-link hover:underline"
                  title="This is the new version. Open the old one."
                >
                  v2 · see v1
                </Link>
              </div>
              <p className="footnote mt-1.5">
                {ranged ? (range === "all" ? "All calls" : `Last ${range} days`) : "Everyone still deciding"} · updated{" "}
                {dateTime(asOf)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setEnvOpen(true)} className="btn-secondary gap-2 px-3.5" title="Change environment">
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
              <button className="btn-primary" onClick={() => setUploadOpen(true)}>
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
        </div>
      )}
      <div key={pathname} className="animate-page-in">
        {children}
      </div>
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} logHref="/v2/calls" />
      <EnvironmentDialog open={envOpen} onClose={() => setEnvOpen(false)} />
    </CallsContext.Provider>
  );
}
