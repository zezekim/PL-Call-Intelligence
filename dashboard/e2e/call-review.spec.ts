import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Uses the synthetic call from `python -m callsentry.scripts.e2e_fixture`.
test("a manager settles a disputed step and ticks off a follow-up", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await signIn(page);

  // Disputed steps surface in the call log filter.
  await page.goto("/calls/log?disputed=1");
  await expect(page.getByText("1 disputed step").first()).toBeVisible();
  await page.getByRole("link", { name: /Casey Example/ }).first().click();
  await expect(page.getByRole("heading", { name: "Casey Example", level: 1 })).toBeVisible();

  const score = page.locator("p.tnum").filter({ hasText: /^\d+\/\d+$/ }).first();
  const before = await score.textContent();
  const [got, max] = (before ?? "").split("/").map(Number);

  // Settle the disputed step as met: the total goes up by one.
  const step = page.getByRole("button", { name: /Summary Statement.*Disputed/ });
  await step.click();
  await page.getByRole("button", { name: "Disagree? Mark as met" }).click();
  await page.getByLabel("Reason for the change").fill("Recap was given before the price");
  await page.getByRole("button", { name: "Mark as met" }).click();
  await expect(page.getByText(/Changed to met by/)).toBeVisible();
  await expect(score).toHaveText(`${got + 1}/${max}`);

  // Tick the follow-up; it stays done after a reload.
  const box = page.getByRole("checkbox", { name: "Mark as done" }).first();
  await box.click();
  await expect(page.getByRole("checkbox", { name: "Mark as not done" }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Mark as not done" }).first()).toBeVisible();

  await expect(page.getByRole("button", { name: "Print report" })).toBeEnabled();

  // Put everything back so the suite can run again against the same data.
  await page.getByRole("checkbox", { name: "Mark as not done" }).first().click();
  await expect(page.getByRole("checkbox", { name: "Mark as done" }).first()).toBeVisible();
  await page.getByRole("button", { name: /Summary Statement/ }).click();
  await page.getByRole("button", { name: "Undo change" }).click();
  await expect(score).toHaveText(`${got}/${max}`);

  expect(errors).toEqual([]);
});
