import type { Config } from "tailwindcss";

/**
 * System grays, one blue, hairline separators. Status colours are reserved
 * for good / attention / problem and always sit beside a text label. Every
 * text colour clears 4.5:1 (WCAG AA) on its surface in both themes.
 *
 * Values live in globals.css as RGB channels so light and dark themes swap
 * them in one place and opacity modifiers (`bg-accent/40`) keep working.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "ink": "rgb(var(--ink) / <alpha-value>)",
        "muted": "rgb(var(--muted) / <alpha-value>)",
        "faint": "rgb(var(--faint) / <alpha-value>)",
        "subtle": "rgb(var(--subtle) / <alpha-value>)",
        "line": "rgb(var(--line) / <alpha-value>)",
        "canvas": "rgb(var(--canvas) / <alpha-value>)",
        "panel": "rgb(var(--panel) / <alpha-value>)",
        "fill": "rgb(var(--fill) / <alpha-value>)",
        "fill-hover": "rgb(var(--fill-hover) / <alpha-value>)",
        "fill-active": "rgb(var(--fill-active) / <alpha-value>)",
        "surface": "rgb(var(--surface) / <alpha-value>)",
        "surface-hover": "rgb(var(--surface-hover) / <alpha-value>)",
        "thumb": "rgb(var(--thumb) / <alpha-value>)",
        "bubble": "rgb(var(--bubble) / <alpha-value>)",
        "highlight": "rgb(var(--highlight) / <alpha-value>)",
        "neutral": "rgb(var(--neutral) / <alpha-value>)",
        "control": "rgb(var(--control) / <alpha-value>)",
        "accent": "rgb(var(--accent) / <alpha-value>)",
        "link": "rgb(var(--link) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        "good": "rgb(var(--good) / <alpha-value>)",
        "good-soft": "rgb(var(--good-soft) / <alpha-value>)",
        "warn": "rgb(var(--warn) / <alpha-value>)",
        "warn-soft": "rgb(var(--warn-soft) / <alpha-value>)",
        "bad": "rgb(var(--bad) / <alpha-value>)",
        "bad-soft": "rgb(var(--bad-soft) / <alpha-value>)",
        "gold": "rgb(var(--gold) / <alpha-value>)",
        "gold-soft": "rgb(var(--gold-soft) / <alpha-value>)",
        hairline: "var(--hairline)",
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
      keyframes: {
        "toast-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "none" },
        },
        "menu-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "toast-in": "toast-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "menu-in": "menu-in 140ms ease-out",
      },
      letterSpacing: {
        tightish: "-0.011em",
        title: "-0.022em",
      },
    },
  },
  plugins: [],
} satisfies Config;
