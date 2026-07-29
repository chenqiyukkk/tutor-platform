// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { AuthError } from "@/features/auth/service";
import { createRequestHandlers, createStudentHandlers } from "./route-handler";
import { RequestWorkflowError, type RequestService, type TutoringRequest } from "./service";

const account = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "parent" as const, status: "active" as const, username: "parent-a", email: "a@example.test" };
const student = { id: "22222222-2222-4222-8222-222222222222", publicAlias: "小树", grade: "GRADE_8" as const, notes: null, isActive: true };
const request: TutoringRequest = {
  id: "11111111-1111-4111-8111-111111111111", parentProfileId: "55555555-5555-4555-8555-555555555555",
  studentProfileId: student.id, regionId: null, budgetMinCents: null, budgetMaxCents: null, teachingMode: null,
  scheduleText: null, publicLocationNote: null, description: null, status: "DRAFT", publishedAt: null, closedAt: null,
  student, subjects: [], region: null,
};

function setup() {
  const authenticate = vi.fn().mockResolvedValue(account);
  const service = {
    listStudents: vi.fn().mockResolvedValue([student]), createStudent: vi.fn().mockResolvedValue(student),
    updateStudent: vi.fn().mockResolvedValue(student), deactivateStudent: vi.fn().mockResolvedValue(undefined),
    listRequests: vi.fn().mockResolvedValue([request]), getRequest: vi.fn().mockResolvedValue(request),
    createDraft: vi.fn().mockResolvedValue(request), updateDraft: vi.fn().mockResolvedValue(request),
    publish: vi.fn().mockResolvedValue({ ...request, status: "PUBLISHED" }), close: vi.fn().mockResolvedValue({ ...request, status: "CLOSED" }),
  } as unknown as RequestService;
  return { authenticate, service, students: createStudentHandlers({ authenticate, service }), requests: createRequestHandlers({ authenticate, service }) };
}

describe("parent students and requests handlers", () => {
  it("authenticates the parent cookie and never exposes owner profile ids", async () => {
    const { authenticate, requests } = setup();
    const response = await requests.collection.GET(new Request("http://localhost/api/parent/requests", { headers: { cookie: "tutor_parent_session=token" } }));
    expect(authenticate).toHaveBeenCalledWith("token");
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.requests[0]).not.toHaveProperty("parentProfileId");
  });

  it("provides only full replacement writes and explicit publish/close actions", async () => {
    const { requests, service } = setup();
    expect(requests.collection).not.toHaveProperty("PATCH");
    expect(requests.member).not.toHaveProperty("PATCH");
    const publish = await requests.member.POST(new Request("http://localhost/api/parent/requests/id", { method: "POST", body: JSON.stringify({ action: "publish" }) }), request.id);
    expect(publish.status).toBe(200);
    expect(service.publish).toHaveBeenCalledWith(account, request.id);
  });

  it("strictly rejects owner fields with field errors", async () => {
    const { requests, service } = setup();
    vi.mocked(service.createDraft).mockRejectedValue(new RequestWorkflowError("INVALID_INPUT", "提交内容校验失败", { accountId: ["请求中包含不允许的字段"] }));
    const response = await requests.collection.POST(new Request("http://localhost/api/parent/requests", { method: "POST", body: JSON.stringify({ accountId: account.id }) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INPUT", fieldErrors: { accountId: expect.any(Array) } });
  });

  it("maps auth, missing and conflict errors to 401, 404 and 409", async () => {
    const unauthorized = setup();
    unauthorized.authenticate.mockRejectedValue(new AuthError("UNAUTHORIZED", "请先登录"));
    expect((await unauthorized.students.collection.GET(new Request("http://localhost"))).status).toBe(401);
    const errors = setup();
    vi.mocked(errors.service.getRequest).mockRejectedValue(new RequestWorkflowError("NOT_FOUND", "需求不存在"));
    expect((await errors.requests.member.GET(new Request("http://localhost"), request.id)).status).toBe(404);
    vi.mocked(errors.service.updateDraft).mockRejectedValue(new RequestWorkflowError("CONFLICT", "已关闭的需求不可编辑"));
    expect((await errors.requests.member.PUT(new Request("http://localhost", { method: "PUT", body: "{}" }), request.id)).status).toBe(409);
  });

  it("supports owned student create/update/delete", async () => {
    const { students, service } = setup();
    const body = JSON.stringify({ publicAlias: "小树", grade: "GRADE_8" });
    expect((await students.collection.POST(new Request("http://localhost", { method: "POST", body }))).status).toBe(201);
    expect((await students.member.PUT(new Request("http://localhost", { method: "PUT", body }), student.id)).status).toBe(200);
    expect((await students.member.DELETE(new Request("http://localhost", { method: "DELETE" }), student.id)).status).toBe(204);
    expect(service.deactivateStudent).toHaveBeenCalledWith(account, student.id);
  });
});
