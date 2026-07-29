import { expect, test, type BrowserContext } from "@playwright/test";

const password = "e2e-password-long-enough";

async function register(context: BrowserContext, role: "teacher" | "parent", suffix: string) {
  const page = await context.newPage();
  const username = `e2e-${role}-${suffix}`;
  await page.goto(`/${role}/register`);
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("邮箱").fill(`${username}@example.test`);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: `注册${role === "teacher" ? "老师" : "家长"}账户` }).click();
  await expect(page).toHaveURL(new RegExp(`/${role}/dashboard$`, "u"), { timeout: 20_000 });
  return page;
}

test("teacher and parent register through independent portals", async ({ browser, baseURL }) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const teacher = await browser.newContext();
  const parent = await browser.newContext();
  try {
    await register(teacher, "teacher", suffix);
    await register(parent, "parent", suffix);
    const teacherCrossPortal = await teacher.newPage();
    await teacherCrossPortal.goto("/parent/dashboard");
    await expect(teacherCrossPortal).toHaveURL(/\/parent\/login$/u);
    const parentCrossPortal = await parent.newPage();
    await parentCrossPortal.goto("/teacher/dashboard");
    await expect(parentCrossPortal).toHaveURL(/\/teacher\/login$/u);
  } finally {
    for (const [context, realm] of [[teacher, "teacher"], [parent, "parent"]] as const) {
      await context.request.post(`/api/account/delete?realm=${realm}`, {
        headers: { origin: new URL(baseURL!).origin },
        data: { confirmation: "注销账户", password },
      }).catch(() => undefined);
      await context.close();
    }
  }
});
