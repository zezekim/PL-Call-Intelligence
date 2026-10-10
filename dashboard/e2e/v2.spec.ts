import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { cleanPests } from "../lib/v2";
import { ACTION_ID, CALL_ID, LEAD_ID, REP_ID, brief, callsPage, mockApi } from "./v2-fixtures";

/*
 * The v2 owner screens against made-up data: no server and no real calls.
 * Run against `next start`: E2E_BASE_URL=http://localhost:3100 npx playwright test v2
 */

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => {
    throw err;
  });
});

test("Today leads with one magic button, and it sends every written text", async ({ page }) => {
  const sent: unknown[] = [];
  await mockApi(page, {
    [`POST /intel/actions/${ACTION_ID}/perform`]: async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...brief.todo[1].actions![0], status: "done", done_at: new Date().toISOString(), done_by: "owner" } });
    },
  });
  await page.goto("/v2");
  await expect(page.getByText("Customer problems are often not fixed on the call.")).toBeVisible();
  // One screen: the numbers, the jobs and the team, each a button.
  await expect(page.getByRole("region", { name: "How it's going" }).getByRole("link", { name: /New customers/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Call backs waiting/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your team" }).getByRole("link", { name: /Dana.*Work on: Explain the plan/ })).toBeVisible();
  await expect(page.getByText("I wrote 1 text")).toBeVisible();
  await page.getByRole("button", { name: "Do it all for me" }).click();
  const sheet = page.getByRole("dialog", { name: "Here's what I'll send" });
  await expect(sheet.getByText(/\$49 quote for the ants/)).toBeVisible();
  await sheet.getByRole("button", { name: "Send it" }).click();
  const doneSheet = page.getByRole("dialog", { name: "All done!" });
  await expect(doneSheet.getByText("1 customer taken care of")).toBeVisible();
  await expect(doneSheet.getByText("$588 a year you're going after")).toBeVisible();
  await expect(doneSheet.getByRole("button", { name: "Do this for me every day" })).toBeVisible();
  expect(sent).toEqual([{ body: null, phone: null }]);
});

test("each job is one tap: Do it sends at once", async ({ page }) => {
  const sent: unknown[] = [];
  await mockApi(page, {
    [`POST /intel/actions/${ACTION_ID}/perform`]: async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...brief.todo[1].actions![0], status: "done", done_at: new Date().toISOString(), done_by: "owner" } });
    },
  });
  await page.goto("/v2");
  await page.getByRole("button", { name: "Do it: Text Jordan" }).click();
  await expect(page.getByText("Done!", { exact: true })).toBeVisible();
  expect(sent).toEqual([{ body: null, phone: null }]);
});

test("the Team page has the scores, what to teach, and everyone", async ({ page }) => {
  await mockApi(page);
  await page.goto("/v2/reps");
  await expect(page.getByText("Customer problems are often not fixed on the call.")).toBeVisible();
  await expect(page.getByText("New customers", { exact: true })).toBeVisible();
  await expect(page.getByText("Explain the plan").first()).toBeVisible();
  await expect(page.getByText(/Start with Dana/)).toBeVisible();
  await expect(page.getByText("Managers kept 95% of the AI's step marks (3 calls corrected)")).toBeVisible();
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
  await expect(page.getByText("$588 a year").first()).toBeVisible();
  await page.getByRole("button", { name: "Call Jordan Lee back: read the text first" }).click();
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
  await expect(page.getByText("Customer not named")).toHaveCount(2);

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
  // Done steps folded; reasons open on tap.
  await expect(page.getByRole("button", { name: "Show the 2 steps done" })).toBeVisible();
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
  await expect(page.getByRole("link", { name: /Listen together/ })).toBeVisible();
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
  }
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
  await page.getByRole("tab", { name: "List" }).click();
  await expect(page.getByRole("heading", { name: "Call these people" })).toBeVisible();
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
