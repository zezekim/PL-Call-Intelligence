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
  count: number;
  of: number;
  goal: string;
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
  /** Everyday name, e.g. "Explain the plan". */
  plain: string;
  meaning: string;
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
  watch: "bg-warn",
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
  good: "Good",
  watch: "Could be better",
  bad: "Needs work",
  none: "Not enough calls yet",
};

/** A hit rate judged the same way everywhere: done most of the time is good. */
export function rateStatus(rate: number | null | undefined): Status {
  if (rate === null || rate === undefined) return "none";
  if (rate >= 80) return "good";
  return rate >= 50 ? "watch" : "bad";
}

export const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// What the analysis writes when the caller never said their name.
const NO_NAME = new Set([
  "unknown", "unknown caller", "unknown customer", "not given", "not provided", "not stated",
  "not mentioned", "n/a", "na", "none", "null", "caller", "customer", "anonymous", "unnamed", "-",
]);

/** A customer's name, or null when the call never gave one. */
export function personName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim().replace(/^["'.]+|["'.]+$/g, "");
  return name && !NO_NAME.has(name.toLowerCase()) ? name : null;
}

// Everyday pest names, longest first so "fire ants" wins over "ants".
const PESTS: [RegExp, string][] = [
  [/\bfire ants?\b/, "fire ants"],
  [/\bcarpenter ants?\b/, "carpenter ants"],
  [/\bbed ?bugs?\b/, "bed bugs"],
  [/\bstink ?bugs?\b/, "stink bugs"],
  [/\byellow ?jackets?\b/, "yellow jackets"],
  [/\b(cock)?roach(es)?\b/, "roaches"],
  [/\bants?\b/, "ants"],
  [/\btermites?\b/, "termites"],
  [/\b(mice|mouse)\b/, "mice"],
  [/\brats?\b/, "rats"],
  [/\brodents?\b/, "rodents"],
  [/\bspiders?\b/, "spiders"],
  [/\bscorpions?\b/, "scorpions"],
  [/\bwasps?\b/, "wasps"],
  [/\bhornets?\b/, "hornets"],
  [/\bbees?\b/, "bees"],
  [/\bmosquito(e?s)?\b/, "mosquitoes"],
  [/\bticks?\b/, "ticks"],
  [/\bfleas?\b/, "fleas"],
  [/\bcrickets?\b/, "crickets"],
  [/\bsilverfish\b/, "silverfish"],
  [/\bearwigs?\b/, "earwigs"],
  [/\bcentipedes?\b/, "centipedes"],
  [/\bmillipedes?\b/, "millipedes"],
  [/\bbeetles?\b/, "beetles"],
  [/\bmoths?\b/, "moths"],
  [/\bflies\b|\bfly\b/, "flies"],
  [/\bsquirrels?\b/, "squirrels"],
  [/\braccoons?\b/, "raccoons"],
  [/\bsnakes?\b/, "snakes"],
  [/\bbats?\b/, "bats"],
  [/\bbirds?\b/, "birds"],
  [/\b(moles?|voles?|gophers?)\b/, "moles"],
  [/\bweeds?\b/, "weeds"],
];

/**
 * Short, everyday pest names from what the analysis wrote, which can be a
 * phrase ("ants, described by the caller as possibly fire ants").
 */
export function cleanPests(raw: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const entry of raw ?? []) {
    let text = entry.toLowerCase();
    let found = false;
    for (const [re, name] of PESTS) {
      if (re.test(text)) {
        found = true;
        if (!out.includes(name)) out.push(name);
        text = text.replace(new RegExp(re.source, "g"), " ");
      }
    }
    // Something we don't know by name: keep it only if it's short.
    const short = entry.trim().toLowerCase();
    if (!found && short && short.split(/\s+/).length <= 2 && !out.includes(short)) out.push(short);
  }
  // A general name says less than a specific one beside it ("fire ants" over "ants").
  const general: [string, string[]][] = [
    ["ants", ["fire ants", "carpenter ants"]],
    ["rodents", ["mice", "rats"]],
  ];
  return out.filter((p) => !general.some(([g, specific]) => p === g && specific.some((x) => out.includes(x))));
}

/** The first sentence, and whether there was more. */
export function firstSentence(text: string): { first: string; more: boolean } {
  const match = text.trim().match(/^.+?[.!?](?=\s+[A-Z“"]|$)/s);
  const first = match ? match[0] : text.trim();
  return { first, more: first.length < text.trim().length };
}

/** "ants, mice and spiders" */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
