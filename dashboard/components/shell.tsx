"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, clearToken, getToken, type Me } from "@/lib/api";
import {
  AssistantIcon,
  FinancialsIcon,
  HealthIcon,
  HomeIcon,
  LogoutIcon,
  PhoneIcon,
  SearchIcon,
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
  const bare = pathname.startsWith("/login");

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
      .then(setMe)
      .catch(() => undefined);
  }, [bare, router]);

  useEffect(() => setMenuOpen(false), [pathname]);

  if (bare) return <>{children}</>;
  if (!ready) return null;

  const company = me?.business_name || "PestLaunch";

  return (
    <div className="min-h-screen lg:pl-[248px]">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-line bg-white px-3 py-4 transition-transform lg:translate-x-0 ${
          menuOpen ? "translate-x-0 shadow-pop" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent text-sm font-bold text-white">
            {company.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{company} OS</p>
            <p className="text-[11px] text-muted">Powered by PestLaunch</p>
          </div>
        </div>

        <SearchBox />

        <nav className="mt-4 flex flex-1 flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ label, icon: Icon, href }) => {
            const active = href && pathname.startsWith(href);
            if (!href) {
              return (
                <span
                  key={label}
                  className="flex cursor-default items-center gap-3 rounded-xl px-3 py-2 text-sm text-faint"
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
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${
                  active ? "bg-accent-soft text-accent" : "text-ink hover:bg-panel"
                }`}
              >
                <Icon />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line pt-3">
          {me && <p className="truncate px-3 pb-1 text-xs text-muted">{me.email}</p>}
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted hover:bg-panel hover:text-ink"
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

      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <button className="btn-ghost px-2" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-sm font-semibold">{company} OS</span>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        {children}
      </main>
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
      className="relative mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/calls/log${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
      }}
    >
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search calls"
        aria-label="Search calls"
        className="w-full rounded-xl border border-line bg-panel py-2 pl-9 pr-10 text-sm placeholder:text-faint focus:border-accent focus:bg-white"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-line bg-white px-1.5 text-[10px] text-muted">
        ⌘K
      </kbd>
    </form>
  );
}
