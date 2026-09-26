"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, responseCache } from "./api";

/**
 * Fetch `path` and keep it fresh. `poll` re-fetches on an interval while it
 * returns true for the latest data - used while calls are still processing.
 */
export function useApi<T>(
  path: string | null,
  options: { poll?: (data: T) => boolean; interval?: number } = {},
) {
  // A page visited before shows its last data at once and refreshes quietly,
  // so moving between tabs never flashes a loading state.
  const cached = path ? (responseCache.get(path) as T | undefined) : undefined;
  const [data, setDataState] = useState<T | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cached === undefined);
  const pollRef = useRef(options.poll);
  pollRef.current = options.poll;

  const setData = useCallback(
    (value: T | null) => {
      if (path && value !== null) responseCache.set(path, value);
      setDataState(value);
    },
    [path],
  );

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const result = await api.get<T>(path);
      responseCache.set(path, result);
      setDataState(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    const hit = path ? (responseCache.get(path) as T | undefined) : undefined;
    setDataState(hit ?? null);
    setLoading(hit === undefined);
    void load();
  }, [load, path]);

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
