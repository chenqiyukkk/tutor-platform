// @vitest-environment node

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAdminModerationService } from "./admin-service";
import { AdminModerationError } from "./admin-service";
import { createChatService } from "@/features/chat/service";
import { accountPairLockKey } from "@/features/interactions/account-pair-lock";
import { PrismaTeacherProfileRepository } from "@/features/teachers/repository";
import { PrismaRequestRepository } from "@/features/requests/repository";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const databaseName = `admin_moderation_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = (() => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  return url.toString();
})();
const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");

const passwordHash = "integration-test-password-hash";

async function account(role: "ADMIN" | "TEACHER" | "PARENT", status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  const id = randomUUID();
  await db.account.create({
    data: {
      id,
      role,
      status,
      username: `admin-fixture-${id}`,
      normalizedUsername: `admin-fixture-${id}`,
      email: `${id}@example.test`,
      normalizedEmail: `${id}@example.test`,
      passwordHash,
    },
  });
  return id;
}

const storage = {
  enabled: true,
  write: async () => { throw new Error("unused"); },
  read: async () => Buffer.from("private-image"),
  remove: async () => undefined,
};

function service(at = "2026-07-14T09:00:00.000Z") {
  return createAdminModerationService(db, storage, () => new Date(at));
}

async function teacherFixture() {
  const teacherId = await account("TEACHER");
  const profile = await db.teacherProfile.create({
    data: {
      accountId: teacherId,
      displayName: "测试老师",
      status: "PUBLISHED",
      publishedAt: new Date(),
      publicContentSafetyVersion: 1,
    },
  });
  return { teacherId, profile };
}

async function parentRequestFixture() {
  const parentId = await account("PARENT");
  const parentProfile = await db.parentProfile.create({ data: { accountId: parentId, displayName: "测试家长" } });
  const request = await db.tutoringRequest.create({
    data: {
      parentProfileId: parentProfile.id,
      title: "测试需求",
      description: "合成数据",
      status: "PUBLISHED",
      publishedAt: new Date(),
      publicContentSafetyVersion: 1,
    },
  });
  return { parentId, parentProfile, request };
}

async function profileReport() {
  const { teacherId, profile } = await teacherFixture();
  const parentId = await account("PARENT");
  const report = await db.report.create({
    data: {
      reporterAccountId: parentId,
      reportedAccountId: teacherId,
      teacherProfileId: profile.id,
      targetType: "TEACHER_PROFILE",
      targetId: profile.id,
      reason: "OTHER",
      details: "举报正文不得进入审计",
    },
  });
  return { teacherId, profile, parentId, report };
}

async function messageReport() {
  const { teacherId } = await teacherFixture();
  const { parentId, request } = await parentRequestFixture();
  const greeting = await db.greeting.create({ data: {
    senderAccountId: teacherId,
    recipientAccountId: parentId,
    tutoringRequestId: request.id,
    contextKey: `admin-message-${randomUUID()}`,
    cardSnapshot: { version: 1, kind: "teacher", title: "测试老师", subtitle: "合成数据" },
    status: "ACCEPTED",
    expiresAt: new Date(Date.now() + 60_000),
    respondedAt: new Date(),
  } });
  const conversation = await db.conversation.create({ data: {
    greetingId: greeting.id,
    teacherId,
    parentId,
    tutoringRequestId: request.id,
  } });
  const message = await db.message.create({ data: {
    conversationId: conversation.id,
    senderAccountId: teacherId,
    clientMessageId: randomUUID(),
    body: "需要被管理员下架的合成消息",
  } });
  const report = await db.report.create({ data: {
    reporterAccountId: parentId,
    reportedAccountId: teacherId,
    tutoringRequestId: request.id,
    conversationId: conversation.id,
    messageId: message.id,
    targetType: "MESSAGE",
    targetId: message.id,
    reason: "OTHER",
  } });
  return { teacherId, parentId, conversation, message, report };
}

async function publishableProfileReport() {
  const fixture = await profileReport();
  const subject = await db.subject.create({ data: { name: `管理员并发科目-${randomUUID()}`, slug: randomUUID() } });
  const region = await db.region.create({ data: { code: `AR${randomUUID().replaceAll("-", "")}`, name: "管理员并发测试区", level: 3 } });
  await db.teacherProfile.update({ where: { id: fixture.profile.id }, data: {
    headline: "完整的合成教师标题",
    identityType: "FULL_TIME_TEACHER",
    bio: "这是用于管理员并发测试的完整合成教师简介，不包含任何真实个人资料。",
    yearsExperience: 3,
    hourlyRate: 100,
    hourlyRateMax: 150,
    subjects: { create: { subjectId: subject.id } },
    serviceAreas: { create: { regionId: region.id, isPrimary: true } },
  } });
  return fixture;
}

async function publishableRequestReport() {
  const fixture = await parentRequestFixture();
  const teacherId = await account("TEACHER");
  const subject = await db.subject.create({ data: { name: `管理员需求科目-${randomUUID()}`, slug: randomUUID() } });
  const region = await db.region.create({ data: { code: `AQ${randomUUID().replaceAll("-", "")}`, name: "管理员需求测试区", level: 3 } });
  const student = await db.studentProfile.create({ data: {
    parentProfileId: fixture.parentProfile.id, displayName: "合成学生", gradeLevel: "GRADE_8",
  } });
  await db.tutoringRequest.update({ where: { id: fixture.request.id }, data: {
    studentProfileId: student.id,
    regionId: region.id,
    budgetMin: 8_000,
    budgetMax: 12_000,
    teachingMode: "BOTH",
    scheduleText: "周末下午",
    publicLocationNote: "测试区商圈附近",
    description: "用于并发测试的完整合成需求",
    status: "DRAFT",
    publishedAt: null,
    subjects: { create: { subjectId: subject.id } },
  } });
  const report = await db.report.create({ data: {
    reporterAccountId: teacherId,
    reportedAccountId: fixture.parentId,
    tutoringRequestId: fixture.request.id,
    targetType: "TUTORING_REQUEST",
    targetId: fixture.request.id,
    reason: "OTHER",
  } });
  return { ...fixture, report };
}

describe.sequential("admin moderation transactions", () => {
  const ids: string[] = [];

  beforeAll(async () => {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    const migrated = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
      timeout: 90_000,
    });
    if (migrated.status !== 0) throw new Error(`${migrated.stdout}\n${migrated.stderr}`);
    await db.$connect();
  }, 120_000);

  afterAll(async () => {
    await db.$disconnect();
    await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await adminPool.end();
  });

  it("rechecks ACTIVE ADMIN inside the transaction and suspends an account atomically with one audit", async () => {
    const adminId = await account("ADMIN");
    const teacherId = await account("TEACHER");
    ids.push(adminId, teacherId);
    const teacherProfile = await db.teacherProfile.create({
      data: { accountId: teacherId, displayName: "测试老师", status: "PUBLISHED", publishedAt: new Date(), publicContentSafetyVersion: 1 },
    });
    await db.session.create({
      data: { accountId: teacherId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
    });

    const moderation = service();
    const target = await db.account.findUniqueOrThrow({ where: { id: teacherId }, select: { updatedAt: true } });
    const result = await moderation.updateAccount(
      { id: adminId, role: "admin" },
      teacherId,
      {
        clientRequestId: randomUUID(),
        expectedUpdatedAt: target.updatedAt.toISOString(),
        status: "SUSPENDED",
        reason: "违反平台规则",
      },
    );

    expect(result).toMatchObject({ status: "SUSPENDED" });
    expect(await db.session.count({ where: { accountId: teacherId, revokedAt: null } })).toBe(0);
    expect(await db.teacherProfile.findUniqueOrThrow({ where: { id: teacherProfile.id } })).toMatchObject({
      status: "DRAFT",
      publishedAt: null,
      publicContentSafetyVersion: 0,
    });
    expect(await db.adminAuditLog.count({ where: { adminAccountId: adminId } })).toBe(1);
    expect(result.updatedAt).toBe((await db.account.findUniqueOrThrow({ where: { id: teacherId } })).updatedAt.toISOString());
  });

  it("rejects suspended admins inside the transaction", async () => {
    const adminId = await account("ADMIN", "SUSPENDED");
    const teacherId = await account("TEACHER");
    const target = await db.account.findUniqueOrThrow({ where: { id: teacherId } });
    await expect(service().updateAccount({ id: adminId, role: "admin" }, teacherId, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: target.updatedAt.toISOString(),
      status: "SUSPENDED",
      reason: "违反平台规则",
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await db.account.findUniqueOrThrow({ where: { id: teacherId } })).status).toBe("ACTIVE");
  });

  it("checks ACTIVE ADMIN before applying the self-target prohibition", async () => {
    const activeAdminId = await account("ADMIN");
    const suspendedAdminId = await account("ADMIN", "SUSPENDED");
    const active = await db.account.findUniqueOrThrow({ where: { id: activeAdminId } });
    const suspended = await db.account.findUniqueOrThrow({ where: { id: suspendedAdminId } });
    const input = (expectedUpdatedAt: string) => ({
      clientRequestId: randomUUID(), expectedUpdatedAt,
      status: "SUSPENDED" as const, reason: "管理员不能修改自己",
    });

    await expect(service().updateAccount(
      { id: activeAdminId, role: "admin" }, activeAdminId, input(active.updatedAt.toISOString()),
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service().updateAccount(
      { id: suspendedAdminId, role: "admin" }, suspendedAdminId, input(suspended.updatedAt.toISOString()),
    )).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(db.account.findUniqueOrThrow({ where: { id: activeAdminId } })).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(db.account.findUniqueOrThrow({ where: { id: suspendedAdminId } })).resolves.toMatchObject({ status: "SUSPENDED" });
    expect(await db.adminAuditLog.count({ where: { adminAccountId: { in: [activeAdminId, suspendedAdminId] } } })).toBe(0);
  });

  it("returns UNAUTHORIZED for both existing and missing report ids before locator lookup", async () => {
    const adminId = await account("ADMIN", "SUSPENDED");
    const { report } = await profileReport();
    const input = {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: report.updatedAt.toISOString(),
      decision: "START_REVIEW" as const,
    };
    await expect(service().decideReport({ id: adminId, role: "admin" }, report.id, input))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(service().decideReport({ id: adminId, role: "admin" }, randomUUID(), {
      ...input, clientRequestId: randomUUID(),
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await db.adminAuditLog.count({ where: { adminAccountId: adminId } })).toBe(0);
  });

  it("suspends a parent without reopening already closed requests", async () => {
    const adminId = await account("ADMIN");
    const { parentId, request } = await parentRequestFixture();
    await db.tutoringRequest.update({ where: { id: request.id }, data: {
      status: "CLOSED", publishedAt: null, closedAt: new Date("2026-07-14T07:00:00.000Z"),
    } });
    const target = await db.account.findUniqueOrThrow({ where: { id: parentId } });
    await service().updateAccount({ id: adminId, role: "admin" }, parentId, {
      clientRequestId: randomUUID(), expectedUpdatedAt: target.updatedAt.toISOString(),
      status: "SUSPENDED", reason: "违反平台规则",
    });
    await expect(db.tutoringRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .resolves.toMatchObject({ status: "CLOSED", publishedAt: null, closedAt: new Date("2026-07-14T07:00:00.000Z") });
  });

  it("replays the exact request without duplicate effects and rejects conflicting requestId reuse", async () => {
    const adminId = await account("ADMIN");
    const teacherId = await account("TEACHER");
    const target = await db.account.findUniqueOrThrow({ where: { id: teacherId } });
    const clientRequestId = randomUUID();
    const input = {
      clientRequestId,
      expectedUpdatedAt: target.updatedAt.toISOString(),
      status: "SUSPENDED" as const,
      reason: "违反平台规则",
    };
    const first = await service().updateAccount({ id: adminId, role: "admin" }, teacherId, input);
    const replay = await service().updateAccount({ id: adminId, role: "admin" }, teacherId, input);
    expect(replay).toEqual(first);
    expect(await db.adminAuditLog.count({ where: { requestId: clientRequestId } })).toBe(1);
    await expect(service().updateAccount({ id: adminId, role: "admin" }, teacherId, {
      ...input,
      status: "ACTIVE",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const secondAdminId = await account("ADMIN");
    const resumed = await service().updateAccount({ id: secondAdminId, role: "admin" }, teacherId, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: first.updatedAt!,
      status: "ACTIVE",
      reason: "复核后恢复账号",
    });
    expect(resumed.status).toBe("ACTIVE");
    await expect(service().updateAccount({ id: adminId, role: "admin" }, teacherId, input))
      .resolves.toMatchObject({ status: "ACTIVE", updatedAt: resumed.updatedAt });
  });

  it("takes down profile content, creates a moderation hold and resolves the report with one sanitized audit", async () => {
    const adminId = await account("ADMIN");
    const { profile, report } = await profileReport();
    const result = await service().decideReport({ id: adminId, role: "admin" }, report.id, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: report.updatedAt.toISOString(),
      decision: "RESOLVE",
      resolutionAction: "CONTENT_TAKEDOWN",
      reviewNote: "公开内容违反平台规则",
    });
    expect(result).toMatchObject({ status: "RESOLVED", resolutionAction: "CONTENT_TAKEDOWN" });
    expect(await db.teacherProfile.findUniqueOrThrow({ where: { id: profile.id } })).toMatchObject({
      status: "DRAFT",
      publishedAt: null,
      publicContentSafetyVersion: 0,
      moderationReason: "公开内容违反平台规则",
    });
    const audits = await db.adminAuditLog.findMany({ where: { adminAccountId: adminId } });
    expect(audits).toHaveLength(1);
    const serialized = JSON.stringify(audits[0].metadata);
    expect(serialized).not.toContain("公开内容违反平台规则");
    expect(serialized).not.toContain("举报正文不得进入审计");
  });

  it("resolves an account-suspension report atomically with one sanitized REPORT_DECISION audit", async () => {
    const adminId = await account("ADMIN");
    const fixture = await profileReport();
    await db.session.create({ data: {
      accountId: fixture.teacherId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
    } });
    const clientRequestId = randomUUID();
    await service().decideReport({ id: adminId, role: "admin" }, fixture.report.id, {
      clientRequestId,
      expectedUpdatedAt: fixture.report.updatedAt.toISOString(),
      decision: "RESOLVE",
      resolutionAction: "ACCOUNT_SUSPENSION",
      reviewNote: "账号行为违反平台规则",
    });

    await expect(db.report.findUniqueOrThrow({ where: { id: fixture.report.id } })).resolves.toMatchObject({
      status: "RESOLVED", resolutionAction: "ACCOUNT_SUSPENSION", reviewerAccountId: adminId,
    });
    await expect(db.account.findUniqueOrThrow({ where: { id: fixture.teacherId } })).resolves.toMatchObject({ status: "SUSPENDED" });
    expect(await db.session.count({ where: { accountId: fixture.teacherId, revokedAt: null } })).toBe(0);
    await expect(db.teacherProfile.findUniqueOrThrow({ where: { id: fixture.profile.id } })).resolves.toMatchObject({
      status: "DRAFT", publishedAt: null, publicContentSafetyVersion: 0, moderationRejectedAt: null,
    });
    const audits = await db.adminAuditLog.findMany({ where: { requestId: clientRequestId } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "REPORT_DECISION", targetType: "REPORT", targetId: fixture.report.id });
    expect(await db.adminAuditLog.count({ where: { adminAccountId: adminId, action: "USER_STATUS" } })).toBe(0);
    expect(JSON.stringify(audits[0].metadata)).not.toMatch(/举报正文不得进入审计|账号行为违反平台规则|admin-fixture|@example\.test/);
  });

  it("hides a parent's published request when resolving an account-suspension report", async () => {
    const adminId = await account("ADMIN");
    const fixture = await parentRequestFixture();
    const reporterId = await account("TEACHER");
    await db.session.create({ data: {
      accountId: fixture.parentId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
    } });
    const report = await db.report.create({ data: {
      reporterAccountId: reporterId,
      reportedAccountId: fixture.parentId,
      tutoringRequestId: fixture.request.id,
      targetType: "TUTORING_REQUEST",
      targetId: fixture.request.id,
      reason: "OTHER",
    } });
    const clientRequestId = randomUUID();
    await service().decideReport({ id: adminId, role: "admin" }, report.id, {
      clientRequestId, expectedUpdatedAt: report.updatedAt.toISOString(),
      decision: "RESOLVE", resolutionAction: "ACCOUNT_SUSPENSION", reviewNote: "账号行为违反平台规则",
    });
    await expect(db.account.findUniqueOrThrow({ where: { id: fixture.parentId } })).resolves.toMatchObject({ status: "SUSPENDED" });
    expect(await db.session.count({ where: { accountId: fixture.parentId, revokedAt: null } })).toBe(0);
    await expect(db.tutoringRequest.findUniqueOrThrow({ where: { id: fixture.request.id } })).resolves.toMatchObject({
      status: "DRAFT", publishedAt: null, publicContentSafetyVersion: 0, moderationRejectedAt: null,
    });
    expect(await db.adminAuditLog.count({ where: { requestId: clientRequestId, action: "REPORT_DECISION" } })).toBe(1);
  });

  it("rolls back report resolution, suspension, session revocation and hiding when audit insertion fails", async () => {
    const adminId = await account("ADMIN");
    const fixture = await profileReport();
    const session = await db.session.create({ data: {
      accountId: fixture.teacherId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
    } });
    const clientRequestId = randomUUID();
    const functionName = `test_admin_audit_failure_${randomUUID().replaceAll("-", "")}`;
    const triggerName = `${functionName}_trigger`;
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."requestId" = '${clientRequestId}'::uuid THEN RAISE EXCEPTION 'synthetic audit insert failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AdminAuditLog"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
    try {
      await expect(service().decideReport({ id: adminId, role: "admin" }, fixture.report.id, {
        clientRequestId, expectedUpdatedAt: fixture.report.updatedAt.toISOString(),
        decision: "RESOLVE", resolutionAction: "ACCOUNT_SUSPENSION", reviewNote: "账号行为违反平台规则",
      })).rejects.toThrow();
      await expect(db.report.findUniqueOrThrow({ where: { id: fixture.report.id } })).resolves.toMatchObject({
        status: "PENDING", resolutionAction: null, reviewerAccountId: null,
      });
      await expect(db.account.findUniqueOrThrow({ where: { id: fixture.teacherId } })).resolves.toMatchObject({ status: "ACTIVE" });
      await expect(db.session.findUniqueOrThrow({ where: { id: session.id } })).resolves.toMatchObject({ revokedAt: null });
      await expect(db.teacherProfile.findUniqueOrThrow({ where: { id: fixture.profile.id } })).resolves.toMatchObject({
        status: "PUBLISHED", publicContentSafetyVersion: 1,
      });
      expect(await db.adminAuditLog.count({ where: { requestId: clientRequestId } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "AdminAuditLog"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  });

  it("serializes profile takedown before a concurrent owner publish so the hold cannot be bypassed", async () => {
    const adminId = await account("ADMIN");
    const fixture = await publishableProfileReport();
    const functionName = `test_admin_profile_hold_${randomUUID().replaceAll("-", "")}`;
    const triggerName = `${functionName}_trigger`;
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."id" = '${fixture.profile.id}'::uuid AND NEW."moderationRejectedAt" IS NOT NULL
          THEN PERFORM pg_sleep(0.5);
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "TeacherProfile"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
    const takedown = service().decideReport({ id: adminId, role: "admin" }, fixture.report.id, {
      clientRequestId: randomUUID(), expectedUpdatedAt: fixture.report.updatedAt.toISOString(),
      decision: "RESOLVE", resolutionAction: "CONTENT_TAKEDOWN", reviewNote: "公开内容需修改",
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const ownerPublish = new PrismaTeacherProfileRepository(db).setPublished(fixture.teacherId, true);
      await expect(takedown).resolves.toMatchObject({ status: "RESOLVED" });
      await expect(ownerPublish).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(db.teacherProfile.findUniqueOrThrow({ where: { id: fixture.profile.id } }))
        .resolves.toMatchObject({ status: "DRAFT", moderationReason: "公开内容需修改" });
    } finally {
      await takedown.catch(() => undefined);
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "TeacherProfile"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  });

  it("applies a request hold after a concurrent owner publish commits", async () => {
    const adminId = await account("ADMIN");
    const fixture = await publishableRequestReport();
    const functionName = `test_admin_request_hold_${randomUUID().replaceAll("-", "")}`;
    const triggerName = `${functionName}_trigger`;
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."id" = '${fixture.request.id}'::uuid AND NEW."status" = 'PUBLISHED'
          THEN PERFORM pg_sleep(0.5);
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "TutoringRequest"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
    const ownerPublish = new PrismaRequestRepository(db).publishRequest(fixture.parentId, fixture.request.id);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const takedown = service().decideReport({ id: adminId, role: "admin" }, fixture.report.id, {
        clientRequestId: randomUUID(), expectedUpdatedAt: fixture.report.updatedAt.toISOString(),
        decision: "RESOLVE", resolutionAction: "CONTENT_TAKEDOWN", reviewNote: "公开需求需修改",
      });
      await expect(ownerPublish).resolves.toMatchObject({ status: "PUBLISHED" });
      await expect(takedown).resolves.toMatchObject({ status: "RESOLVED" });
      await expect(db.tutoringRequest.findUniqueOrThrow({ where: { id: fixture.request.id } }))
        .resolves.toMatchObject({ status: "DRAFT", moderationReason: "公开需求需修改" });
    } finally {
      await ownerPublish.catch(() => undefined);
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "TutoringRequest"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  });

  it("allows only one concurrent report decision winner and returns a controlled conflict", async () => {
    const firstAdminId = await account("ADMIN");
    const secondAdminId = await account("ADMIN");
    const { report } = await profileReport();
    const mutate = (adminId: string) => service().decideReport({ id: adminId, role: "admin" }, report.id, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: report.updatedAt.toISOString(),
      decision: "DISMISS" as const,
      resolutionAction: "NONE" as const,
      reviewNote: "没有发现违规",
    });
    const settled = await Promise.allSettled([mutate(firstAdminId), mutate(secondAdminId)]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find(({ status }) => status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AdminModerationError);
    expect(rejected.reason).toMatchObject({ code: "CONFLICT" });
    expect(String(rejected.reason)).not.toMatch(/P2002|P2034/);
  });

  it("replays report decisions exactly and rejects requestId reuse across payloads and targets", async () => {
    const adminId = await account("ADMIN");
    const first = await profileReport();
    const second = await profileReport();
    const clientRequestId = randomUUID();
    const input = {
      clientRequestId,
      expectedUpdatedAt: first.report.updatedAt.toISOString(),
      decision: "START_REVIEW" as const,
    };
    const decided = await service().decideReport({ id: adminId, role: "admin" }, first.report.id, input);
    await expect(service().decideReport({ id: adminId, role: "admin" }, first.report.id, input)).resolves.toEqual(decided);
    await expect(service().decideReport({ id: adminId, role: "admin" }, first.report.id, {
      clientRequestId,
      expectedUpdatedAt: first.report.updatedAt.toISOString(),
      decision: "DISMISS",
      resolutionAction: "NONE",
      reviewNote: "没有发现违规",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service().decideReport({ id: adminId, role: "admin" }, second.report.id, {
      ...input,
      expectedUpdatedAt: second.report.updatedAt.toISOString(),
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.adminAuditLog.count({ where: { requestId: clientRequestId } })).toBe(1);
  });

  it("rejects a second START_REVIEW transition from REVIEWING without writing another audit", async () => {
    const firstAdminId = await account("ADMIN");
    const secondAdminId = await account("ADMIN");
    const { report } = await profileReport();
    await service().decideReport({ id: firstAdminId, role: "admin" }, report.id, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: report.updatedAt.toISOString(),
      decision: "START_REVIEW",
    });
    const reviewing = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(reviewing.status).toBe("REVIEWING");
    const auditCount = await db.adminAuditLog.count({ where: { targetType: "REPORT", targetId: report.id } });

    await expect(service().decideReport({ id: secondAdminId, role: "admin" }, report.id, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: reviewing.updatedAt.toISOString(),
      decision: "START_REVIEW",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.adminAuditLog.count({ where: { targetType: "REPORT", targetId: report.id } })).toBe(auditCount);
    await expect(db.report.findUniqueOrThrow({ where: { id: report.id } }))
      .resolves.toMatchObject({ status: "REVIEWING", reviewerAccountId: firstAdminId });

    const finalAdminId = await account("ADMIN");
    await expect(service().decideReport({ id: finalAdminId, role: "admin" }, report.id, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: reviewing.updatedAt.toISOString(),
      decision: "RESOLVE",
      resolutionAction: "NONE",
      reviewNote: "复核后完成处理",
    })).resolves.toMatchObject({ status: "RESOLVED", resolutionAction: "NONE" });
  });

  it("approves one verification, expires the old approval, and never returns evidence metadata", async () => {
    const adminId = await account("ADMIN");
    const { teacherId, profile } = await teacherFixture();
    await db.verification.create({
      data: { accountId: teacherId, teacherProfileId: profile.id, type: "STUDENT_ID", status: "APPROVED" },
    });
    const pending = await db.verification.create({
      data: {
        accountId: teacherId,
        teacherProfileId: profile.id,
        type: "STUDENT_ID",
        evidence: {
          provider: "local-private", key: `${"a".repeat(64)}.jpg`, mimeType: "image/jpeg",
          byteSize: 123, sha256: "b".repeat(64),
        },
      },
    });
    const result = await service().decideVerification({ id: adminId, role: "admin" }, pending.id, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: pending.updatedAt.toISOString(),
      decision: "APPROVE",
    });
    expect(result).toMatchObject({ status: "APPROVED" });
    expect(JSON.stringify(result)).not.toMatch(/key|sha256|accountId|teacherProfileId/);
    expect(await db.verification.count({ where: { accountId: teacherId, type: "STUDENT_ID", status: "EXPIRED" } })).toBe(1);
  });

  it("rejects verification approval for suspended, missing-profile and mismatched-profile teachers without side effects", async () => {
    const adminId = await account("ADMIN");
    const suspended = await teacherFixture();
    await db.account.update({ where: { id: suspended.teacherId }, data: { status: "SUSPENDED" } });
    const missingTeacherId = await account("TEACHER");
    const mismatchApplicant = await teacherFixture();
    const otherTeacher = await teacherFixture();
    const cases = [
      { accountId: suspended.teacherId, teacherProfileId: suspended.profile.id, type: "STUDENT_ID" },
      { accountId: missingTeacherId, teacherProfileId: null, type: "DEGREE_CERTIFICATE" },
      { accountId: mismatchApplicant.teacherId, teacherProfileId: otherTeacher.profile.id, type: "TEACHER_QUALIFICATION" },
    ] as const;
    for (const fixture of cases) {
      const old = await db.verification.create({ data: {
        accountId: fixture.accountId,
        teacherProfileId: fixture.teacherProfileId,
        type: fixture.type,
        status: "APPROVED",
      } });
      const pending = await db.verification.create({ data: {
        accountId: fixture.accountId,
        teacherProfileId: fixture.teacherProfileId,
        type: fixture.type,
      } });
      await expect(service().decideVerification({ id: adminId, role: "admin" }, pending.id, {
        clientRequestId: randomUUID(), expectedUpdatedAt: pending.updatedAt.toISOString(), decision: "APPROVE",
      })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(db.verification.findUniqueOrThrow({ where: { id: old.id } })).resolves.toMatchObject({
        status: "APPROVED", expiresAt: null,
      });
      await expect(db.verification.findUniqueOrThrow({ where: { id: pending.id } })).resolves.toMatchObject({
        status: "PENDING", reviewerAccountId: null, reviewedAt: null,
      });
      expect(await db.adminAuditLog.count({ where: { targetType: "VERIFICATION", targetId: pending.id } })).toBe(0);
    }
  });

  it("requires a review note for verification rejection and has one concurrent decision winner", async () => {
    const firstAdminId = await account("ADMIN");
    const secondAdminId = await account("ADMIN");
    const { teacherId, profile } = await teacherFixture();
    const pending = await db.verification.create({ data: {
      accountId: teacherId, teacherProfileId: profile.id, type: "DEGREE_CERTIFICATE",
    } });
    const mutate = (adminId: string) => service().decideVerification({ id: adminId, role: "admin" }, pending.id, {
      clientRequestId: randomUUID(), expectedUpdatedAt: pending.updatedAt.toISOString(), decision: "REJECT" as const,
      reviewNote: "材料无法辨认",
    });
    const settled = await Promise.allSettled([mutate(firstAdminId), mutate(secondAdminId)]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find(({ status }) => status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CONFLICT" });
  });

  it("replays a verification decision without duplicating its audit and rejects conflicting reuse", async () => {
    const adminId = await account("ADMIN");
    const { teacherId, profile } = await teacherFixture();
    const pending = await db.verification.create({ data: {
      accountId: teacherId, teacherProfileId: profile.id, type: "TEACHER_QUALIFICATION",
    } });
    const clientRequestId = randomUUID();
    const input = {
      clientRequestId,
      expectedUpdatedAt: pending.updatedAt.toISOString(),
      decision: "REJECT" as const,
      reviewNote: "材料无法辨认",
    };
    const decided = await service().decideVerification({ id: adminId, role: "admin" }, pending.id, input);
    await expect(service().decideVerification({ id: adminId, role: "admin" }, pending.id, input)).resolves.toEqual(decided);
    await expect(service().decideVerification({ id: adminId, role: "admin" }, pending.id, {
      clientRequestId,
      expectedUpdatedAt: pending.updatedAt.toISOString(),
      decision: "APPROVE",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.adminAuditLog.count({ where: { requestId: clientRequestId } })).toBe(1);
  });

  it("reads private evidence only after active-admin authentication and audits only a successful view", async () => {
    const adminId = await account("ADMIN");
    const suspendedAdminId = await account("ADMIN", "SUSPENDED");
    const { teacherId, profile } = await teacherFixture();
    const verification = await db.verification.create({ data: {
      accountId: teacherId, teacherProfileId: profile.id, type: "TEACHER_QUALIFICATION",
      evidence: {
        provider: "local-private", key: `${"c".repeat(64)}.png`, mimeType: "image/png",
        byteSize: 123, sha256: "d".repeat(64),
      },
    } });
    await expect(service().readVerificationEvidence({ id: suspendedAdminId, role: "admin" }, verification.id))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const result = await service().readVerificationEvidence({ id: adminId, role: "admin" }, verification.id);
    expect(result).toEqual({ bytes: Buffer.from("private-image"), mimeType: "image/png" });
    const audit = await db.adminAuditLog.findFirstOrThrow({ where: { adminAccountId: adminId } });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/c{64}|d{64}|key|sha256|path|accountId/);

    const failingAdminId = await account("ADMIN");
    const unavailable = createAdminModerationService(db, {
      ...storage,
      read: async () => { throw new Error("synthetic private storage failure"); },
    });
    await expect(unavailable.readVerificationEvidence({ id: failingAdminId, role: "admin" }, verification.id))
      .rejects.toThrow("synthetic private storage failure");
    expect(await db.adminAuditLog.count({ where: { adminAccountId: failingAdminId } })).toBe(0);
  });

  it("takes down a message after the pair lock and exposes the tombstone through chat change polling", async () => {
    const adminId = await account("ADMIN");
    const fixture = await messageReport();
    const chat = createChatService(db);
    const initial = await chat.listMessages(
      { id: fixture.parentId, role: "parent" },
      fixture.conversation.id,
      {},
    );
    const before = await db.message.findUniqueOrThrow({ where: { id: fixture.message.id } });
    await service("2026-07-14T10:00:00.000Z").decideReport({ id: adminId, role: "admin" }, fixture.report.id, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: fixture.report.updatedAt.toISOString(),
      decision: "RESOLVE",
      resolutionAction: "CONTENT_TAKEDOWN",
      reviewNote: "消息违反平台规则",
    });
    const after = await db.message.findUniqueOrThrow({ where: { id: fixture.message.id } });
    expect(after.deletedAt?.toISOString()).toBe("2026-07-14T10:00:00.000Z");
    expect(after.updatedAt.toISOString()).toBe("2026-07-14T10:00:00.000Z");
    expect(after.changeVersion).toBeGreaterThan(before.changeVersion);
    const changes = await chat.listMessages(
      { id: fixture.parentId, role: "parent" },
      fixture.conversation.id,
      { changesAfter: initial.nextChangesCursor! },
    );
    expect(changes.items).toEqual([expect.objectContaining({
      id: fixture.message.id,
      body: "消息已删除",
      deletedAt: "2026-07-14T10:00:00.000Z",
    })]);
  });

  it("waits on the account-pair advisory lock before acquiring any Report row lock", async () => {
    const adminId = await account("ADMIN");
    const fixture = await messageReport();
    const clientRequestId = randomUUID();
    const blockerPool = new Pool({ connectionString: databaseUrl });
    const blocker = await blockerPool.connect();
    const inspector = new Pool({ connectionString: databaseUrl });
    try {
      await blocker.query("BEGIN");
      const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        accountPairLockKey(fixture.teacherId, fixture.parentId),
      ]);
      const mutation = service().decideReport({ id: adminId, role: "admin" }, fixture.report.id, {
        clientRequestId,
        expectedUpdatedAt: fixture.report.updatedAt.toISOString(),
        decision: "DISMISS",
        resolutionAction: "NONE",
        reviewNote: "无需进一步处理",
      });

      let waiterPid: number | undefined;
      for (let attempt = 0; attempt < 100 && !waiterPid; attempt += 1) {
        const rows = await inspector.query<{ pid: number }>(`
          SELECT pid FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%pg_advisory_xact_lock%'
            AND pid <> pg_backend_pid()
          ORDER BY pid
        `);
        waiterPid = rows.rows.find(({ pid }) => pid !== blockerPid)?.pid;
        if (!waiterPid) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiterPid).toBeTypeOf("number");
      const reportLocks = await inspector.query(`
        SELECT mode, granted FROM pg_locks
        WHERE pid = $1 AND relation = '"Report"'::regclass
      `, [waiterPid]);
      expect(reportLocks.rows).toEqual([]);
      await blocker.query("COMMIT");
      await expect(mutation).resolves.toMatchObject({ status: "DISMISSED" });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.all([blockerPool.end(), inspector.end()]);
    }
  }, 30_000);

  it("keeps audit rows append-only for update, delete and truncate", async () => {
    const adminId = await account("ADMIN");
    await db.adminAuditLog.create({ data: {
      adminAccountId: adminId, requestId: randomUUID(), action: "TEST", targetType: "ACCOUNT",
    } });
    const sql = new Pool({ connectionString: databaseUrl });
    try {
      await expect(sql.query(`UPDATE "AdminAuditLog" SET "action" = 'BROKEN' WHERE "adminAccountId" = $1`, [adminId]))
        .rejects.toMatchObject({ code: "55000" });
      await expect(sql.query(`DELETE FROM "AdminAuditLog" WHERE "adminAccountId" = $1`, [adminId]))
        .rejects.toMatchObject({ code: "55000" });
      await expect(sql.query(`TRUNCATE "AdminAuditLog"`)).rejects.toMatchObject({ code: "55000" });
    } finally {
      await sql.end();
    }
  });
});
