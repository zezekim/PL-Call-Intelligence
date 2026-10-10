"use client";

import { useEffect, useState } from "react";

/**
 * One design at three sizes. The whole v2 app (sidebar included) is scaled
 * uniformly, like the system text-size setting on a Mac or iPhone, so every
 * element keeps its place and only gets bigger.
 */
export type TextSize = "small" | "normal" | "large";

export const TEXT_SIZES: { value: TextSize; label: string; zoom: number; glyph: string }[] = [
  { value: "small", label: "Smaller text", zoom: 1, glyph: "text-[11px]" },
  { value: "normal", label: "Normal text", zoom: 1.1, glyph: "text-[14px]" },
  { value: "large", label: "Larger text", zoom: 1.25, glyph: "text-[17px]" },
];

const KEY = "pestlaunch.textsize";
const EVENT = "pestlaunch:textsize";

function read(): TextSize {
  try {
    const s = window.localStorage.getItem(KEY);
    if (s === "small" || s === "normal" || s === "large") return s;
  } catch {
    /* storage unavailable */
  }
  // Easy to read out of the box; smaller is a choice, not the default.
  return "normal";
}

export function useTextSize(): [TextSize, (s: TextSize) => void] {
  const [size, setSize] = useState<TextSize>("normal");
  useEffect(() => {
    const sync = () => setSize(read());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const choose = (s: TextSize) => {
    try {
      window.localStorage.setItem(KEY, s);
    } catch {
      /* still applied for this visit */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [size, choose];
}

/** Applies the chosen size to the page while `active` (the v2 routes). */
export function useTextZoom(active: boolean) {
  const [size] = useTextSize();
  useEffect(() => {
    const root = document.documentElement;
    const zoom = active ? TEXT_SIZES.find((t) => t.value === size)?.zoom ?? 1 : 1;
    root.style.zoom = zoom === 1 ? "" : String(zoom);
    return () => {
      root.style.zoom = "";
    };
  }, [active, size]);
}

/** Three "A"s, each drawn at the size it gives. */
export function TextSizePicker() {
  const [size, choose] = useTextSize();
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1" role="radiogroup" aria-label="Text size">
      <span className="text-[14px] text-ink/80">Text size</span>
      <div className="flex rounded-[8px] bg-fill p-[2px]">
        {TEXT_SIZES.map((t) => (
          <button
            key={t.value}
            role="radio"
            aria-checked={size === t.value}
            aria-label={t.label}
            title={t.label}
            onClick={() => choose(t.value)}
            className={`flex h-6 w-8 items-center justify-center rounded-[6px] font-semibold leading-none transition-colors ${t.glyph} ${
              size === t.value ? "bg-thumb text-ink shadow-thumb" : "text-ink/60 hover:text-ink"
            }`}
          >
            A
          </button>
        ))}
      </div>
    </div>
  );
}
