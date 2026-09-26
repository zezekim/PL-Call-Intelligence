import type { Config } from "tailwindcss";

/**
 * System grays, one blue, hairline separators. Status colours are reserved
 * for good / attention / problem and always sit beside a text label. Every
 * text colour below clears 4.5:1 on its surface except `faint`, which is
 * only used for non-essential metadata.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d1d1f",
        muted: "#6e6e73",
        faint: "#707075",
        line: "#e5e5ea",
        hairline: "rgba(0,0,0,0.08)",
        canvas: "#f5f5f7",
        panel: "#f5f5f7",
        fill: "#e8e8ed",
        accent: "#0071e3",
        link: "#0066cc",
        "accent-soft": "#e8f1fd",
        good: "#1a7f37",
        "good-soft": "#e9f6ec",
        warn: "#b25000",
        "warn-soft": "#fff4e5",
        bad: "#c9001e",
        "bad-soft": "#fdecee",
        gold: "#8a6a00",
        "gold-soft": "#fbf5e2",
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 1px rgba(0,0,0,0.02), 0 2px 8px rgba(0,0,0,0.03)",
        pop: "0 20px 60px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.06)",
        thumb: "0 1px 3px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.04)",
      },
      borderRadius: {
        card: "18px",
      },
      letterSpacing: {
        tightish: "-0.011em",
        title: "-0.022em",
      },
    },
  },
  plugins: [],
} satisfies Config;
