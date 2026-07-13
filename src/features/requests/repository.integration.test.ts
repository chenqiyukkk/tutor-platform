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

  async function requestFixture(label: string) {
    const account = await prisma.account.create({ data: {
      role: "PARENT", username: `parent-${label}-${marker}`, normalizedUsername: `parent-${label}-${marker}`,
      email: `parent-${label}-${marker}@example.test`, normalizedEmail: `parent-${label}-${marker}@example.test`, passwordHash: "integration-only",
    } });
    accountIds.push(account.id);
    await prisma.parentProfile.create({ data: { accountId: account.id, displayName: `家长${label}` } });
    const subject = await prisma.subject.create({ data: { name: `数学-${label}-${marker}`, slug: `${marker}-${label}-subject` } });
    subjectIds.push(subject.id);
    const region = await prisma.region.create({ data: { code: `R${label}${marker}`, name: `测试区${label}`, level: 3 } });
    regionIds.push(region.id);
    const caller = { id: account.id, role: "parent" };
    const student = await service.createStudent(caller, { publicAlias: `学生${label}`, grade: "GRADE_8" });
    const input = {
      studentId: student.id, subjectIds: [subject.id], regionId: region.id,
      budgetMinCents: 8_000, budgetMaxCents: 12_000, teachingMode: "BOTH" as const,
      scheduleText: "周末下午", publicLocationNote: `${region.name}商圈附近`, description: "巩固基础",
    };
    return { caller, student, input };
  }

  afterAll(async () => {
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    if (subjectIds.length) await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } });
    if (regionIds.length) await prisma.region.deleteMany({ where: { id: { in: regionIds } } });
    await prisma.$disconnect();
  });

  it("creates one parent profile when first student writes race", async () => {
    const account = await prisma.account.create({ data: {
      role: "PARENT", username: `parent-profile-race-${marker}`, normalizedUsername: `parent-profile-race-${marker}`,
      email: `parent-profile-race-${marker}@example.test`, normalizedEmail: `parent-profile-race-${marker}@example.test`, passwordHash: "integration-only",
    } });
    accountIds.push(account.id);
    const caller = { id: account.id, role: "parent" };
    const raceFunction = `test_parent_profile_race_${marker}`;
    const raceTrigger = `test_parent_profile_race_trigger_${marker}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${raceFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."accountId" = '${account.id}'::uuid THEN PERFORM pg_sleep(0.3); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER "${raceTrigger}" BEFORE INSERT ON "ParentProfile"
      FOR EACH ROW EXECUTE FUNCTION "${raceFunction}"();
    `);
    try {
      const students = await Promise.all([
        service.createStudent(caller, { publicAlias: "并发甲", grade: "GRADE_5" }),
        service.createStudent(caller, { publicAlias: "并发乙", grade: "GRADE_6" }),
      ]);
      expect(students).toHaveLength(2);
      await expect(prisma.parentProfile.count({ where: { accountId: account.id } })).resolves.toBe(1);
      await expect(prisma.studentProfile.count({ where: { parentProfile: { accountId: account.id } } })).resolves.toBe(2);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${raceTrigger}" ON "ParentProfile"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${raceFunction}"()`);
    }
  });

  it("deactivates a student and atomically demotes every published request while preserving closed requests", async () => {
    const { caller, student, input } = await requestFixture("deactivate");
    const draft = await service.createDraft(caller, input);
    const published = await service.createDraft(caller, input);
    await service.publish(caller, published.id);
    const closed = await service.createDraft(caller, input);
    const closedResult = await service.close(caller, closed.id);

    await service.deactivateStudent(caller, student.id);

    await expect(prisma.studentProfile.findUniqueOrThrow({ where: { id: student.id } })).resolves.toMatchObject({ isActive: false });
    await expect(repository.findRequest(caller.id, draft.id)).resolves.toMatchObject({ status: "DRAFT", publishedAt: null, closedAt: null });
    await expect(repository.findRequest(caller.id, published.id)).resolves.toMatchObject({ status: "DRAFT", publishedAt: null, closedAt: null });
    await expect(repository.findRequest(caller.id, closed.id)).resolves.toMatchObject({ status: "CLOSED", publishedAt: null, closedAt: closedResult.closedAt });
  });

  it("atomically rejects an unsafe alias update linked to a published request", async () => {
    const { caller, student, input } = await requestFixture("unsafe-alias-update");
    const published = await service.createDraft(caller, input);
    await service.publish(caller, published.id);

    await expect(repository.updateStudent(caller.id, student.id, {
      publicAlias: "LINE ID tutor88",
      grade: student.grade,
      notes: student.notes,
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(prisma.studentProfile.findUniqueOrThrow({ where: { id: student.id } }))
      .resolves.toMatchObject({ displayName: student.publicAlias });
    await expect(repository.findRequest(caller.id, published.id))
      .resolves.toMatchObject({ status: "PUBLISHED" });
  });

  it("serializes publish with student deactivation so no published request can reference an inactive student", async () => {
    const { caller, student, input } = await requestFixture("race");
    const draft = await service.createDraft(caller, input);
    const publishFunction = `test_request_publish_race_${marker}`;
    const publishTrigger = `test_request_publish_race_trigger_${marker}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${publishFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."id" = '${draft.id}'::uuid AND NEW."status" = 'PUBLISHED' THEN PERFORM pg_sleep(1); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER "${publishTrigger}" BEFORE UPDATE ON "TutoringRequest"
      FOR EACH ROW EXECUTE FUNCTION "${publishFunction}"();
    `);
    const publishing = repository.publishRequest(caller.id, draft.id);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const deactivating = repository.deactivateStudent(caller.id, student.id);
      await Promise.all([publishing, deactivating]);
      await expect(prisma.studentProfile.findUniqueOrThrow({ where: { id: student.id } })).resolves.toMatchObject({ isActive: false });
      await expect(repository.findRequest(caller.id, draft.id)).resolves.toMatchObject({ status: "DRAFT", publishedAt: null, closedAt: null });
    } finally {
      await publishing.catch(() => undefined);
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${publishTrigger}" ON "TutoringRequest"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${publishFunction}"()`);
    }
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

    const inactiveStudent = await service.createStudent(parentA, { publicAlias: "停用学生", grade: "GRADE_6" });
    await service.deactivateStudent(parentA, inactiveStudent.id);
    await expect(service.createDraft(parentA, { ...complete, studentId: inactiveStudent.id })).rejects.toMatchObject({ code: "INVALID_STUDENT" });

    const rollbackDraft = await service.createDraft(parentA, complete);
    const beforeRollback = await repository.findRequest(parentA.id, rollbackDraft.id);
    const rollbackFunction = `test_request_subject_rollback_${marker}`;
    const rollbackTrigger = `test_request_subject_trigger_${marker}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${rollbackFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."tutoringRequestId" = '${rollbackDraft.id}'::uuid THEN
          RAISE EXCEPTION 'forced request subject replacement failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER "${rollbackTrigger}"
      BEFORE INSERT ON "RequestSubject"
      FOR EACH ROW EXECUTE FUNCTION "${rollbackFunction}"();
    `);
    try {
      await expect(service.updateDraft(parentA, rollbackDraft.id, {
        ...complete, subjectIds: [subjects[0].id], description: "不得部分写入",
      })).rejects.toThrow("forced request subject replacement failure");
      await expect(repository.findRequest(parentA.id, rollbackDraft.id)).resolves.toEqual(beforeRollback);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${rollbackTrigger}" ON "RequestSubject"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${rollbackFunction}"()`);
    }

    const lockValidatedDraft = await service.createDraft(parentA, complete);
    await prisma.subject.update({ where: { id: subjects[0].id }, data: { isActive: false } });
    await expect(repository.publishRequest(parentA.id, lockValidatedDraft.id)).rejects.toMatchObject({ code: "INVALID_SUBJECT" });
    await expect(repository.findRequest(parentA.id, lockValidatedDraft.id)).resolves.toMatchObject({ status: "DRAFT" });
    await prisma.subject.update({ where: { id: subjects[0].id }, data: { isActive: true } });
    await prisma.region.update({ where: { id: region.id }, data: { isActive: false } });
    await expect(repository.publishRequest(parentA.id, lockValidatedDraft.id)).rejects.toMatchObject({ code: "INVALID_REGION" });
    await expect(repository.findRequest(parentA.id, lockValidatedDraft.id)).resolves.toMatchObject({ status: "DRAFT" });
    await prisma.region.update({ where: { id: region.id }, data: { isActive: true } });
    await prisma.studentProfile.update({ where: { id: studentA.id }, data: { isActive: false } });
    await expect(repository.publishRequest(parentA.id, lockValidatedDraft.id)).rejects.toMatchObject({ code: "INVALID_STUDENT" });
    await expect(repository.findRequest(parentA.id, lockValidatedDraft.id)).resolves.toMatchObject({ status: "DRAFT" });
    await prisma.studentProfile.update({ where: { id: studentA.id }, data: { isActive: true } });

    await expect(service.publish(parentA, draft.id)).resolves.toMatchObject({ status: "PUBLISHED", publishedAt: expect.any(Date) });
    await expect(service.updateDraft(parentA, draft.id, { ...complete, subjectIds: [subjects[0].id] })).resolves.toMatchObject({ status: "DRAFT", publishedAt: null });
    await expect(service.publish(parentA, draft.id)).resolves.toMatchObject({ status: "PUBLISHED" });
    await expect(service.close(parentA, draft.id)).resolves.toMatchObject({ status: "CLOSED", publishedAt: null, closedAt: expect.any(Date) });
    await expect(service.publish(parentA, draft.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.updateDraft(parentA, draft.id, complete)).rejects.toMatchObject({ code: "CONFLICT" });

    const before = await repository.listRequests(parentA.id);
    await prisma.subject.update({ where: { id: subjects[1].id }, data: { isActive: false } });
    await expect(service.createDraft(parentA, { ...complete, subjectIds: [subjects[1].id] })).rejects.toMatchObject({ code: "INVALID_SUBJECT" });
    const afterInvalidSubject = await repository.listRequests(parentA.id);
    expect(afterInvalidSubject.map(({ id, status, budgetMinCents }) => ({ id, status, budgetMinCents })))
      .toEqual(before.map(({ id, status, budgetMinCents }) => ({ id, status, budgetMinCents })));
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
