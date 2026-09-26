"use client";

import { useEffect, useState } from "react";
import { BUILD_ID } from "@/lib/version";

const CHECK_EVERY_MS = 60_000;

/** Tells an open tab that a newer build is live. */
export function UpdateNotice() {
  const [latest, setLatest] = useState<{ version: string; build: string } | null>(null);

  useEffect(() => {
    if (BUILD_ID === "local") return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { version: string; build: string };
        if (!cancelled && data.build && data.build !== BUILD_ID) setLatest(data);
      } catch {
        /* offline or mid-deploy: try again on the next tick */
      }
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!latest) return null;
  return (
    <div className="sticky top-0 z-30 border-b border-hairline bg-surface/85 backdrop-blur-2xl" role="status">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-4 py-2.5 sm:px-8 lg:px-10">
        <p className="text-[14px]">
          <span className="font-medium">A new version of PestLaunch is available</span>
          <span className="text-muted"> · version {latest.version}</span>
        </p>
        <button className="btn-primary px-3.5 py-[5px] text-[13px]" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
