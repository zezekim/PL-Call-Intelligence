"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Fetch `path` and keep it fresh. `poll` re-fetches on an interval while it
 * returns true for the latest data - used while calls are still processing.
 */
export function useApi<T>(
  path: string | null,
  options: { poll?: (data: T) => boolean; interval?: number } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(options.poll);
  pollRef.current = options.poll;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const result = await api.get<T>(path);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!data || !pollRef.current?.(data)) return;
    const timer = window.setTimeout(() => void load(), options.interval ?? 4000);
    return () => window.clearTimeout(timer);
  }, [data, load, options.interval]);

  return { data, error, loading, reload: load, setData };
}

/** Sets the browser tab title for a page. */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · PestLaunch`;
  }, [title]);
}

export const IN_PROGRESS = new Set(["queued", "transcribing", "analyzing", "queued_analysis"]);
