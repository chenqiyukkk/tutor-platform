import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "@/features/auth/service";

import { createAdminModerationHandlers } from "./admin-route-handler";
import { AdminModerationError } from "./admin-service";

const ids = {
  admin: "10000000-0000-4000-8000-000000000001",
  target: "20000000-0000-4000-8000-000000000001",
  request: "30000000-0000-4000-8000-000000000001",
};
const expectedUpdatedAt = "2026-07-14T08:00:00.000Z";

function request(path: string, body: unknown, cookie = "tutor_admin_session=admin-token") {
  return new Request(`http://test${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

function setup(account: {
  id: string;
  role: "teacher" | "parent" | "admin";
  status: "active" | "suspended" | "disabled";
} = { id: ids.admin, role: "admin", status: "active" }) {
  const authenticate = vi.fn(async (_role: "admin", token: string | undefined) => {
    if (!token) throw new AuthError("UNAUTHORIZED", "missing");
    return { ...account, username: "private-admin", email: "private@example.test" };
  });
  const moderationService = {
    updateAccount: vi.fn(async () => ({ status: "SUSPENDED" as const, updatedAt: expectedUpdatedAt })),
    decideReport: vi.fn(async () => ({ status: "RESOLVED" as const, updatedAt: expectedUpdatedAt, resolutionAction: "NONE" as const })),
    decideVerification: vi.fn(async () => ({ status: "APPROVED" as const, updatedAt: expectedUpdatedAt, reviewedAt: expectedUpdatedAt })),
    readVerificationEvidence: vi.fn(async () => ({ bytes: Buffer.from("image"), mimeType: "image/png" as const })),
  };
  return {
    authenticate,
    moderationService,
    handlers: createAdminModerationHandlers({ authenticate, moderationService }),
  };
}

describe("admin moderation routes", () => {
  it("authenticates the unique admin cookie and returns minimal no-store mutation DTOs", async () => {
    const { handlers, authenticate, moderationService } = setup();
    const body = {
      clientRequestId: ids.request,
      expectedUpdatedAt,
      status: "SUSPENDED",
      reason: "违反平台规则",
    };
    const response = await handlers.users.PATCH(request(`/api/admin/users/${ids.target}`, body), ids.target);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ user: { status: "SUSPENDED", updatedAt: expectedUpdatedAt } });
    expect(authenticate).toHaveBeenCalledWith("admin", "admin-token");
    expect(moderationService.updateAccount).toHaveBeenCalledWith({ id: ids.admin, role: "admin" }, ids.target, body);
  });

  it.each([
    [{ id: ids.admin, role: "teacher" as const, status: "active" as const }, "tutor_admin_session=token"],
    [{ id: ids.admin, role: "admin" as const, status: "suspended" as const }, "tutor_admin_session=token"],
    [{ id: ids.admin, role: "admin" as const, status: "active" as const }, "tutor_admin_session=one; tutor_admin_session=two"],
  ])("rejects non-active-admin sessions and duplicate cookies", async (account, cookie) => {
    const { handlers, moderationService } = setup(account);
    const response = await handlers.users.PATCH(request(`/api/admin/users/${ids.target}`, {
      clientRequestId: ids.request, expectedUpdatedAt, status: "SUSPENDED", reason: "违反平台规则",
    }, cookie), ids.target);
    expect(response.status).toBe(401);
    expect(moderationService.updateAccount).not.toHaveBeenCalled();
  });

  it("rejects invalid ids, query keys, unknown JSON keys, media types and oversized bodies", async () => {
    const { handlers, moderationService } = setup();
    const valid = {
      clientRequestId: ids.request,
      expectedUpdatedAt,
      decision: "APPROVE",
    };
    expect((await handlers.verifications.PATCH(request(`/api/admin/verifications/not-uuid`, valid), "not-uuid")).status).toBe(400);
    expect((await handlers.verifications.PATCH(request(`/api/admin/verifications/${ids.target}?debug=1`, valid), ids.target)).status).toBe(400);
    expect((await handlers.verifications.PATCH(request(`/api/admin/verifications/${ids.target}`, { ...valid, accountId: ids.admin }), ids.target)).status).toBe(400);
    const unsupported = new Request(`http://test/api/admin/verifications/${ids.target}`, {
      method: "PATCH", headers: { "content-type": "text/plain", cookie: "tutor_admin_session=token" }, body: "bad",
    });
    expect((await handlers.verifications.PATCH(unsupported, ids.target)).status).toBe(415);
    const oversized = new Request(`http://test/api/admin/verifications/${ids.target}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "content-length": "17000", cookie: "tutor_admin_session=token" },
      body: "{}",
    });
    expect((await handlers.verifications.PATCH(oversized, ids.target)).status).toBe(413);
    expect(moderationService.decideVerification).not.toHaveBeenCalled();
  });

  it("downloads evidence with private attachment headers and no metadata", async () => {
    const { handlers, moderationService } = setup();
    const response = await handlers.evidence.GET(new Request(
      `http://test/api/admin/verifications/${ids.target}/evidence`,
      { headers: { cookie: "tutor_admin_session=token" } },
    ), ids.target);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=verification-evidence.png");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("image"));
    expect(moderationService.readVerificationEvidence).toHaveBeenCalledWith({ id: ids.admin, role: "admin" }, ids.target);
  });

  it.each([
    [new AuthError("UNAUTHORIZED", "private auth"), 401, "UNAUTHORIZED"],
    [new AdminModerationError("UNAUTHORIZED", "private admin"), 401, "UNAUTHORIZED"],
    [new AdminModerationError("FORBIDDEN", "private forbidden"), 403, "FORBIDDEN"],
    [new AdminModerationError("NOT_FOUND", `private ${ids.admin}`), 404, "NOT_FOUND"],
    [new AdminModerationError("CONFLICT", "private conflict"), 409, "CONFLICT"],
    [new Error(`database leaked ${ids.admin}`), 500, "INTERNAL_ERROR"],
  ])("maps failures to generic no-store responses", async (error, status, code) => {
    const { handlers, moderationService } = setup();
    moderationService.decideReport.mockRejectedValueOnce(error);
    const response = await handlers.reports.PATCH(request(`/api/admin/reports/${ids.target}`, {
      clientRequestId: ids.request,
      expectedUpdatedAt,
      decision: "DISMISS",
      resolutionAction: "NONE",
      reviewNote: "没有发现违规",
    }), ids.target);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const json = await response.json();
    expect(json.code).toBe(code);
    expect(JSON.stringify(json)).not.toContain(ids.admin);
  });
});
