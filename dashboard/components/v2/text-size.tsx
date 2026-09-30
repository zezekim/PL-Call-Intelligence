"use client";

import { createContext, useContext } from "react";

/**
 * Small is the compact v2 layout; Normal and Larger are the accessible layout
 * (Larger also zooms it). Wording is plain in all three.
 */
export type TextSize = "small" | "normal" | "large";

export const TextSizeContext = createContext<{ size: TextSize; setSize: (s: TextSize) => void }>({
  size: "normal",
  setSize: () => undefined,
});

export const useTextSize = () => useContext(TextSizeContext);

export const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Larger" },
];

/** Tells parts of the page outside v2 (the sidebar) which size is chosen. */
export const TEXT_SIZE_EVENT = "pestlaunch:textsize";
export const TEXT_SIZE_KEY = "pestlaunch.textsize";

export function readTextSize(): TextSize {
  try {
    const s = window.localStorage.getItem(TEXT_SIZE_KEY);
    if (s === "small" || s === "normal" || s === "large") return s;
  } catch {
    /* storage unavailable */
  }
  return "normal";
}
