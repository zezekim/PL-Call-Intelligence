"use client";

import { createContext, useContext } from "react";

export interface CallsState {
  days: number | null;
  refreshKey: number;
  /** Append the selected time range to an API path. */
  query: (path: string) => string;
}

export const CallsContext = createContext<CallsState>({
  days: null,
  refreshKey: 0,
  query: (p) => p,
});

export const useCalls = () => useContext(CallsContext);
