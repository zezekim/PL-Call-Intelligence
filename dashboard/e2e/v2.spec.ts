import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { cleanPests } from "../lib/v2";
import { ACTION_ID, CALL_ID, LEAD_ID, REP_ID, brief, callsPage, mockApi, pipeline } from "./v2-fixtures";

/*
 * The v2 owner screens against made-up data: no server and no real calls.
 * Run against `next start`: E2E_BASE_URL=http://localhost:3100 npx playwright test v2
 */

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => {
    throw err;
  });
});

test("Today is one job at a time: one big button, Later, and what's coming up", async ({ page }) => {
  const sent: unknown[] = [];
  await mockApi(page, {
    [`POST /intel/actions/${ACTION_ID}/perform`]: async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...brief.todo[1].actions![0], status: "done", done_at: new Date().toISOString(), done_by: "owner" } });
    },
  });
  await page.goto("/v2");
  await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)$/ })).toBeVisible();
  await expect(page.getByText("5 things to do today.")).toBeVisible();
  // One job, said in one sentence, with how far through the day you are.
  const next = page.getByRole("region", { name: "Up next" });
  await expect(next).toContainText("A customer cancelled because they no longer need it. Nobody tried to keep them.");
  await expect(next).toContainText("1 of 5");
  await expect(page.getByRole("region", { name: "Coming up" }).locator("li")).toHaveCount(3);
  // Four widgets, each a word and a plain count.
  const numbers = page.getByRole("region", { name: "How it's going" });
  await expect(numbers.getByRole("link", { name: /New callers.*Good.*7 of 13 said yes/ })).toBeVisible();
  await expect(numbers.getByRole("link", { name: /People to call back/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your team" }).getByRole("link", { name: /Dana.*Needs to work on: Explain the plan/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Waiting for a yes" })).toContainText("Jordan Lee");
  // Later puts it at the back; Jordan is next, and his text is one tap away.
  await next.getByRole("button", { name: "Later" }).click();
  await expect(next).toContainText("Call Jordan Lee back");
  await next.getByRole("button", { name: "Text Jordan →" }).click();
  await page.getByRole("dialog", { name: "Call Jordan Lee back" }).getByRole("button", { name: "Send text" }).click();
  await expect.poll(() => sent).toEqual([{ body: null, phone: null }]);
});

test("a job opens its call beside the page, with the job's button at the bottom", async ({ page }) => {
  await mockApi(page);
  await page.goto("/v2");
  const next = page.getByRole("region", { name: "Up next" });
  await next.getByRole("button", { name: "Hear what happened →" }).click();
  const drawer = page.getByRole("dialog", { name: "Call with a customer" });
  await expect(drawer).toContainText("The caller asked about ants and rodents");
  await expect(drawer).toContainText("How the receptionist did");
  await expect(drawer).toContainText("Ask, listen, and recap first");
  await expect(drawer.getByRole("link", { name: "See everything about this call →" })).toHaveAttribute("href", `/v2/calls/${CALL_ID}`);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // A job with a written text: the drawer's button opens the same text.
  await next.getByRole("button", { name: "Later" }).click();
  await next.getByRole("button", { name: "What happened?" }).click();
  await drawer.getByRole("button", { name: "Text Jordan →" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Call Jordan Lee back" }).getByRole("button", { name: "Send text" })).toBeVisible();
});

test("See all lists every job, each with its own button", async ({ page }) => {
  await mockApi(page);
  await page.goto("/v2");
  await page.getByRole("region", { name: "Coming up" }).getByRole("button", { name: "See all 5" }).click();
  const all = page.getByRole("dialog", { name: "Everything to do (5)" });
  await expect(all.getByRole("list", { name: "Your to-do list" }).locator("li")).toHaveCount(5);
  await all.getByRole("button", { name: "Text Jordan →" }).click();
  await expect(page.getByRole("dialog", { name: "Call Jordan Lee back" })).toBeVisible();
});

// Written for someone with no training: no percentages, goals, fractions or
// scorecard words, nothing that matters in small print, nothing too small to tap.
for (const path of ["/v2", "/v2/pipeline", "/v2/reps", `/v2/reps/${REP_ID}`, "/v2/calls", `/v2/calls/${CALL_ID}`, "/v2/outbox"]) {
  test(`${path.replace(/[0-9a-f-]{36}/, ":id")} is in plain words, big enough to read and to tap`, async ({ page }) => {
    await mockApi(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const text = await page.locator("main").innerText();
    for (const word of [/%/, /\bgoal\b/i, /\d+\s*in\s*\d+/, /\bAI\b/, /autopilot/i, /step marks/i, /\b\d+\/\d+\b/, /\bscore\b/i, /\bgrade\b/i, /pipeline/i])
      expect(text, `${path} says ${word}`).not.toMatch(word);
    const problems = await page.evaluate(() => {
      const shown = (el: Element) => el.getBoundingClientRect().height > 0 && !el.closest(".sr-only, [aria-hidden=true]");
      const small = [...document.querySelectorAll("main *")]
        .filter((el) => el.children.length === 0 && shown(el) && (el.textContent ?? "").trim().length > 2 && parseFloat(getComputedStyle(el).fontSize) < 15)
        .map((el) => `small: ${el.textContent!.trim().slice(0, 30)}`);
      // Links inside a sentence are exempt, as in WCAG's target-size rule.
      const tiny = [...document.querySelectorAll("main a, main button, main [role=tab]")]
        .filter((el) => shown(el) && el.getBoundingClientRect().height < 40 && !el.closest("p"))
        .map((el) => `tiny: ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}`);
      return [...small, ...tiny];
    });
    expect(problems).toEqual([]);
  });
}

test("Call rings the customer, then asks how it went and moves them", async ({ page }) => {
  const sent: unknown[] = [];
  await mockApi(page, {
    [`PATCH /intel/leads/${LEAD_ID}`]: async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { id: LEAD_ID } });
    },
  });
  await page.goto("/v2/pipeline");
  const call = page.getByRole("region", { name: "Got a price" }).getByRole("link", { name: "Call Jordan on (555) 123-4567" });
  await expect(call).toHaveAttribute("href", "tel:+15551234567");
  // The test browser has no phone app: keep it on the page.
  await call.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
  await call.click();
  const ask = page.getByRole("group", { name: "How did the call go?" });
  await ask.getByRole("button", { name: "No answer, or call again later" }).click();
  await expect.poll(() => sent).toEqual([{ stage: "follow_up", called: true }]);
  await expect(page.getByRole("status")).toContainText("Jordan Lee: call again in a couple of days");
});

test("a job about a lead opens the same card as the board", async ({ page }) => {
  await mockApi(page, {
    // No text written yet: the job's button is to call them.
    "GET /intel/v2/brief": (route) =>
      route.fulfill({ json: { ...brief, todo: brief.todo.map((t) => ({ ...t, actions: [] })) } }),
  });
  await page.goto("/v2");
  const next = page.getByRole("region", { name: "Up next" });
  await next.getByRole("button", { name: "Later" }).click();
  await next.getByRole("button", { name: "Call Jordan →" }).click();
  const card = page.getByRole("dialog", { name: "Jordan Lee" });
  await expect(card.getByText("Late by 2 days")).toBeVisible();
  await expect(card.getByRole("link", { name: "Call Jordan on (555) 123-4567" })).toBeVisible();
  await card.getByRole("button", { name: "What to say" }).click();
  await expect(card.getByText(/I'm following up on the \$649 quote for the ants/)).toBeVisible();
});

test("the Team page has the scores, what to teach, and everyone", async ({ page }) => {
  await mockApi(page);
  await page.goto("/v2/reps");
  await expect(page.getByText("Customer problems are often not fixed on the call.")).toBeVisible();
  await expect(page.getByText("New customers", { exact: true })).toBeVisible();
  await expect(page.getByText("Explain the plan").first()).toBeVisible();
  await expect(page.getByText(/Start with Dana/)).toBeVisible();
  await expect(page.getByText("Good: at least half say yes")).toBeVisible();
  // Real counts, not a rate rounded to "out of 10".
  await expect(page.getByText(/2 of 5 new callers said yes/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Dana.*Needs to work on: Explain the plan/ })).toBeVisible();
});

test("a to-do is ready to send, and the third send offers autopilot", async ({ page }) => {
  const sent: unknown[] = [];
  await mockApi(page, {
    [`POST /intel/actions/${ACTION_ID}/perform`]: async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { id: ACTION_ID, kind: "text_customer", status: "done", label: "Text Jordan", to_name: "Jordan Lee", to_phone: "+15551234567", to_phone_pretty: "(555) 123-4567", body: "", done_at: new Date().toISOString(), done_by: "owner", auto: false, error: null, reply_text: null, replied_at: null } });
    },
  });
  await page.goto("/v2");
  await expect(page.getByText("Jordan got a price of $588 and has not said yes yet.", { exact: false }).first()).toBeVisible();
  const next = page.getByRole("region", { name: "Up next" });
  await next.getByRole("button", { name: "Later" }).click();
  await next.getByRole("button", { name: "Text Jordan →" }).click();
  const sheet = page.getByRole("dialog", { name: "Call Jordan Lee back" });
  await expect(sheet.getByText("(555) 123-4567")).toBeVisible();
  await expect(sheet.getByRole("textbox")).toHaveValue(/\$49 quote for the ants/);
  await sheet.getByRole("button", { name: "Send text" }).click();
  await expect(page.getByText(/sent 3 follow-up texts to customers yourself/)).toBeVisible();
  // The text goes as written: no edited body, no typed number.
  expect(sent).toEqual([{ body: null, phone: null }]);
});

test("practice mode: the Outbox answers the morning text as the owner", async ({ page }) => {
  const replies: unknown[] = [];
  await mockApi(page, {
    "POST /intel/outbox/reply": async (route) => {
      replies.push(route.request().postDataJSON());
      await route.fulfill({ json: { practice: true, messages: [] } });
    },
  });
  await page.goto("/v2/outbox");
  await expect(page.getByText("Practice mode is on.")).toBeVisible();
  await page.getByLabel("Quick replies").getByRole("button", { name: "1", exact: true }).click();
  await expect.poll(() => replies).toEqual([{ phone: "owner", text: "1" }]);
});

test("a lead marked yes moves at once, and Undo puts it back", async ({ page }) => {
  const sent: string[] = [];
  await mockApi(page, {
    [`PATCH /intel/leads/${LEAD_ID}`]: async (route) => {
      sent.push(route.request().postDataJSON().stage);
      await route.fulfill({ json: { id: LEAD_ID } });
    },
  });
  await page.goto("/v2/pipeline");
  const row = page.locator("li", { hasText: "Call Jordan Lee back" });
  await row.getByRole("button", { name: "Said yes" }).click();
  await expect(page.getByRole("status")).toContainText("Jordan Lee said yes");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => sent).toEqual(["won", "quoted"]);
});

test("a failed save puts the lead back and says so", async ({ page }) => {
  await mockApi(page, {
    [`PATCH /intel/leads/${LEAD_ID}`]: (route) => route.fulfill({ status: 500, json: { detail: "boom" } }),
  });
  await page.goto("/v2/pipeline");
  await page.locator("li", { hasText: "Call Jordan Lee back" }).getByRole("button", { name: "Said no" }).click();
  await expect(page.getByRole("status")).toContainText("That didn't work");
  await expect(page.getByText("Call Jordan Lee back")).toBeVisible();
});

test("callers who gave no name are never called 'unknown'", async ({ page }) => {
  await mockApi(page);
  await page.goto("/v2/calls");
  await expect(page.locator("ul.group-list")).toBeVisible();
  await expect(page.locator("ul.group-list")).not.toContainText(/unknown/i);
  await expect(page.getByText("Caller with no name")).toHaveCount(2);

  await page.goto(`/v2/calls/${CALL_ID}`);
  await expect(page.getByRole("heading", { name: "Call with a customer", level: 1 })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/\bunknown\b/i);
});

test("the call page leads with the verdict and keeps the rest one tap away", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/v2/calls/${CALL_ID}`);
  // One coaching tip, the other folded.
  await expect(page.getByText("Ask, listen, and recap first").first()).toBeVisible();
  await expect(page.getByText("Explain the fit and ask to book")).toHaveCount(0);
  await page.getByRole("button", { name: "Show 1 more tip" }).click();
  await expect(page.getByText("Explain the fit and ask to book")).toBeVisible();
  // One part at a time: the call steps are behind their own big tab.
  await expect(page.getByRole("button", { name: "Show the 2 steps done" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Every step" }).click();
  // Done steps folded; reasons open on tap.
  await expect(page.getByRole("button", { name: "Show the 2 steps done" })).toBeVisible();
  await page.getByRole("tab", { name: "Listen and read" }).click();
  await expect(page.getByRole("heading", { name: "Listen to the call" })).toBeVisible();
  // Actions live in one menu.
  await page.getByRole("button", { name: "Call actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete call…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a delete that fails says so instead of spinning forever", async ({ page }) => {
  await mockApi(page, {
    [`DELETE /intel/calls/${CALL_ID}`]: (route) => route.fulfill({ status: 500, json: { detail: "boom" } }),
  });
  await page.goto(`/v2/calls/${CALL_ID}`);
  await page.getByRole("button", { name: "Call actions" }).click();
  await page.getByRole("menuitem", { name: "Delete call…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status")).toContainText("That didn't work");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a broken call link explains itself and offers a way back", async ({ page }) => {
  await mockApi(page);
  await page.goto("/v2/calls/not-a-call");
  await expect(page.getByText("This call isn't here anymore")).toBeVisible();
  await expect(page.getByText(/valid UUID/)).toHaveCount(0);
  await page.getByRole("link", { name: "Back to all calls" }).click();
  await expect(page).toHaveURL(/\/v2\/calls$/);
});

test("a team member's page says what to teach and what they do well", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/v2/reps/${REP_ID}`);
  await expect(page.getByRole("heading", { name: "Dana", level: 1 })).toBeVisible();
  for (const heading of ["Teach next", "Good at"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText("Next time, say")).toBeVisible();
  await expect(page.getByRole("link", { name: /Hear that moment on the call/ })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/\bunknown\b/i);
});

test("search follows the typing and can be cleared", async ({ page }) => {
  await mockApi(page);
  await page.goto("/v2/calls");
  await page.getByRole("searchbox").fill("katie");
  await expect(page).toHaveURL(/q=katie/);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page).not.toHaveURL(/q=/);
});

test("nothing spills sideways on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  for (const path of ["/v2", "/v2/pipeline", "/v2/reps", "/v2/calls", `/v2/calls/${CALL_ID}`, `/v2/reps/${REP_ID}`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
    // The app clips sideways overflow, so also look for anything cut off at the edge.
    await page.waitForTimeout(700);
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.right > document.documentElement.clientWidth + 1 && !el.closest("[class*='overflow-x-auto'], .sr-only, [aria-hidden=true]");
        })
        .map((el) => (el.textContent ?? "").trim().slice(0, 30))
        .slice(0, 3),
    );
    expect(cut, path).toEqual([]);
  }
});

test("a full call-back board stays inside a phone's width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const board = pipeline();
  const many = Array.from({ length: 12 }, (_, i) =>
    board.open.map((l) => ({ ...l, id: `${l.id.slice(0, -2)}${String(i).padStart(2, "0")}`, stage: ["new", "quoted", "follow_up"][i % 3] })),
  ).flat();
  await mockApi(page, { "GET /intel/v2/pipeline": (route) => route.fulfill({ json: { ...board, open: many } }) });
  await page.goto("/v2/pipeline");
  // A phone starts one person at a time; the board is one tap away.
  await expect(page.getByRole("heading", { name: "Call these people" })).toBeVisible();
  await page.getByRole("tab", { name: "Board" }).click();
  await page.getByRole("region", { name: "Still deciding" }).waitFor();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("pest names read as short everyday words", () => {
  expect(cleanPests(["ants, described by the caller as possibly bed or fire ants", "Fire Ants", "Mice", "rodents"])).toEqual([
    "fire ants",
    "mice",
  ]);
  expect(cleanPests(["ants", "spiders"])).toEqual(["ants", "spiders"]);
  expect(cleanPests(["cockroaches", "German roach"])).toEqual(["roaches"]);
  expect(cleanPests(["something we have never heard of before today"])).toEqual([]);
  expect(cleanPests(["voles"])).toEqual(["moles"]);
});

test("call back is a board, one column per step, and a card can be dragged along", async ({ page }) => {
  const sent: string[] = [];
  await mockApi(page, {
    [`PATCH /intel/leads/${LEAD_ID}`]: async (route) => {
      sent.push(route.request().postDataJSON().stage);
      await route.fulfill({ json: { id: LEAD_ID } });
    },
  });
  await page.goto("/v2/pipeline");
  for (const column of ["Asked about a service", "Got a price", "Still deciding", "Said yes", "Said no"]) {
    await expect(page.getByRole("region", { name: column })).toBeVisible();
  }
  const quoted = page.getByRole("region", { name: "Got a price" });
  await expect(quoted.getByText("Call Jordan Lee back")).toBeVisible();
  await quoted.locator("li", { hasText: "Call Jordan Lee back" }).dragTo(page.getByRole("region", { name: "Still deciding" }));
  await expect.poll(() => sent).toEqual(["follow_up"]);
  await page.getByRole("tab", { name: "One at a time" }).click();
  await expect(page.getByRole("heading", { name: "Call these people" })).toBeVisible();
});

test("a board card moves with a button too, and keeps a typed-in number", async ({ page }) => {
  const sent: unknown[] = [];
  await mockApi(page, {
    ["PATCH /intel/leads/"]: async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { id: LEAD_ID } });
    },
  });
  await page.goto("/v2/pipeline");
  const jordan = page.getByRole("region", { name: "Got a price" }).locator("li", { hasText: "Call Jordan Lee back" });
  await jordan.getByRole("button", { name: "Move" }).click();
  await jordan.getByRole("group", { name: "Move to" }).getByRole("button", { name: "Still deciding" }).click();
  await expect.poll(() => sent).toEqual([{ stage: "follow_up" }]);
  const sam = page.locator("li", { hasText: "Call Sam Rivera back" });
  await sam.getByRole("button", { name: "Add their number" }).click();
  await sam.getByRole("textbox", { name: "Phone number for Sam Rivera" }).fill("(555) 987-6543");
  await sam.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => sent).toEqual([{ stage: "follow_up" }, { phone: "(555) 987-6543" }]);
});

test("the call-back list hands the owner the words to say", async ({ page }) => {
  await mockApi(page);
  await page.goto("/v2/pipeline");
  const row = page.locator("li", { hasText: "Call Jordan Lee back" });
  await expect(row).toContainText("Hi Jordan, it's Dana from ABC Pest Control. I'm following up on the $649 quote for the ants.");
});

// Every v2 screen, light and dark, against WCAG 2.1 AA.
for (const scheme of ["light", "dark"] as const) {
  test(`v2 screens pass an accessibility check (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript((t) => window.localStorage.setItem("theme", t), scheme);
    await mockApi(page);
    for (const path of ["/v2", "/v2/pipeline", "/v2/reps", "/v2/calls", `/v2/calls/${CALL_ID}`, `/v2/reps/${REP_ID}`, "/v2/outbox"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .include("main")
        .analyze();
      expect(
        violations.map((v) => `${path}: ${v.id} — ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`),
      ).toEqual([]);
    }
  });
}

test("light by default, even on a device set to dark; Dark and Automatic on request", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto("/v2");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await background()).toBe("rgb(245, 245, 247)");

  await page.evaluate(() => window.localStorage.setItem("theme", "system"));
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await background()).toBe("rgb(0, 0, 0)");

  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("All calls follows the period picker and the filters linked from other pages", async ({ page }) => {
  const asked: URLSearchParams[] = [];
  await mockApi(page, {
    "GET /intel/calls$": async (route) => {
      asked.push(new URL(route.request().url()).searchParams);
      await route.fulfill({ json: callsPage });
    },
  });
  await page.goto(`/v2/calls?status=failed&rep=${REP_ID}&who=Dana%20Ruiz`);
  await expect(page.getByRole("tab", { name: "Could not read" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => asked.at(-1)?.get("rep_id")).toBe(REP_ID);
  expect(asked.at(-1)?.get("status")).toBe("failed");

  await page.getByRole("tab", { name: "Past week" }).click();
  await expect.poll(() => asked.at(-1)?.get("days")).toBe("7");

  await page.getByRole("button", { name: "Show everyone's calls" }).click();
  await expect.poll(() => asked.at(-1)?.get("rep_id") ?? null).toBe(null);
  await page.getByRole("tab", { name: "All calls" }).last().click();
  await expect.poll(() => asked.at(-1)?.get("status") ?? null).toBe(null);
  await expect(page.getByRole("tab", { name: "Could not read" })).toHaveCount(0);
});
