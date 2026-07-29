import { expect, test } from "@playwright/test";

for (const path of ["/teachers", "/requests"] as const) {
  test(`anonymous directory ${path} does not render direct contact details`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u);
    expect(text).not.toMatch(/(?:\+?86[- ]?)?1[3-9]\d{9}/u);
  });
}
