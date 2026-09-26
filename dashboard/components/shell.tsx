"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, clearToken, getToken, type Me } from "@/lib/api";
import { setBusinessZone } from "@/lib/format";
import { APP_VERSION, BUILD_ID } from "@/lib/version";
import { EnvironmentPrompt } from "./environment";
import { RouteProgress, startProgress } from "./route-progress";
import { UpdateNotice } from "./update-notice";
import {
  AssistantIcon,
  FinancialsIcon,
  HealthIcon,
  HomeIcon,
  LogoutIcon,
  PhoneIcon,
  SearchIcon,
  SettingsIcon,
  TasksIcon,
  TeamIcon,
} from "./icons";

// The rest of PestLaunch OS, shown for orientation. Only Calls is part of
// this build, so the others are visible but inactive.
const NAV = [
  { label: "Home", icon: HomeIcon },
  { label: "Tasks", icon: TasksIcon },
  { label: "Team", icon: TeamIcon },
  { label: "Assistant", icon: AssistantIcon },
  { label: "Financials", icon: FinancialsIcon },
  { label: "Calls", icon: PhoneIcon, href: "/calls" },
  { label: "Customer Health", icon: HealthIcon },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoneKey, setZoneKey] = useState(0);
  const bare = pathname.startsWith("/login");
  // The pipeline board fills the window height, so it needs less padding below.
  const wide = pathname.startsWith("/calls/pipeline");
  // Top-level area, e.g. "calls" or "settings": crossing between them fades in.
  const section = pathname.split("/")[1] ?? "";

  useEffect(() => {
    if (bare) {
      setReady(true);
      return;
    }
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
    api
      .get<Me>("/auth/me")
      .then((m) => {
        // First load for this browser: re-render the page in the business zone.
        if (setBusinessZone(m.business_timezone)) setZoneKey((k) => k + 1);
        setMe(m);
      })
      .catch(() => undefined);
  }, [bare, router]);

  useEffect(() => setMenuOpen(false), [pathname]);

  // 100vw includes the scrollbar; full-bleed layouts subtract it.
  useEffect(() => {
    const measure = () =>
      document.documentElement.style.setProperty(
        "--scrollbar",
        `${window.innerWidth - document.documentElement.clientWidth}px`,
      );
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  if (bare) {
    return (
      <>
        <RouteProgress />
        {children}
      </>
    );
  }
  if (!ready) return null;

  const company = me?.business_name || "PestLaunch";

  return (
    <div className="min-h-screen overflow-x-clip lg:pl-[244px]">
      <RouteProgress />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[244px] flex-col border-r border-hairline bg-[#f5f5f7]/80 px-3 pb-3 pt-5 backdrop-blur-2xl backdrop-saturate-150 transition-transform duration-300 lg:translate-x-0 ${
          menuOpen ? "translate-x-0 shadow-pop" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-ink text-[13px] font-semibold text-white">
            {company.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[14px] font-semibold tracking-tightish">{company}</p>
            <p className="text-[12px] text-muted">PestLaunch OS</p>
          </div>
        </div>

        <SearchBox />

        <nav className="mt-5 flex flex-1 flex-col gap-px" aria-label="Main">
          {NAV.map(({ label, icon: Icon, href }) => {
            const active = href && pathname.startsWith(href);
            if (!href) {
              return (
                <span
                  key={label}
                  role="link"
                  aria-disabled="true"
                  className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[14px] text-faint"
                  title="Not part of this build"
                >
                  <Icon />
                  {label}
                </span>
              );
            }
            return (
              <Link
                key={label}
                href={href}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[14px] ${
                  active ? "bg-black/[0.07] font-medium text-ink" : "text-ink hover:bg-black/[0.04]"
                }`}
              >
                <Icon />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-hairline pt-3">
          <Link
            href="/settings"
            className={`mb-1 flex items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[14px] ${
              pathname.startsWith("/settings") ? "bg-black/[0.07] font-medium text-ink" : "text-ink hover:bg-black/[0.04]"
            }`}
          >
            <SettingsIcon />
            Settings
          </Link>
          {me && <p className="truncate px-2.5 pb-1 pt-1 text-[12px] text-muted">{me.email}</p>}
          <p className="px-2.5 pb-1 text-[11px] text-faint" title={`Build ${BUILD_ID}`}>
            Version {APP_VERSION}
            {BUILD_ID !== "local" && <span className="tnum"> ({BUILD_ID})</span>}
          </p>
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[14px] text-muted hover:bg-black/[0.04] hover:text-ink"
            onClick={() => {
              clearToken();
              router.replace("/login");
            }}
          >
            <LogoutIcon />
            Sign out
          </button>
        </div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setMenuOpen(false)} />
      )}

      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-hairline bg-white/80 px-4 py-2.5 backdrop-blur-2xl lg:hidden">
        <button className="btn-ghost px-2" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-[15px] font-semibold tracking-tightish">{company}</span>
      </header>

      <UpdateNotice />
      <main
        className={`mx-auto w-full min-w-0 max-w-[1120px] px-4 pt-6 sm:px-8 lg:px-10 lg:pt-10 ${
          wide ? "pb-4" : "pb-20"
        }`}
      >
        <div key={`${section}:${zoneKey}`} className="animate-page-in">
          {children}
        </div>
      </main>
      <EnvironmentPrompt />
    </div>
  );
}

function SearchBox() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      className="relative mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        startProgress();
        router.push(`/calls/log${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
      }}
    >
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search calls"
        aria-label="Search calls"
        className="w-full rounded-[9px] border-0 bg-black/[0.05] py-[6px] pl-8 pr-10 text-[14px] placeholder:text-muted focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-accent/25"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-sans text-[11px] text-[#5e5e63]">
        ⌘K
      </kbd>
    </form>
  );
}
