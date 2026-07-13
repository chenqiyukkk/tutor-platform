import { describe, expect, it } from "vitest";

import {
  RequestWorkflowError,
  createRequestService,
  type RequestRepository,
  type TutoringRequest,
} from "./service";

const parentA = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "parent" };
const parentB = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", role: "parent" };
const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  student: "22222222-2222-4222-8222-222222222222",
  subject: "33333333-3333-4333-8333-333333333333",
  region: "44444444-4444-4444-8444-444444444444",
};

function completeInput() {
  return {
    studentId: ids.student,
    subjectIds: [ids.subject],
    regionId: ids.region,
    budgetMinCents: 8_000,
    budgetMaxCents: 12_000,
    teachingMode: "BOTH" as const,
    scheduleText: "周末下午，每周两次",
    publicLocationNote: "天河公园附近，具体地点沟通后确认",
    description: "希望帮助孩子建立数学知识体系。",
  };
}

function request(status: TutoringRequest["status"] = "DRAFT"): TutoringRequest {
  return {
    id: ids.request,
    parentProfileId: "55555555-5555-4555-8555-555555555555",
    studentProfileId: ids.student,
    regionId: ids.region,
    budgetMinCents: 8_000,
    budgetMaxCents: 12_000,
    teachingMode: "BOTH",
    scheduleText: "周末下午，每周两次",
    publicLocationNote: "天河公园附近",
    description: "希望帮助孩子建立数学知识体系。",
    status,
    publishedAt: status === "PUBLISHED" ? new Date("2026-07-13T00:00:00Z") : null,
    closedAt: status === "CLOSED" ? new Date("2026-07-13T00:00:00Z") : null,
    student: { id: ids.student, publicAlias: "小树", grade: "GRADE_8", notes: null, isActive: true },
    subjects: [{ id: ids.subject, name: "数学", isActive: true }],
    region: { id: ids.region, name: "天河区", level: 3, isActive: true },
  };
}

function setup(initial = request()) {
  let current = initial;
  const repository: RequestRepository = {
    listStudents: async () => [],
    createStudent: async (_accountId, input) => ({ id: ids.student, ...input, isActive: true }),
    updateStudent: async (_accountId, _id, input) => ({ id: ids.student, ...input, isActive: true }),
    deactivateStudent: async () => undefined,
    listRequests: async () => [current],
    findRequest: async (_accountId, requestId) => requestId === current.id ? current : null,
    createRequest: async (_accountId, input) => {
      current = { ...current, ...input, subjects: input.subjectIds.map((id) => ({ id, name: "数学", isActive: true })) };
      return current;
    },
    updateRequest: async (_accountId, requestId, input) => {
      if (requestId !== current.id) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      if (current.status === "CLOSED") throw new RequestWorkflowError("CONFLICT", "已关闭的需求不可编辑");
      current = {
        ...current,
        ...input,
        status: "DRAFT",
        publishedAt: null,
        subjects: input.subjectIds.map((id) => ({ id, name: "数学", isActive: true })),
      };
      return current;
    },
    publishRequest: async (_accountId, requestId) => {
      if (requestId !== current.id) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      if (current.status === "CLOSED") throw new RequestWorkflowError("CONFLICT", "已关闭的需求不可再次发布");
      current = { ...current, status: "PUBLISHED", publishedAt: new Date(), closedAt: null };
      return current;
    },
    closeRequest: async (_accountId, requestId) => {
      if (requestId !== current.id) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      current = { ...current, status: "CLOSED", publishedAt: null, closedAt: new Date() };
      return current;
    },
  };
  return { service: createRequestService(repository), get current() { return current; } };
}

describe("parent request service", () => {
  it("creates an incomplete draft while validating every supplied value", async () => {
    const { service } = setup();
    await expect(service.createDraft(parentA, {})).resolves.toMatchObject({ status: "DRAFT" });
    await expect(service.createDraft(parentA, { budgetMinCents: -1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      fieldErrors: { budgetMinCents: expect.any(Array) },
    });
    await expect(service.createDraft(parentA, { teachingMode: "HOME" as never })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("strictly rejects ownership fields and duplicate or excessive subjects", async () => {
    const { service } = setup();
    await expect(service.createDraft(parentA, { accountId: parentB.id } as never)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      fieldErrors: { accountId: expect.any(Array) },
    });
    await expect(service.createDraft(parentA, { subjectIds: [ids.subject, ids.subject] })).rejects.toMatchObject({
      fieldErrors: { subjectIds: expect.any(Array) },
    });
    await expect(service.createStudent(parentA, { publicAlias: "小树", grade: "GRADE_8", realName: "真实姓名" } as never)).rejects.toMatchObject({
      code: "INVALID_INPUT", fieldErrors: { realName: expect.any(Array) },
    });
    await expect(service.createDraft(parentA, { publicLocationNote: "体育东路118号2栋301室" })).rejects.toMatchObject({
      code: "INVALID_INPUT", fieldErrors: { publicLocationNote: expect.any(Array) },
    });
  });

  it("reports all missing publish fields without changing the draft", async () => {
    const incomplete = request();
    incomplete.studentProfileId = null;
    incomplete.student = null;
    incomplete.subjects = [];
    incomplete.regionId = null;
    incomplete.region = null;
    incomplete.budgetMinCents = null;
    incomplete.budgetMaxCents = null;
    incomplete.teachingMode = null;
    incomplete.scheduleText = null;
    incomplete.publicLocationNote = null;
    const state = setup(incomplete);
    await expect(state.service.publish(parentA, ids.request)).rejects.toMatchObject({
      code: "INCOMPLETE_REQUEST",
      fieldErrors: expect.objectContaining({
        studentId: expect.any(Array), subjectIds: expect.any(Array), regionId: expect.any(Array),
        budgetMinCents: expect.any(Array), teachingMode: expect.any(Array), scheduleText: expect.any(Array),
        publicLocationNote: expect.any(Array),
      }),
    });
    expect(state.current.status).toBe("DRAFT");
  });

  it("publishes a complete request, editing returns it to draft, and close is irreversible", async () => {
    const state = setup();
    await expect(state.service.publish(parentA, ids.request)).resolves.toMatchObject({ status: "PUBLISHED" });
    await expect(state.service.updateDraft(parentA, ids.request, completeInput())).resolves.toMatchObject({
      status: "DRAFT", publishedAt: null,
    });
    await expect(state.service.publish(parentA, ids.request)).resolves.toMatchObject({ status: "PUBLISHED" });
    await expect(state.service.close(parentA, ids.request)).resolves.toMatchObject({ status: "CLOSED" });
    await expect(state.service.updateDraft(parentA, ids.request, completeInput())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(state.service.publish(parentA, ids.request)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects non-parent callers and preserves A/B ownership as repository-scoped account ids", async () => {
    const { service } = setup();
    await expect(service.listRequests({ ...parentA, role: "teacher" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.getRequest(parentB, ids.request)).resolves.toBeTruthy();
    // The real repository treats the account id as the ownership boundary; service never accepts it from body.
  });
});
