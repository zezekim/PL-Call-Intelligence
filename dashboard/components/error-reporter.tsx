"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";

const MAX_REPORTS = 5;

/** Sends uncaught browser errors to the API, which logs them and forwards to Sentry. */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const report = (message: string, source = "") => {
      if (sent >= MAX_REPORTS || !message) return;
      sent += 1;
      void fetch(api.url("/client-errors"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.slice(0, 1000),
          source: source.slice(0, 300),
          path: window.location.pathname.slice(0, 300),
        }),
        keepalive: true,
      }).catch(() => undefined);
    };
    const onError = (e: ErrorEvent) => report(e.message, e.filename ? `${e.filename}:${e.lineno}` : "");
    const onRejection = (e: PromiseRejectionEvent) =>
      report(e.reason instanceof Error ? e.reason.message : String(e.reason), "unhandledrejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
