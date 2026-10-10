import { expect, test } from "@playwright/test";
import { EMAIL, signIn } from "./helpers";

test("signs in and every page renders without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await signIn(page);
  // v1 is still there, one link away.
  await page.goto("/calls");
  await expect(page).toHaveTitle(/Calls/);

  for (const [tab, title] of [
    ["Pipeline", /Pipeline/],
    ["Reps", /Reps/],
    ["Call Log", /Call Log/],
    ["Overview", /Calls/],
  ] as const) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page).toHaveTitle(title);
  }

  // The v2 owner views render too.
  for (const [path, heading] of [
    ["/v2", /^Good (morning|afternoon|evening)$/],
    ["/v2/pipeline", "Call back"],
    ["/v2/reps", "Team"],
    ["/v2/calls", "Calls"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
  }

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill("definitely-not-it");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
});
