import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "@/features/auth/service";

import { createModerationHandlers } from "./route-handler";
import { ModerationWorkflowError } from "./service";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  target: "00000000-0000-4000-8000-000000000002",
  request: "00000000-0000-4000-8000-000000000003",
  report: "00000000-0000-4000-8000-000000000004",
};

const actor = {
  id: ids.actor,
  role: "parent" as const,
  status: "active" as const,
  username: "test-parent",
  email: "private@example.test",
};

function jsonRequest(path: string, body: unknown, cookie = "tutor_parent_session=parent-token") {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

function setup() {
  const authenticate = vi.fn(async (role: "parent" | "teacher", token: string | undefined) => {
    if (!token) throw new AuthError("UNAUTHORIZED", "missing");
    return { ...actor, role };
  });
  const moderationService = {
    createReport: vi.fn(async () => ({ reportId: ids.report, status: "PENDING" })),
    createBlock: vi.fn(async () => ({ blocked: true as const })),
  };
  return {
    authenticate,
    moderationService,
    handlers: createModerationHandlers({ authenticate, moderationService }),
  };
}

describe("moderation public routes", () => {
  it("selects only the requested realm cookie and returns minimal no-store responses", async () => {
    const { handlers, authenticate, moderationService } = setup();
    const target = { kind: "teacher_profile", profileId: ids.target };
    const report = await handlers.reports.POST(jsonRequest(
      "/api/reports?realm=parent",
      { target, clientRequestId: ids.request, reason: "公开信息疑似不实" },
      "tutor_parent_session=parent-token; tutor_teacher_session=teacher-token",
    ));
    expect(report.status).toBe(201);
    expect(report.headers.get("cache-control")).toBe("no-store");
    await expect(report.json()).resolves.toEqual({ reportId: ids.report, status: "PENDING" });
    expect(authenticate).toHaveBeenCalledWith("parent", "parent-token");
    expect(moderationService.createReport).toHaveBeenCalledWith(
      { id: ids.actor, role: "parent" },
      { target, clientRequestId: ids.request, reason: "公开信息疑似不实" },
    );

    const block = await handlers.blocks.POST(jsonRequest(
      "/api/blocks?realm=teacher",
      { target: { kind: "tutoring_request", requestId: ids.target }, reason: "不希望继续互动" },
      "tutor_parent_session=parent-token; tutor_teacher_session=teacher-token",
    ));
    expect(block.status).toBe(200);
    expect(block.headers.get("cache-control")).toBe("no-store");
    const blockBody = await block.json();
    expect(blockBody).toEqual({ blocked: true });
    expect(JSON.stringify(blockBody)).not.toContain(ids.actor);
  });

  it.each([
    "tutor_parent_session=one; tutor_parent_session=two",
    "tutor_parent_session=%E0%A4%A",
  ])("treats malformed or duplicate realm cookies as unauthorized", async (cookie) => {
    const { handlers, moderationService } = setup();
    const response = await handlers.reports.POST(jsonRequest(
      "/api/reports?realm=parent",
      { target: { kind: "teacher_profile", profileId: ids.target }, clientRequestId: ids.request, reason: "公开信息疑似不实" },
      cookie,
    ));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(moderationService.createReport).not.toHaveBeenCalled();
  });

  it("rejects repeated or unknown query parameters and client-controlled account IDs", async () => {
    const { handlers, moderationService } = setup();
    const validBody = {
      target: { kind: "teacher_profile", profileId: ids.target },
      clientRequestId: ids.request,
      reason: "公开信息疑似不实",
    };
    expect((await handlers.reports.POST(jsonRequest("/api/reports?realm=parent&realm=teacher", validBody))).status).toBe(400);
    expect((await handlers.reports.POST(jsonRequest("/api/reports?realm=parent&accountId=oops", validBody))).status).toBe(400);
    for (const field of ["reportedAccountId", "blockedAccountId", "accountId"]) {
      const response = await handlers.reports.POST(jsonRequest(
        "/api/reports?realm=parent", { ...validBody, [field]: ids.actor },
      ));
      expect(response.status).toBe(400);
    }
    const nested = await handlers.blocks.POST(jsonRequest("/api/blocks?realm=parent", {
      target: { kind: "teacher_profile", profileId: ids.target, blockedAccountId: ids.actor },
      reason: "不希望继续互动",
    }));
    expect(nested.status).toBe(400);
    expect(moderationService.createReport).not.toHaveBeenCalled();
    expect(moderationService.createBlock).not.toHaveBeenCalled();
  });

  it("maps media type, malformed JSON, and oversized bodies without invoking services", async () => {
    const { handlers, moderationService } = setup();
    const unsupported = await handlers.reports.POST(new Request("http://test/api/reports?realm=parent", {
      method: "POST",
      headers: { "content-type": "text/plain", cookie: "tutor_parent_session=token" },
      body: "not-json",
    }));
    expect(unsupported.status).toBe(415);
    const malformed = await handlers.reports.POST(new Request("http://test/api/reports?realm=parent", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "tutor_parent_session=token" },
      body: "{",
    }));
    expect(malformed.status).toBe(400);
    const oversized = await handlers.reports.POST(new Request("http://test/api/reports?realm=parent", {
      method: "POST",
      headers: {
        "content-type": "application/json", "content-length": "17000", cookie: "tutor_parent_session=token",
      },
      body: "{}",
    }));
    expect(oversized.status).toBe(413);
    expect(moderationService.createReport).not.toHaveBeenCalled();
  });

  it.each([
    [new AuthError("UNAUTHORIZED", "private auth detail"), 401, "UNAUTHORIZED"],
    [new ModerationWorkflowError("UNAUTHORIZED", "private actor detail"), 401, "UNAUTHORIZED"],
    [new ModerationWorkflowError("FORBIDDEN", "private self detail"), 403, "FORBIDDEN"],
    [new ModerationWorkflowError("NOT_FOUND", `secret target ${ids.actor}`), 404, "NOT_FOUND"],
    [new ModerationWorkflowError("CONFLICT", "open report exists"), 409, "CONFLICT"],
  ])("maps workflow errors without leaking private identifiers", async (error, status, code) => {
    const { handlers, moderationService } = setup();
    moderationService.createReport.mockRejectedValueOnce(error);
    const response = await handlers.reports.POST(jsonRequest("/api/reports?realm=parent", {
      target: { kind: "teacher_profile", profileId: ids.target },
      clientRequestId: ids.request,
      reason: "公开信息疑似不实",
    }));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain(ids.actor);
    if (code === "NOT_FOUND") expect(body).toEqual({ code: "NOT_FOUND", error: "目标不存在" });
  });

  it("maps unknown service failures to a generic no-store 500", async () => {
    const { handlers, moderationService } = setup();
    moderationService.createReport.mockRejectedValueOnce(new Error(`database failed for ${ids.actor}`));
    const response = await handlers.reports.POST(jsonRequest("/api/reports?realm=parent", {
      target: { kind: "teacher_profile", profileId: ids.target },
      clientRequestId: ids.request,
      reason: "公开信息疑似不实",
    }));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ code: "INTERNAL_ERROR", error: "服务暂时不可用" });
    expect(JSON.stringify(body)).not.toContain(ids.actor);
  });
});
