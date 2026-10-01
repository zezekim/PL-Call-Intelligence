"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { dateTime } from "@/lib/format";
import { CallsContext } from "@/components/calls-context";
import { startProgress } from "@/components/route-progress";
import { ENVIRONMENTS, EnvironmentDialog, useEnvironment } from "@/components/environment";
import { RefreshIcon, UploadIcon } from "@/components/icons";
import { Segmented } from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";

type Range = "7" | "30" | "all";

const TABS = [
  { href: "/calls", label: "Overview" },
  { href: "/calls/pipeline", label: "Pipeline" },
  { href: "/calls/reps", label: "Reps" },
  { href: "/calls/log", label: "Call Log" },
];

const RANGE_KEY = "pestlaunch.range";

/** The same page in v2. */
function v2Of(pathname: string): string {
  if (pathname === "/calls") return "/v2";
  if (pathname === "/calls/log") return "/v2/calls";
  const rest = pathname.replace(/^\/calls/, "");
  if (rest === "/pipeline" || rest.startsWith("/reps")) return `/v2${rest}`;
  return `/v2/calls${rest}`;
}

function V2Banner({ pathname }: { pathname: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-accent-soft px-4 py-2.5 text-[13px] print:hidden">
      <p className="text-ink/80">
        <span className="font-semibold text-ink">You're viewing version 1.</span> A simpler version 2 of this page is
        ready.
      </p>
      <Link href={v2Of(pathname)} className="font-medium text-link hover:underline">
        Open this page in v2 ›
      </Link>
    </div>
  );
}

export default function CallsLayout({ children }: { children: React.ReactNode }) {
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

  const isTab = TABS.some((t) => t.href === pathname);
  const active = TABS.find((t) => t.href === pathname)?.href;

  return (
    <CallsContext.Provider value={{ days, refreshKey, query }}>
      <V2Banner pathname={pathname} />
      {isTab && (
        <div className="mb-8">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <h1 className="large-title">Calls</h1>
              <p className="footnote mt-1.5">
                {range === "all" ? "All calls" : `Last ${range} days`} · updated {dateTime(asOf)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setEnvOpen(true)}
                className="btn-secondary gap-2 px-3.5"
                title="Change environment"
              >
                <span className={`h-[7px] w-[7px] rounded-full ${env === "local" ? "bg-[#ff9f0a]" : "bg-[#30d158]"}`} />
                {ENVIRONMENTS.find((e) => e.value === env)?.label}
              </button>
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
              <button
                className="btn-secondary px-3"
                aria-label="Refresh"
                title="Refresh"
                onClick={() => {
                  setRefreshKey((k) => k + 1);
                  setAsOf(new Date().toISOString());
                }}
              >
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
                  aria-selected={active === t.href}
                  className={`flex-1 whitespace-nowrap rounded-[7px] px-2 py-[5px] text-center text-[13px] font-medium transition-all duration-150 sm:flex-none sm:px-4 ${
                    active === t.href ? "bg-thumb text-ink shadow-thumb" : "text-ink/70 hover:text-ink"
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
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setRefreshKey((k) => k + 1);
          setAsOf(new Date().toISOString());
        }}
      />
      <EnvironmentDialog open={envOpen} onClose={() => setEnvOpen(false)} />
    </CallsContext.Provider>
  );
}
