/** Types for the v2 owner views (`/intel/v2/*`). */

export type Status = "good" | "watch" | "bad" | "none";

export interface Action {
  label: string;
  href: string;
}

export interface PerformanceCard {
  key: "sales" | "retention" | "service" | "quality";
  label: string;
  question: string;
  metric_label: string;
  value: number | null;
  status: Status;
  target: number;
  change: number | null;
  detail: string;
  why: string;
  action: Action | null;
}

export interface Todo {
  kind: "retention" | "sales" | "service" | "follow_up";
  priority: number;
  title: string;
  why: string;
  cta: string;
  href: string;
  when: string | null;
}

export interface StepStat {
  step: string;
  key: string;
  quadrant: string;
  met: number;
  of: number;
  hit_rate: number;
  missed: number;
}

export interface CoachTip {
  call_id: string;
  ref: string | null;
  customer: string | null;
  rep: string | null;
  title: string;
  what_happened: string;
  try_saying: string;
  start: number | null;
}

export interface Brief {
  as_of: string;
  days: number | null;
  headline: { status: Status; title: string; detail: string };
  cards: PerformanceCard[];
  todo: Todo[];
  todo_total: number;
  coaching: {
    focus: StepStat;
    tip: CoachTip | null;
    reps: { rep: string; missed: number; of: number }[];
    strength: StepStat | null;
  } | null;
  review: { disputed_calls: number; type_checks: number };
  calls: { analyzed: number; processing: number; failed: number };
  receptionist_number: string | null;
}

export type Urgency = "overdue" | "today" | "cold" | "upcoming";

export interface PipelineLead {
  id: string;
  name: string;
  stage: string;
  stage_source: string;
  service: string | null;
  price_quoted: string | null;
  value: number | null;
  pests: string[];
  rep: string | null;
  last_call_id: string | null;
  last_contact_at: string | null;
  action: {
    label: string;
    why: string;
    promised: string | null;
    due_at: string | null;
    days_since_contact: number | null;
    urgency: Urgency;
  } | null;
}

export interface PipelineBoard {
  as_of: string;
  funnel: { stage: string; count: number }[];
  open: PipelineLead[];
  closed: PipelineLead[];
  summary: {
    open: number;
    needs_action: number;
    open_value: number;
    won: number;
    won_value: number;
    lost: number;
  };
}

export interface RepCard {
  id: string;
  name: string;
  calls: number;
  scored: number;
  score: number | null;
  status: Status;
  trend: "up" | "down" | "steady" | null;
  meeting_standard: number;
  close_rate: number | null;
  sales_calls: number;
  focus: StepStat | null;
  strengths: StepStat[];
}

export interface RepBrief extends RepCard {
  verdict: string;
  team_score: number | null;
  coach: CoachTip | null;
  strength_example: {
    call_id: string;
    ref: string | null;
    title: string;
    detail: string | null;
    quote: string | null;
    start: number | null;
  } | null;
  steps: StepStat[];
  calls_list: {
    call_id: string;
    ref: string | null;
    customer: string | null;
    when: string;
    score: number | null;
    grade: string | null;
    call_type: string;
    outcome: string | null;
  }[];
}

/** One meaning per colour: green good, amber below target, red a problem. */
export const STATUS_TEXT: Record<Status, string> = {
  good: "text-good",
  watch: "text-warn",
  bad: "text-bad",
  none: "text-muted",
};

export const STATUS_BG: Record<Status, string> = {
  good: "bg-good",
  watch: "bg-[#ff9f0a]",
  bad: "bg-bad",
  none: "bg-neutral",
};

export const STATUS_SOFT: Record<Status, string> = {
  good: "bg-good-soft",
  watch: "bg-warn-soft",
  bad: "bg-bad-soft",
  none: "bg-panel",
};

export const STATUS_WORD: Record<Status, string> = {
  good: "On target",
  watch: "Below target",
  bad: "Needs attention",
  none: "No data",
};

/** A hit rate judged the same way everywhere: done most of the time is good. */
export function rateStatus(rate: number | null | undefined): Status {
  if (rate === null || rate === undefined) return "none";
  if (rate >= 80) return "good";
  return rate >= 50 ? "watch" : "bad";
}

export const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
