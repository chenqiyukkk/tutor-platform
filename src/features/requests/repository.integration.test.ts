// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaRequestRepository } from "./repository";
import { RequestWorkflowError, createRequestService } from "./service";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for request integration tests");

describe("Prisma parent request repository", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const repository = new PrismaRequestRepository(prisma);
  const service = createRequestService(repository);
  const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const accountIds: string[] = [];
  const subjectIds: string[] = [];
  const regionIds: string[] = [];

  afterAll(async () => {
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    if (subjectIds.length) await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } });
    if (regionIds.length) await prisma.region.deleteMany({ where: { id: { in: regionIds } } });
    await prisma.$disconnect();
  });

  it("keeps parent A/B isolated and runs draft-publish-edit-republish-close atomically", async () => {
    const makeParent = async (suffix: string) => {
      const account = await prisma.account.create({ data: {
        role: "PARENT", username: `parent-${suffix}-${marker}`, normalizedUsername: `parent-${suffix}-${marker}`,
        email: `parent-${suffix}-${marker}@example.test`, normalizedEmail: `parent-${suffix}-${marker}@example.test`, passwordHash: "integration-only",
        parentProfile: { create: { displayName: `家长${suffix}` } },
      } });
      accountIds.push(account.id);
      return { id: account.id, role: "parent" };
    };
    const parentA = await makeParent("a");
    const parentB = await makeParent("b");
    const subjects = [];
    for (const [index, name] of ["数学", "英语"].entries()) {
      subjects.push(await prisma.subject.create({ data: { name: `${name}-${marker}`, slug: `${marker}-request-${index}` } }));
    }
    subjectIds.push(...subjects.map(({ id }) => id));
    const region = await prisma.region.create({ data: { code: `RQ${marker}`, name: "测试区", level: 3 } });
    regionIds.push(region.id);

    const studentA = await service.createStudent(parentA, { publicAlias: "小树", grade: "GRADE_8", notes: "偏科数学" });
    const studentB = await service.createStudent(parentB, { publicAlias: "小河", grade: "GRADE_7" });
    await expect(service.updateStudent(parentB, studentA.id, { publicAlias: "越权", grade: "GRADE_8" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const complete = {
      studentId: studentA.id, subjectIds: subjects.map(({ id }) => id), regionId: region.id,
      budgetMinCents: 8_000, budgetMaxCents: 12_000, teachingMode: "BOTH" as const,
      scheduleText: "周末下午", publicLocationNote: "测试区图书馆附近", description: "巩固基础",
    };
    const draft = await service.createDraft(parentA, complete);
    expect(draft.status).toBe("DRAFT");
    await expect(service.getRequest(parentB, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.updateDraft(parentB, draft.id, complete)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.createDraft(parentA, { ...complete, studentId: studentB.id })).rejects.toMatchObject({ code: "INVALID_STUDENT" });

    await expect(service.publish(parentA, draft.id)).resolves.toMatchObject({ status: "PUBLISHED", publishedAt: expect.any(Date) });
    await expect(service.updateDraft(parentA, draft.id, { ...complete, subjectIds: [subjects[0].id] })).resolves.toMatchObject({ status: "DRAFT", publishedAt: null });
    await expect(service.publish(parentA, draft.id)).resolves.toMatchObject({ status: "PUBLISHED" });
    await expect(service.close(parentA, draft.id)).resolves.toMatchObject({ status: "CLOSED", publishedAt: null, closedAt: expect.any(Date) });
    await expect(service.publish(parentA, draft.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.updateDraft(parentA, draft.id, complete)).rejects.toMatchObject({ code: "CONFLICT" });

    const before = await repository.listRequests(parentA.id);
    await prisma.subject.update({ where: { id: subjects[1].id }, data: { isActive: false } });
    await expect(service.createDraft(parentA, { ...complete, subjectIds: [subjects[1].id] })).rejects.toMatchObject({ code: "INVALID_SUBJECT" });
    await expect(repository.listRequests(parentA.id)).resolves.toEqual(before);
    await prisma.subject.update({ where: { id: subjects[1].id }, data: { isActive: true } });
    await prisma.region.update({ where: { id: region.id }, data: { isActive: false } });
    await expect(service.createDraft(parentA, complete)).rejects.toMatchObject({ code: "INVALID_REGION" });
    const afterInvalidRegion = await repository.listRequests(parentA.id);
    expect(afterInvalidRegion.map(({ id, status, budgetMinCents }) => ({ id, status, budgetMinCents })))
      .toEqual(before.map(({ id, status, budgetMinCents }) => ({ id, status, budgetMinCents })));
    await prisma.region.update({ where: { id: region.id }, data: { isActive: true } });

    await expect(prisma.tutoringRequest.update({ where: { id: draft.id }, data: { budgetMin: -1 } })).rejects.toThrow();
    await expect(repository.findRequest(parentA.id, draft.id)).resolves.toMatchObject({ budgetMinCents: 8_000 });
    expect(RequestWorkflowError).toBeDefined();
  });
});
