import { describe, expect, it, vi } from "vitest";

import { createAccountDeletionHandler } from "./deletion-route";

describe("account deletion route", () => {
  it("authenticates the selected realm, deletes, and expires only that session cookie", async () => {
    const authenticate = vi.fn().mockResolvedValue({ id: "10000000-0000-4000-8000-000000000001", role: "teacher" });
    const deletionService = { delete: vi.fn().mockResolvedValue({ deleted: true }) };
    const handler = createAccountDeletionHandler({ authenticate, deletionService });
    const response = await handler.POST(new Request("https://tutor.example/api/account/delete?realm=teacher", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "tutor_teacher_session=token" },
      body: JSON.stringify({ confirmation: "注销账户", password: "valid-password" }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(authenticate).toHaveBeenCalledWith("teacher", "token");
    expect(response.headers.get("set-cookie")).toContain("tutor_teacher_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects malformed realms, duplicate cookies and oversized JSON without calling the service", async () => {
    const authenticate = vi.fn();
    const deletionService = { delete: vi.fn() };
    const handler = createAccountDeletionHandler({ authenticate, deletionService });
    const invalidRealm = await handler.POST(new Request("https://tutor.example/api/account/delete?realm=admin", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(invalidRealm.status).toBe(400);
    const duplicate = await handler.POST(new Request("https://tutor.example/api/account/delete?realm=teacher", { method: "POST", headers: { "content-type": "application/json", cookie: "tutor_teacher_session=a; tutor_teacher_session=b" }, body: "{}" }));
    expect(duplicate.status).toBe(401);
    expect(deletionService.delete).not.toHaveBeenCalled();
  });
});
