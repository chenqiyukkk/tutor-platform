// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { sessionCookieNames } from "@/features/auth/session";

import { createDirectoryDetailAuthorizer } from "./detail-auth";
import { createDirectoryHandlers } from "./route-handler";
import type { DirectoryRepository } from "./repository";
import type { RequestDirectoryQuery, TeacherDirectoryQuery } from "./query";

const teacherPreview = { id: "11111111-1111-4111-8111-111111111111", publicNickname: "林老师" };
const requestPreview = { id: "22222222-2222-4222-8222-222222222222", title: "初二数学" };

function repositoryStub(): DirectoryRepository {
  return {
    async listTeachers(query: TeacherDirectoryQuery) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    },
    async getTeacherPreview(id: string) { return id === teacherPreview.id ? teacherPreview : null; },
    async getTeacherDetail(id: string) { return id === teacherPreview.id ? { ...teacherPreview, bio: "认证家长可见的教师自述" } : null; },
    async listRequests(query: RequestDirectoryQuery) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    },
    async getRequestPreview(id: string) { return id === requestPreview.id ? requestPreview : null; },
    async getRequestDetail(id: string) { return id === requestPreview.id ? { ...requestPreview, description: "认证教师可见的需求详情", publicLocationNote: "商圈附近" } : null; },
  } as unknown as DirectoryRepository;
}

const authenticateDetail = async (request: Request, role: "parent" | "teacher") =>
  request.headers.get("x-session-role") === role;

describe("public directory route handlers", () => {
  it.each([
    ["teachers", "https://example.test/api/directory/teachers?unknown=yes"],
    ["teachers", "https://example.test/api/directory/teachers?page=1&page=2"],
    ["requests", "https://example.test/api/directory/requests?identityType=OTHER"],
    ["requests", "https://example.test/api/directory/requests?pageSize=25"],
  ] as const)("returns 400 for invalid %s query", async (kind, url) => {
    const handlers = createDirectoryHandlers(repositoryStub());
    const response = await handlers[kind].GET(new Request(url));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_QUERY" });
  });

  it("returns explicit pagination metadata for valid lists", async () => {
    const response = await createDirectoryHandlers(repositoryStub()).teachers.GET(
      new Request("https://example.test/api/directory/teachers?page=2&pageSize=6"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      teachers: [],
      pagination: { page: 2, pageSize: 6, total: 0, totalPages: 0 },
    });
  });

  it("returns 404 for absent details and rejects malformed public ids", async () => {
    const handlers = createDirectoryHandlers(repositoryStub());
    const request = new Request("https://example.test");
    const missing = await handlers.requests.detail(request, "11111111-1111-4111-8111-111111111111");
    const malformed = await handlers.teachers.detail(request, "not-a-uuid");

    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ code: "INVALID_QUERY" });
  });

  it("returns only teacher preview anonymously or to the wrong role, and detail to a parent session", async () => {
    const handlers = createDirectoryHandlers(repositoryStub(), authenticateDetail);
    const anonymous = await handlers.teachers.detail(new Request("https://example.test"), teacherPreview.id);
    const wrongRole = await handlers.teachers.detail(new Request("https://example.test", { headers: { "x-session-role": "teacher" } }), teacherPreview.id);
    const parent = await handlers.teachers.detail(new Request("https://example.test", { headers: { "x-session-role": "parent" } }), teacherPreview.id);

    await expect(anonymous.json()).resolves.toEqual({ access: "preview", teacher: teacherPreview });
    await expect(wrongRole.json()).resolves.toEqual({ access: "preview", teacher: teacherPreview });
    await expect(parent.json()).resolves.toEqual({
      access: "detail",
      teacher: { ...teacherPreview, bio: "认证家长可见的教师自述" },
    });
  });

  it("returns request detail only to a teacher session", async () => {
    const handlers = createDirectoryHandlers(repositoryStub(), authenticateDetail);
    const anonymous = await handlers.requests.detail(new Request("https://example.test"), requestPreview.id);
    const teacher = await handlers.requests.detail(new Request("https://example.test", { headers: { "x-session-role": "teacher" } }), requestPreview.id);

    await expect(anonymous.json()).resolves.toEqual({ access: "preview", request: requestPreview });
    await expect(teacher.json()).resolves.toEqual({
      access: "detail",
      request: { ...requestPreview, description: "认证教师可见的需求详情", publicLocationNote: "商圈附近" },
    });
  });

  it.each([
    `${sessionCookieNames.parent}=%E0%A4%A`,
    `${sessionCookieNames.parent}=first; ${sessionCookieNames.parent}=second`,
  ])("degrades unsafe detail cookies to an anonymous preview", async (cookie) => {
    const authenticate = vi.fn(async () => undefined);
    const handlers = createDirectoryHandlers(
      repositoryStub(),
      createDirectoryDetailAuthorizer(authenticate),
    );
    const response = await handlers.teachers.detail(
      new Request("https://example.test", { headers: { cookie } }),
      teacherPreview.id,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ access: "preview", teacher: teacherPreview });
    expect(authenticate).not.toHaveBeenCalled();
  });
});
