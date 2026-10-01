import { expect, type Page } from "@playwright/test";

export const EMAIL = process.env.E2E_EMAIL || "admin@pestlaunch.local";
export const PASSWORD = process.env.E2E_PASSWORD || "";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // First sign-in asks which environment to use.
  await expect(page.getByRole("dialog", { name: "Choose an environment" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /Cloud/ }).click();
  // Signing in opens v2.
  await expect(page).toHaveURL(/\/v2$/);
  await expect(page.getByRole("heading", { name: /^Today/, level: 1 })).toBeVisible();
}
