import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL || "admin@pestlaunch.local";
const PASSWORD = process.env.E2E_PASSWORD || "";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // First sign-in asks which environment to use.
  await expect(page.getByRole("dialog", { name: "Choose an environment" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /Cloud/ }).click();
  await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible();
}

test("signs in and every page renders without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await signIn(page);
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
