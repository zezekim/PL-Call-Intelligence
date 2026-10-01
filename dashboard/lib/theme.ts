"use client";

/** Light by default; Dark and Automatic (follow the device) are chosen in Settings. */
export type Theme = "system" | "light" | "dark";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "dark" || t === "system" ? t : "light";
  } catch {
    return "light";
  }
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "light") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {
    // Still applied for this visit.
  }
}
