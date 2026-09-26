"use client";

/**
 * API client. The dashboard and API share an origin in production (the API
 * lives under /api behind Caddy), so the default base is relative.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || "/api";
const TOKEN_KEY = "pestlaunch.token";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${BASE}${path}`, { ...init, headers });

  if (response.status === 401) {
    clearToken();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new ApiError("Session expired", 401);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(typeof detail === "string" ? detail : "Request failed", response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  form: <T,>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
  url: (path: string) => `${BASE}${path}`,
};

// --- Types -------------------------------------------------------------------

export type Grade = "gold" | "green" | "below";
export type Lens = "sales" | "retention" | "service";

export interface Me {
  email: string;
  role: string;
  business_id: string;
  business_name?: string;
}

export interface CallRow {
  id: string;
  source: "upload" | "twilio";
  external_ref: string | null;
  original_filename: string | null;
  occurred_at: string | null;
  created_at: string;
  duration_seconds: number;
  processing_status: string;
  processing_error: string | null;
  call_type: string | null;
  call_type_label: string | null;
  lens: Lens | null;
  rep_id: string | null;
  rep_name: string | null;
  customer_name: string | null;
  summary: string | null;
  outcome: string | null;
  score: number | null;
  score_max: number | null;
  grade: Grade | null;
  needs_review: boolean;
  call_type_overridden: boolean;
}

export interface CallPage {
  items: CallRow[];
  total: number;
}

export interface Evidence {
  segment_id: number;
  quote: string;
  start: number | null;
  role: string | null;
  verified: boolean;
}

export interface ScoreItem {
  key: string;
  label: string;
  quadrant: string;
  status: "met" | "missed" | "not_needed";
  awarded: boolean;
  auto_awarded: boolean;
  reason: string;
  evidence: Evidence[];
  agreement: string | null;
}

export interface Moment {
  title: string;
  segment_id: number;
  start: number | null;
  verified?: boolean;
}

export interface CoachingTip extends Moment {
  item_keys: string[];
  what_happened: string;
  try_saying: string;
  why_it_matters: string;
}

export interface Strength extends Moment {
  detail: string;
  quote: string;
}

export interface Triage {
  call_type_reason: string;
  direction: string;
  company_name: string;
  customer_wins: string[];
  pests: string[];
  sales: {
    outcome: string;
    service_discussed: string;
    price_quoted: string;
    objections: { objection: string; segment_id: number }[];
    lost_reason: string;
  };
  retention: {
    outcome: string;
    cancel_reason: string;
    root_cause: string;
    offers_made: string[];
    first_offer_accepted: boolean;
    under_contract: string;
  };
  service: { request: string; resolution: string; actions_taken: string[] };
  appointment: { booked: boolean; when: string };
  follow_ups: { action: string; owner: string; due: string }[];
  customer_sentiment_end: string;
  classified_as?: string;
}

export interface Analysis {
  model: string;
  updated_at: string;
  call_type: string;
  call_type_label: string;
  call_type_confidence: number;
  lens: Lens | null;
  outcome: string | null;
  rep_name: string | null;
  customer_name: string | null;
  summary: string | null;
  scorecard_key: string | null;
  scorecard_name: string | null;
  score: number | null;
  score_max: number | null;
  grade: Grade | null;
  evidence_verified_pct: number | null;
  triage: Triage;
  items: ScoreItem[];
  coaching: { overall_feedback?: string; coaching?: CoachingTip[]; strengths?: Strength[] };
  cost_usd: number;
}

export interface Segment {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker: string;
  role: "rep" | "customer" | "unknown";
}

export interface CallDetail extends CallRow {
  stt_engine: string | null;
  stt_provider: string | null;
  audio_channels: number | null;
  audio_url: string | null;
  segments: Segment[];
  analysis: Analysis | null;
  cost_usd: number;
}

export interface CallRef {
  call_id: string;
  ref: string | null;
  customer: string | null;
  rep: string | null;
  when: string;
}

export interface MissedStep {
  step: string;
  missed: number;
  of: number;
  pct: number | null;
  example_call_id: string | null;
}

export interface GradeCounts {
  gold: number;
  green: number;
  below: number;
}

export interface Overview {
  as_of: string;
  receptionist_number: string | null;
  scorecard: {
    calls: number;
    scored: number;
    avg_score_pct: number | null;
    grades: GradeCounts;
    needs_review: number;
    in_progress: number;
    failed: number;
  };
  sales: {
    calls: number;
    sold: number;
    follow_up: number;
    not_sold: number;
    close_rate: number | null;
    avg_score_pct: number | null;
    grades: GradeCounts;
    missed_steps: MissedStep[];
    objections: (CallRef & { objection: string })[];
    not_closed: (CallRef & { reason: string })[];
  };
  retention: {
    calls: number;
    saved: number;
    cancelled: number;
    pending: number;
    save_rate: number | null;
    avg_score_pct: number | null;
    grades: GradeCounts;
    reasons: { reason: string; count: number }[];
    offers: { offer: string; count: number }[];
    no_offer_calls: number;
    missed_steps: MissedStep[];
    not_saved: (CallRef & { reason: string; root_cause: string; offers_made: string[] })[];
  };
  service: {
    calls: number;
    by_type: { call_type: string; label: string; count: number }[];
    resolved: number;
    partially: number;
    unresolved: number;
    resolution_rate: number | null;
    avg_score_pct: number | null;
    grades: GradeCounts;
    missed_steps: MissedStep[];
    unresolved_calls: (CallRef & { summary: string })[];
  };
  training: MissedStep[];
  follow_ups: (CallRef & { action: string; owner: string; due: string })[];
  review: (CallRef & { call_type: string; confidence: number })[];
}

export interface RepSummary {
  id: string;
  name: string;
  calls: number;
  scored: number;
  avg_score_pct: number | null;
  grades: GradeCounts;
  lenses: Record<string, number>;
  close_rate: number | null;
  sales_calls: number;
  save_rate: number | null;
  strongest: string | null;
  weakest: string | null;
}

export interface StepRate {
  step: string;
  quadrant: string;
  met: number;
  of: number;
  pct: number | null;
}

export interface RepDetail extends RepSummary {
  scorecards: { scorecard: string; calls: number; steps: StepRate[] }[];
  training: MissedStep[];
  coaching: (CallRef & { title: string; try_saying: string; start: number | null })[];
  strengths: (CallRef & { title: string; detail: string; start: number | null })[];
  trend: { call_id: string; ref: string | null; when: string; pct: number | null; grade: Grade }[];
}

export interface Lead {
  id: string;
  name: string;
  stage: string;
  stage_source: string;
  pests: string[];
  service: string | null;
  price_quoted: string | null;
  next_step: string | null;
  rep_name: string | null;
  last_call_id: string | null;
  last_contact_at: string | null;
  calls: number;
}
