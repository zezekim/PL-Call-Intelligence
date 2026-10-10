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

/** Last response per API path, so a page seen before renders instantly. */
export const responseCache = new Map<string, unknown>();

export function clearToken(): void {
  responseCache.clear();
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

  // A 401 from signing in is a wrong password, not an expired session.
  if (response.status === 401 && !path.startsWith("/auth/login")) {
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
      // Validation errors arrive as a list; show the first one's message.
      if (Array.isArray(detail) && typeof detail[0]?.msg === "string") {
        detail = detail[0].msg.replace(/^Value error, /, "");
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(typeof detail === "string" ? detail : "Request failed", response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** POST a form with upload progress (0-1). fetch can't report upload progress. */
function upload<T>(path: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError("Upload failed. Check your connection.", 0));
    xhr.onload = () => {
      let body: { detail?: unknown } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON body */
      }
      if (xhr.status === 401) {
        clearToken();
        window.location.href = "/login";
        reject(new ApiError("Session expired", 401));
      } else if (xhr.status >= 400) {
        const detail = body?.detail;
        reject(new ApiError(typeof detail === "string" ? detail : "Upload failed", xhr.status));
      } else {
        resolve(body as T);
      }
    };
    xhr.send(form);
  });
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
  upload,
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
  business_timezone?: string;
}

export interface UploadResult {
  created: CallRow[];
  duplicates: { filename: string; call_id: string }[];
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
  disputed_steps: number;
  rep_locked: boolean;
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
  model_status?: string;
  override?: { status: string; note: string; by: string; at: string } | null;
  deliberation?: { model: string; first: string; final: string; reason: string }[] | null;
  /** This business's own rules that applied to the step when it was graded. */
  rules?: string[];
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
  scoring_mode: "standard" | "enhanced";
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
  // Score that counts as Green on this call's scorecard.
  green_at?: number | null;
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
  /** A manager's fixes: who said it, the transcribed words, a line they added. */
  manual_role?: "rep" | "customer" | null;
  original_text?: string | null;
  added?: boolean;
}

export interface ScoringRule {
  id: string;
  scorecard_key: string;
  scorecard_name: string;
  step_key: string;
  step_label: string;
  text: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  source_call_id: string | null;
}

export interface ScoringRules {
  rules: ScoringRule[];
  rescore: { scorecard_key: string; scorecard_name: string; calls: number; est_cost_usd: number }[];
}

export interface FollowUp {
  id: string;
  call_id: string;
  action: string;
  owner: string | null;
  due: string | null;
  status: "open" | "done";
  done_at: string | null;
  done_by: string | null;
  customer?: string | null;
  rep?: string | null;
  ref?: string | null;
}

export interface CallDetail extends CallRow {
  follow_ups: FollowUp[];
  /** The customer's number, for the Call button. */
  customer_phone?: string | null;
  customer_phone_pretty?: string;
  recording_expires_at: string | null;
  stt_engine: string | null;
  stt_provider: string | null;
  audio_channels: number | null;
  audio_url: string | null;
  segments: Segment[];
  analysis: Analysis | null;
  cost_usd: number;
  transcript_edited_at?: string | null;
  /** The transcript was fixed after this grade was made. */
  transcript_stale?: boolean;
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
    disputed_calls: number;
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
  follow_ups: (CallRef & { id: string; action: string; owner: string; due: string })[];
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
