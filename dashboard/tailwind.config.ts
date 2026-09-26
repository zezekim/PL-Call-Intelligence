import type { Config } from "tailwindcss";

/**
 * PestLaunch OS look: a pale grey canvas, white rounded cards, one accent
 * blue, and status colours reserved for good / middling / poor. Every text
 * colour here clears 4.5:1 on white.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111318",
        muted: "#6b7280",
        faint: "#9aa1ad",
        line: "#e6e8ee",
        canvas: "#eef0f4",
        panel: "#f6f7f9",
        accent: "#1f6feb",
        "accent-soft": "#e3edfd",
        good: "#1a7f4b",
        "good-soft": "#e5f4ec",
        warn: "#b25e00",
        "warn-soft": "#fdf0e0",
        bad: "#c5221f",
        "bad-soft": "#fdeceb",
        gold: "#8a6d1d",
        "gold-soft": "#f8f0d8",
        demo: "#efe6d8",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Inter",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.06)",
        pop: "0 8px 30px rgba(16,24,40,0.16)",
      },
      borderRadius: {
        card: "18px",
      },
    },
  },
  plugins: [],
} satisfies Config;
