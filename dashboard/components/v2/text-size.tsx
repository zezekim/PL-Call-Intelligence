"use client";

import { createContext, useContext } from "react";

/**
 * Small is the compact v2 layout; Normal and Larger are the accessible layout
 * (Larger also zooms it). Wording is plain in all three.
 */
export type TextSize = "small" | "normal" | "large";

export const TextSizeContext = createContext<{ size: TextSize; setSize: (s: TextSize) => void }>({
  size: "small",
  setSize: () => undefined,
});

export const useTextSize = () => useContext(TextSizeContext);

export const TEXT_SIZES: { value: TextSize; label: string; glyph: string }[] = [
  { value: "small", label: "Small text", glyph: "text-[13px]" },
  { value: "normal", label: "Normal text", glyph: "text-[17px]" },
  { value: "large", label: "Larger text", glyph: "text-[21px]" },
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
  // Small (the compact layout) unless the viewer chose otherwise.
  return "small";
}
