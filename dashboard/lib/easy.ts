/**
 * Plain words for everything the v2 screens show. Written so someone with no
 * training (and little reading practice) can follow the page.
 */

export const CALL_TYPE_PLAIN: Record<string, string> = {
  sales: "New customer",
  retention: "Wants to cancel",
  reservice: "Pests came back",
  scheduling: "Booking or changing a visit",
  billing: "Bill or payment",
  other_service: "Other question",
  not_scorable: "Not checked",
};

export const OUTCOME_PLAIN: Record<string, string> = {
  sold: "Said yes",
  follow_up: "Still deciding",
  not_sold: "Said no",
  saved: "Stayed",
  cancelled: "Cancelled",
  pending: "Not decided",
  resolved: "Problem fixed",
  partially: "Partly fixed",
  unresolved: "Not fixed",
};

export const OUTCOME_STATUS: Record<string, "good" | "watch" | "bad"> = {
  sold: "good",
  saved: "good",
  resolved: "good",
  follow_up: "watch",
  pending: "watch",
  partially: "watch",
  not_sold: "bad",
  cancelled: "bad",
  unresolved: "bad",
};

export const GRADE_PLAIN: Record<string, string> = {
  gold: "Excellent",
  green: "Good",
  below: "Needs work",
};

/** Same names as the server's PLAIN_STEPS; the call page reads steps straight from the call. */
export const STEP_PLAIN: Record<string, [string, string]> = {
  validate: ["Show you care", "Say you're sorry about their exact problem."],
  confidence_statement: ["Promise to help", "Tell them you will take care of it."],
  expectation_statement_1: ["Say what you'll ask", "Tell them you'll ask a few questions."],
  investigate: ["Ask questions", "Ask what, where and when to understand the problem."],
  summary_statement: ["Repeat it back", "Say their problem back in your own words."],
  expectation_statement_2: ["Explain the plan", "Say you'll go over the service first, then the price."],
  present_solution: ["Offer the fix", "Explain what you'll do and why it helps them."],
  consensus: ["Check they agree", "Ask if it makes sense or if they have questions."],
  close: ["Ask to book", "Ask them to set a time, like morning or afternoon."],
  provide_conclusion: ["Confirm the details", "Repeat the date, time and address."],
  thank_customer: ["Say thank you", "Thank them for calling."],
  final_information: ["Leave the door open", "Tell them to call you first for any other pest problem."],
  validate_confidence: ["Stay calm and reassure", "Promise to help, without agreeing to cancel yet."],
  transition_statement: ["Look up the account", "Ask for the address and check the account."],
  do_research: ["Check their history", "Mention how long they've been a customer or recent visits."],
  validate_summary: ["Repeat the reason", "Say back why they want to cancel."],
  validate_expectation: ["Offer options", "Say you want to make it right and have options."],
  repeat: ["Try again", "If they say no, ask more and offer something else."],
  leave_teaser: ["End on a good note", "Invite them back, like a free first visit."],
  pricing: ["Give the price clearly", "Say the full price, then the deal, then the monthly price."],
  objection_agree: ["Agree first", "When they push back, agree before you answer."],
  objection_restate: ["Find the real worry", "Repeat their concern and ask what's behind it."],
  objection_resolve: ["Answer the worry", "Solve the concern and show the value."],
  objection_reclose: ["Ask again", "Ask for the sale again."],
};

export const stepName = (key: string, fallback: string) => STEP_PLAIN[key]?.[0] ?? fallback;
export const stepMeaning = (key: string) => STEP_PLAIN[key]?.[1] ?? "";

/** "3 minutes 34 seconds" rather than "3:34". */
export function spokenLength(seconds: number | null | undefined): string {
  const s = Math.round(seconds ?? 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r} second${r === 1 ? "" : "s"}`;
  return `${m} minute${m === 1 ? "" : "s"}${r ? ` ${r} second${r === 1 ? "" : "s"}` : ""}`;
}

/** "2 minutes": the length of a call, rounded the way a person says it. */
export function spokenMinutes(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  return m < 1 ? "under a minute" : `${m} minute${m === 1 ? "" : "s"}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
