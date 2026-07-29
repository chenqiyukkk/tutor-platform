import { expect, test } from "@playwright/test";

for (const role of ["teacher", "parent", "admin"] as const) {
  test(`logged-out users cannot open the ${role} dashboard`, async ({ page }) => {
    await page.goto(`/${role}/dashboard`);
    await expect(page).toHaveURL(new RegExp(`/${role}/login$`, "u"));
  });
}

test("unsafe API requests reject a cross-origin caller", async ({ request, baseURL }) => {
  const response = await request.post("/api/auth/parent/login", {
    headers: { origin: "https://attacker.example" },
    data: { identifier: "nobody", password: "not-a-password" },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
  expect(baseURL).toBeTruthy();
});
