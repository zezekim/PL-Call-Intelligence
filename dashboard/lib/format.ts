import type { Grade } from "./api";

export function duration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function clock(seconds: number | null | undefined): string {
  return duration(seconds);
}

export function date(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function pct(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined ? "-" : `${value.toFixed(digits)}%`;
}

export const GRADE_LABEL: Record<Grade, string> = {
  gold: "Gold",
  green: "Green",
  below: "Below standard",
};

/** Health colour for a percentage, by thresholds that fit the metric. */
export function tone(
  value: number | null | undefined,
  good: number,
  ok: number,
): "good" | "warn" | "bad" | "none" {
  if (value === null || value === undefined) return "none";
  if (value >= good) return "good";
  if (value >= ok) return "warn";
  return "bad";
}

export const TONE_TEXT = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  none: "text-ink",
} as const;

export const OUTCOME_LABEL: Record<string, string> = {
  sold: "Sold",
  follow_up: "Follow-up",
  not_sold: "Not sold",
  saved: "Saved",
  cancelled: "Cancelled",
  pending: "Pending",
  resolved: "Resolved",
  partially: "Partly resolved",
  unresolved: "Unresolved",
  not_applicable: "-",
};

export const OUTCOME_TONE: Record<string, "good" | "warn" | "bad" | "none"> = {
  sold: "good",
  saved: "good",
  resolved: "good",
  follow_up: "warn",
  pending: "warn",
  partially: "warn",
  not_sold: "bad",
  cancelled: "bad",
  unresolved: "bad",
};

export const CANCEL_REASON: Record<string, string> = {
  price: "Price",
  moving: "Moving",
  service_quality: "Service quality",
  pests_persist: "Pests still present",
  no_longer_needed: "No longer needed",
  switching_provider: "Switching provider",
  financial_hardship: "Financial hardship",
  technician_issue: "Technician issue",
  scheduling_issue: "Scheduling issue",
  deceased: "Deceased",
  other: "Other",
};

export const OFFER_LABEL: Record<string, string> = {
  free_reservice: "Free re-service",
  back_to_back_services: "Back-to-back services",
  custom_service_plan: "Custom plan",
  waive_payment: "Waived payment",
  set_day_time_technician: "Set day / time / tech",
  account_hold: "Account hold",
  service_manager_visit: "Service manager visit",
  branch_manager_visit: "Branch manager visit",
  price_drop: "10% price drop",
  other: "Other offer",
};

export const CALL_TYPES: { value: string; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "retention", label: "Retention" },
  { value: "reservice", label: "Re-service" },
  { value: "scheduling", label: "Scheduling" },
  { value: "billing", label: "Billing" },
  { value: "other_service", label: "Customer service" },
  { value: "not_scorable", label: "Not scored" },
];

export const STAGES: { value: string; label: string }[] = [
  { value: "new", label: "New lead" },
  { value: "quoted", label: "Quoted" },
  { value: "follow_up", label: "Follow-up" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(text: string): string {
  return text.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
