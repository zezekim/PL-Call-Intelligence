/**
 * Made-up data for the v2 screens, so they can be checked end to end without
 * a server or any real customer's calls.
 */
import type { Page, Route } from "@playwright/test";

const now = Date.now();
const ago = (days: number) => new Date(now - days * 864e5).toISOString();

export const ACTION_ID = "a0000000-0000-4000-8000-000000000001";

export const CALL_ID = "11111111-1111-4111-8111-111111111111";
export const LEAD_ID = "22222222-2222-4222-8222-222222222222";
export const REP_ID = "33333333-3333-4333-8333-333333333333";

const step = (plain: string, met: number, of: number) => ({
  step: plain.toLowerCase().replace(/ /g, "_"),
  plain,
  meaning: `What "${plain}" means on a call.`,
  key: plain.toLowerCase().replace(/ /g, "_"),
  quadrant: "Close",
  met,
  of,
  hit_rate: (met / of) * 100,
  missed: of - met,
});

export const brief = {
  as_of: ago(0),
  days: 30,
  headline: {
    status: "bad",
    title: "Customer problems are often not fixed on the call.",
    detail: "Most urgent today: try to win back a customer who cancelled.",
  },
  cards: [
    { key: "sales", label: "New customers", question: "Are new customers saying yes?", metric_label: "Said yes", value: 54, count: 7, of: 13, goal: "Goal: at least 5 out of 10 say yes", status: "good", target: 50, change: null, detail: "7 said yes · 5 still deciding · 1 said no", why: "5 people are still deciding. Call them back.", action: { label: "See who to call back", href: "/v2/pipeline" } },
    { key: "retention", label: "Customers who want to cancel", question: "Are we keeping them?", metric_label: "Kept", value: 0, count: 0, of: 1, goal: "Goal: at least 6 out of 10 kept", status: "none", target: 60, change: null, detail: "0 kept · 1 cancelled", why: "1 customer cancelled and was never given a reason to stay.", action: { label: "Listen to that call", href: `/v2/calls/${CALL_ID}` } },
    { key: "service", label: "Customers with a problem", question: "Did we fix it on the call?", metric_label: "Fixed", value: 57, count: 4, of: 7, goal: "Goal: at least 85 out of 100 fixed", status: "bad", target: 85, change: -6, detail: "4 fixed · 3 partly fixed", why: "3 customers may still need help.", action: { label: "Listen to that call", href: `/v2/calls/${CALL_ID}` } },
    { key: "quality", label: "Call steps", question: "", metric_label: "Steps", value: 41, count: 0, of: 21, goal: "", status: "bad", target: 80, change: null, detail: "0 of 21 calls followed enough steps", why: "", action: null },
  ],
  todo: [
    { kind: "retention", priority: 100, title: "Try to win back a customer who cancelled", why: "They cancelled because they no longer need it.", cta: "", href: `/v2/calls/${CALL_ID}`, when: ago(2) },
    {
      key: "lead:l1:c1", kind: "sales", priority: 90, title: "Call Jordan Lee back", why: "Jordan Lee was given a price and hasn't decided yet.", cta: "", href: "/v2/pipeline", when: ago(3), value: 588,
      actions: [{ id: ACTION_ID, kind: "text_customer", status: "proposed", label: "Text Jordan", to_name: "Jordan Lee", to_phone: "+15551234567", to_phone_pretty: "(555) 123-4567", body: "Hi Jordan, it's Dana from ABC Pest Control. Following up on the $49 quote for the ants. Reply STOP to opt out.", done_at: null, done_by: null, auto: false, error: null, reply_text: null, replied_at: null }],
      handled: null,
    },
    { kind: "sales", priority: 89, title: "Call Sam Rivera back", why: "Sam Rivera was given a price.", cta: "", href: "/v2/pipeline", when: ago(6) },
    { kind: "service", priority: 70, title: "Check on Chris", why: "Their problem was not fixed on the call.", cta: "", href: `/v2/calls/${CALL_ID}`, when: ago(4) },
    { kind: "follow_up", priority: 50, title: "Send the quote by email", why: "Promised to Robin Park.", cta: "", href: `/v2/calls/${CALL_ID}`, when: ago(5) },
  ],
  todo_total: 5,
  coaching: {
    focus: step("Explain the plan", 0, 19),
    tip: { call_id: CALL_ID, ref: null, customer: "unknown", rep: "Dana", title: "Explain the plan", what_happened: "Went straight to price.", try_saying: "Here's what we'll do first, then the price.", start: 66 },
    reps: [{ rep: "Dana", missed: 6, of: 6 }, { rep: "Lee", missed: 5, of: 5 }],
    strength: step("Say thank you", 18, 21),
  },
  review: { disputed_calls: 1, type_checks: 0 },
  accuracy: { calls: 3, steps: 38, kept: 36, pct: 94.7 },
  calls: { analyzed: 21, processing: 0, failed: 0 },
  receptionist_number: null,
};

const lead = (id: string, name: string, stage: string, urgency: string | null, value: number | null) => ({
  id,
  name,
  stage,
  stage_source: "auto",
  service: stage === "won" || stage === "lost" ? null : "General pest",
  price_quoted: value ? `$${value}` : null,
  value,
  pests: stage === "lost" ? [] : ["ants"],
  rep: "Dana",
  last_call_id: CALL_ID,
  last_contact_at: ago(4),
  action: urgency
    ? { label: `Call ${name} back`, why: `${name} was given a price.`, promised: null, due_at: ago(2), days_since_contact: 4, urgency }
    : null,
});

export const pipeline = () => ({
  as_of: ago(0),
  funnel: [],
  open: [lead(LEAD_ID, "Jordan Lee", "quoted", "overdue", 649), lead("44444444-4444-4444-8444-444444444444", "Sam Rivera", "quoted", "upcoming", null)],
  closed: [lead("55555555-5555-4555-8555-555555555555", "Name not given", "lost", null, null)],
  summary: { open: 2, needs_action: 1, open_value: 649, won: 0, won_value: 0, lost: 1 },
});

const repCard = {
  id: REP_ID,
  name: "Dana",
  calls: 6,
  scored: 6,
  score: 48,
  status: "bad",
  trend: "down",
  meeting_standard: 1,
  close_rate: 40,
  sales_calls: 5,
  focus: step("Explain the plan", 0, 6),
  strengths: [step("Say thank you", 6, 6)],
};

const row = (i: number, name: string | null) => ({
  id: i === 0 ? CALL_ID : `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
  source: "upload",
  external_ref: null,
  original_filename: null,
  occurred_at: ago(i),
  created_at: ago(i),
  duration_seconds: 137,
  processing_status: "done",
  processing_error: null,
  call_type: "sales",
  call_type_label: "Sales",
  lens: "sales",
  rep_id: REP_ID,
  rep_name: "AI Receptionist",
  customer_name: name,
  summary: null,
  outcome: "not_sold",
  score: 6,
  score_max: 17,
  grade: "below",
  needs_review: false,
  disputed_steps: 0,
  rep_locked: false,
  call_type_overridden: false,
});

export const callsPage = { items: [row(0, "unknown"), row(1, "Alex Kim"), row(2, null)], total: 3 };

const item = (key: string, awarded: boolean) => ({
  key,
  label: key,
  quadrant: "Close",
  status: awarded ? "met" : "missed",
  awarded,
  auto_awarded: false,
  reason: `Why ${key} was ${awarded ? "done" : "skipped"}.`,
  evidence: [{ segment_id: 1, quote: "Hi, thanks for calling.", start: 5, role: "rep", verified: true }],
  agreement: null,
  override: null,
});

export const callDetail = {
  ...row(0, "unknown"),
  follow_ups: [],
  recording_expires_at: null,
  stt_engine: null,
  stt_provider: null,
  audio_channels: null,
  audio_url: null,
  segments: [
    { id: 1, start: 5, end: 9, text: "Hi, thanks for calling ABC Pest Control.", speaker: "A", role: "rep" },
    { id: 2, start: 26, end: 28, text: "I have a question.", speaker: "B", role: "customer" },
  ],
  analysis: {
    model: "x",
    scoring_mode: "standard",
    updated_at: ago(0),
    call_type: "sales",
    call_type_label: "Sales",
    call_type_confidence: 0.95,
    lens: "sales",
    outcome: "not_sold",
    rep_name: "AI Receptionist",
    customer_name: "unknown",
    summary: "The caller asked about ants and rodents, then hung up.",
    scorecard_key: "sales",
    scorecard_name: "Sales",
    score: 6,
    score_max: 17,
    green_at: 14,
    grade: "below",
    evidence_verified_pct: 100,
    triage: {
      call_type_reason: "", direction: "inbound", company_name: "", customer_wins: [], pests: ["ants"],
      sales: { outcome: "", service_discussed: "General pest", price_quoted: "", objections: [], lost_reason: "" },
      retention: { outcome: "", cancel_reason: "", root_cause: "", offers_made: [], first_offer_accepted: false, under_contract: "" },
      service: { request: "", resolution: "", actions_taken: [] },
      appointment: { booked: false, when: "" },
      follow_ups: [],
      customer_sentiment_end: "",
    },
    items: [item("validate", false), item("confidence_statement", false), item("thank_customer", true), item("greeting", true)],
    coaching: {
      coaching: [
        { title: "Ask, listen, and recap first", segment_id: 2, start: 26, item_keys: [], what_happened: "Moved straight to price.", try_saying: "Tell me what you've seen so far.", why_it_matters: "" },
        { title: "Explain the fit and ask to book", segment_id: 2, start: 26, item_keys: [], what_happened: "Never asked to book.", try_saying: "Can I get you on the schedule?", why_it_matters: "" },
      ],
      strengths: [{ title: "Ask about both pests", segment_id: 1, start: 5, detail: "", quote: "" }],
    },
    cost_usd: 0,
  },
  cost_usd: 0,
};

export const repBrief = {
  ...repCard,
  verdict: "Dana skips explaining the plan on every call.",
  team_score: 41,
  coach: brief.coaching.tip,
  strength_example: null,
  steps: [step("Explain the plan", 0, 6), step("Say thank you", 6, 6)],
  calls_list: [{ call_id: CALL_ID, ref: null, customer: "unknown", when: ago(1), score: 35, grade: "below", call_type: "sales", outcome: "not_sold" }],
};

/** Signs in with a made-up token and answers every API call from the data above. */
export const actionsSummary = {
  autopilot: { text_customer: false, remind_rep: false, coach_rep: false },
  approvals: { text_customer: 2 },
  coaching_waiting: [],
  done_today: [],
  replies: [],
  daytime: true,
};

export async function mockApi(page: Page, overrides: Record<string, (route: Route) => unknown> = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("pestlaunch.token", "e2e");
    window.localStorage.setItem("pestlaunch.environment", "cloud");
  });
  const board = pipeline();
  // The API sits under /api in production and at its own origin in CI.
  await page.route(/\/(auth|intel|client-errors)(\/|\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (!/^\/(auth|intel|client-errors)/.test(path)) return route.fallback();
    const method = route.request().method();
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (new RegExp(pattern).test(`${method} ${path}`)) return handler(route);
    }
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/auth/me") return json({ email: "owner@example.test", role: "admin", business_id: "b", business_name: "ABC Pest Control" });
    if (path === "/intel/v2/brief") return json(brief);
    if (path === "/intel/v2/pipeline") return json(board);
    if (path === "/intel/v2/reps") return json([repCard]);
    if (path === `/intel/v2/reps/${REP_ID}`) return json(repBrief);
    if (path === "/intel/calls") return json(callsPage);
    if (path === `/intel/calls/${CALL_ID}`) return json(callDetail);
    if (path.startsWith("/intel/calls/")) return json({ detail: "Input should be a valid UUID" }, path.includes("not-a-call") ? 422 : 404);
    if (method === "PATCH" && path.startsWith("/intel/leads/")) return json({ id: LEAD_ID, stage: "won" });
    if (path === "/intel/team") return json([]);
    if (path === "/intel/actions/summary") return json(actionsSummary);
    if (path === "/intel/actions/refresh") return json({ prepared: 1 });
    return json({});
  });
}
