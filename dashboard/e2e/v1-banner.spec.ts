import { expect, test } from "@playwright/test";
import { CALL_ID, REP_ID, mockApi } from "./v2-fixtures";

// Every v1 calls page points to the same page in v2.
for (const [v1, v2] of [
  ["/calls", "/v2"],
  ["/calls/pipeline", "/v2/pipeline"],
  ["/calls/reps", "/v2/reps"],
  ["/calls/log", "/v2/calls"],
  [`/calls/${CALL_ID}`, `/v2/calls/${CALL_ID}`],
  [`/calls/reps/${REP_ID}`, `/v2/reps/${REP_ID}`],
]) {
  test(`v1 ${v1} links to ${v2}`, async ({ page }) => {
    // v1 reads its own endpoints; leave them loading, since only the banner is under test.
    await mockApi(page, { "^GET /intel/(?!team)": () => new Promise(() => undefined) });
    await page.goto(v1);
    await expect(page.getByText("You're viewing version 1.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open this page in v2 ›" })).toHaveAttribute("href", v2);
  });
}

test("the home page and the sidebar's Calls open v2", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/v2$/);
  // Settings reads endpoints the made-up data doesn't cover; keep them off the real API.
  await page.route(/\/settings/, (route) =>
    ["fetch", "xhr"].includes(route.request().resourceType()) ? route.abort() : route.fallback(),
  );
  await page.goto("/settings");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Calls" })).toHaveAttribute("href", "/v2");
});
