// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { AuthError } from "@/features/auth/service";

import { createTeacherProfileHandlers } from "./route-handler";
import { TeacherProfileError, type TeacherProfile } from "./service";

const account = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  role: "teacher" as const,
  status: "active" as const,
  username: "teacher-a",
  email: "a@example.test",
};

const profile: TeacherProfile = {
  id: "99999999-9999-4999-8999-999999999999",
  accountId: account.id,
  publicNickname: "林老师",
  identityType: "FULL_TIME_TEACHER",
  bio: "十年一线教学经验，擅长帮助学生建立清晰的知识体系。",
  yearsExperience: 10,
  online: true,
  rateMinCents: 10000,
  rateMaxCents: 16000,
  status: "DRAFT",
  publishedAt: null,
  subjects: [{ id: "11111111-1111-4111-8111-111111111111", name: "数学" }],
  primaryRegion: { id: "22222222-2222-4222-8222-222222222222", name: "天河区" },
  extraRegions: [],
};

function setup() {
  const authenticate = vi.fn().mockResolvedValue(account);
  const service = {
    get: vi.fn().mockResolvedValue(profile),
    saveDraft: vi.fn().mockResolvedValue(profile),
    preview: vi.fn().mockResolvedValue(profile),
    publish: vi.fn().mockResolvedValue({ ...profile, status: "PUBLISHED" }),
    unpublish: vi.fn().mockResolvedValue(profile),
  };
  return { authenticate, service, handlers: createTeacherProfileHandlers({ authenticate, service }) };
}

describe("/api/teacher/profile handlers", () => {
  it("does not expose PATCH because profile saves are full replacements", () => {
    const { handlers } = setup();
    expect(handlers).not.toHaveProperty("PATCH");
  });

  it("GET authenticates from the teacher cookie and returns only the current profile DTO", async () => {
    const { authenticate, handlers } = setup();
    const response = await handlers.GET(new Request("http://localhost/api/teacher/profile", {
      headers: { cookie: "tutor_teacher_session=session-token" },
    }));

    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith("session-token");
    const payload = await response.json();
    expect(payload.profile).not.toHaveProperty("id");
    expect(payload.profile).not.toHaveProperty("accountId");
    expect(payload.profile).toMatchObject({ publicNickname: "林老师" });
  });

  it("PUT rejects accountId and returns field-level validation errors", async () => {
    const { handlers, service } = setup();
    service.saveDraft.mockRejectedValue(new TeacherProfileError(
      "INVALID_INPUT",
      "教师资料校验失败",
      { accountId: ["请求中包含不允许的字段"] },
    ));
    const response = await handlers.PUT(new Request("http://localhost/api/teacher/profile", {
      method: "PUT",
      headers: { cookie: "tutor_teacher_session=session-token" },
      body: JSON.stringify({ accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "教师资料校验失败",
      code: "INVALID_INPUT",
      fieldErrors: { accountId: ["请求中包含不允许的字段"] },
    });
  });

  it.each(["publish", "unpublish"] as const)("POST performs the %s action", async (action) => {
    const { handlers, service } = setup();
    const response = await handlers.POST(new Request("http://localhost/api/teacher/profile", {
      method: "POST",
      headers: { cookie: "tutor_teacher_session=session-token" },
      body: JSON.stringify({ action }),
    }));
    expect(response.status).toBe(200);
    expect(service[action]).toHaveBeenCalledWith(account);
  });

  it("maps missing profiles and authentication failures to stable 404/401 responses", async () => {
    const missing = setup();
    missing.service.get.mockRejectedValue(new TeacherProfileError("NOT_FOUND", "教师资料不存在"));
    expect((await missing.handlers.GET(new Request("http://localhost/api/teacher/profile"))).status)
      .toBe(404);

    const unauthorized = setup();
    unauthorized.authenticate.mockRejectedValue(new AuthError("UNAUTHORIZED", "请先登录"));
    expect((await unauthorized.handlers.GET(new Request("http://localhost/api/teacher/profile"))).status)
      .toBe(401);
  });

  it.each([
    ["GET", undefined],
    ["PUT", undefined],
    ["POST publish", undefined],
    ["POST unpublish", undefined],
    ["GET", "parent-token"],
    ["PUT", "parent-token"],
    ["POST publish", "parent-token"],
    ["POST unpublish", "parent-token"],
  ])("rejects %s for missing or non-teacher session before profile access", async (operation, token) => {
    const guarded = setup();
    guarded.authenticate.mockRejectedValue(new AuthError("UNAUTHORIZED", "登录状态无效或已过期"));
    const method = operation.split(" ")[0] as "GET" | "PUT" | "POST";
    const action = operation.split(" ")[1];
    const request = new Request("http://localhost/api/teacher/profile", {
      method,
      headers: token ? { cookie: `tutor_teacher_session=${token}` } : undefined,
      body: method === "GET" ? undefined : JSON.stringify(method === "POST" ? { action } : {}),
    });

    const response = await guarded.handlers[method](request);
    expect(response.status).toBe(401);
    expect(guarded.authenticate).toHaveBeenCalledWith(token);
    expect(guarded.service.get).not.toHaveBeenCalled();
    expect(guarded.service.saveDraft).not.toHaveBeenCalled();
    expect(guarded.service.publish).not.toHaveBeenCalled();
    expect(guarded.service.unpublish).not.toHaveBeenCalled();
  });
});
