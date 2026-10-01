import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { cleanPests } from "../lib/v2";
import { CALL_ID, LEAD_ID, REP_ID, mockApi } from "./v2-fixtures";

/*
 * The v2 owner screens against made-up data: no server and no real calls.
 * Run against `next start`: E2E_BASE_URL=http://localhost:3100 npx playwright test v2
 */

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => {
    throw err;
  });
});

test("Today shows the verdict, three areas and the top three things to do", async ({ page }) => {
  await mockApi(page);
  await page.goto("/v2");
  await expect(page.getByText("Customer problems are often not fixed on the call.")).toBeVisible();
  await expect(page.getByText("New customers", { exact: true })).toBeVisible();
  const todo = page.locator("ol.group-list > li");
  await expect(todo).toHaveCount(3);
  await page.getByRole("button", { name: "Show 2 more" }).click();
  await expect(todo).toHaveCount(5);
  await expect(page.getByText("Explain the plan").first()).toBeVisible();
  await expect(page.getByText(/Start with Dana/)).toBeVisible();
  await expect(page.getByText("Managers kept 95% of the AI's step marks (3 calls corrected)")).toBeVisible();
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

test("a team member's page shows the three answers", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/v2/reps/${REP_ID}`);
  await expect(page.getByRole("heading", { name: "Dana", level: 1 })).toBeVisible();
  for (const heading of ["Good at", "Needs work on", "What to teach"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
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
    await mockApi(page);
    for (const path of ["/v2", "/v2/pipeline", "/v2/reps", "/v2/calls", `/v2/calls/${CALL_ID}`, `/v2/reps/${REP_ID}`]) {
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
