import { expect, type Page } from "@playwright/test";

export const EMAIL = process.env.E2E_EMAIL || "admin@pestlaunch.local";
export const PASSWORD = process.env.E2E_PASSWORD || "";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Signing in opens v2 straight away: no questions first.
  await expect(page).toHaveURL(/\/v2$/);
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/, level: 1 })).toBeVisible();
}
