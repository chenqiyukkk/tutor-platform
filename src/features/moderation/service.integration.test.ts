// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createChatService } from "@/features/chat/service";
import { createGreetingService } from "@/features/greetings/service";
import { accountPairLockKey } from "@/features/interactions/account-pair-lock";
import { CURRENT_PUBLIC_CONTENT_SAFETY_VERSION } from "@/features/safety/public-content-version";

import type { ModerationTarget } from "./schema";
import { createModerationService } from "./service";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

describe("contextual moderation service against PostgreSQL", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const accountIds: string[] = [];
  const regionIds: string[] = [];
  const subjectIds: string[] = [];
  const now = new Date("2026-07-14T00:00:00.000Z");
  const service = createModerationService(prisma, () => now);
  const greetingService = createGreetingService(prisma, () => now);
  const chatService = createChatService(prisma, () => now);

  let parentId = "";
  let teacherId = "";
  let outsiderId = "";
  let teacherProfileId = "";
  let requestId = "";
  let greetingId = "";
  let conversationId = "";
  let teacherMessageId = "";
  let parentMessageId = "";

  async function account(role: "PARENT" | "TEACHER" | "ADMIN", label: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
    const value = `${label}-${marker}`;
    const row = await prisma.account.create({ data: {
      role, status, username: value, normalizedUsername: value,
      email: `${value}@private.example`, normalizedEmail: `${value}@private.example`, passwordHash: "test",
    } });
    accountIds.push(row.id);
    return row;
  }

  function reportInput(target: ModerationTarget, clientRequestId = crypto.randomUUID()) {
    return { target, clientRequestId, reason: "疑似不当内容", details: "请结合上下文复核" };
  }

  async function waitForPairWaiters(observer: Client, holderPid: number, expected: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await observer.query<{ count: number }>(`
        SELECT count(DISTINCT waiter.pid)::int AS count
        FROM pg_locks AS held
        JOIN pg_locks AS waiter
          ON waiter.locktype = held.locktype
         AND waiter.classid = held.classid
         AND waiter.objid = held.objid
         AND waiter.objsubid = held.objsubid
        WHERE held.pid = $1
          AND held.locktype = 'advisory'
          AND held.granted
          AND NOT waiter.granted
      `, [holderPid]);
      if (result.rows[0].count >= expected) return;
      await delay(10);
    }
    throw new Error(`expected ${expected} pair-lock waiters`);
  }

  const cases = () => [
    {
      name: "teacher profile",
      actor: { id: parentId, role: "parent" as const },
      target: { kind: "teacher_profile" as const, profileId: teacherProfileId },
      expected: { targetType: "TEACHER_PROFILE", targetId: teacherProfileId, teacherProfileId, reportedAccountId: teacherId },
      snapshotContains: "治理老师",
    },
    {
      name: "tutoring request",
      actor: { id: teacherId, role: "teacher" as const },
      target: { kind: "tutoring_request" as const, requestId },
      expected: { targetType: "TUTORING_REQUEST", targetId: requestId, tutoringRequestId: requestId, reportedAccountId: parentId },
      snapshotContains: "公开家教需求",
    },
    {
      name: "greeting",
      actor: { id: parentId, role: "parent" as const },
      target: { kind: "greeting" as const, greetingId },
      expected: { targetType: "GREETING", targetId: greetingId, greetingId, tutoringRequestId: requestId, reportedAccountId: teacherId },
      snapshotContains: "希望沟通课程安排",
    },
    {
      name: "conversation",
      actor: { id: parentId, role: "parent" as const },
      target: { kind: "conversation" as const, conversationId },
      expected: { targetType: "CONVERSATION", targetId: conversationId, conversationId, tutoringRequestId: requestId, reportedAccountId: teacherId },
      snapshotContains: "公开家教需求",
    },
    {
      name: "message",
      actor: { id: parentId, role: "parent" as const },
      target: { kind: "message" as const, messageId: teacherMessageId },
      expected: { targetType: "MESSAGE", targetId: teacherMessageId, messageId: teacherMessageId, conversationId, tutoringRequestId: requestId, reportedAccountId: teacherId },
      snapshotContains: "对方发送的可见消息",
    },
  ];

  beforeAll(async () => {
    const parent = await account("PARENT", "moderation-parent"); parentId = parent.id;
    const teacher = await account("TEACHER", "moderation-teacher"); teacherId = teacher.id;
    const outsider = await account("PARENT", "moderation-outsider"); outsiderId = outsider.id;
    const region = await prisma.region.create({ data: { code: `M${marker}`, name: "治理测试区", level: 3 } });
    regionIds.push(region.id);
    const subject = await prisma.subject.create({ data: { slug: `m-${marker}`, name: "治理数学" } });
    subjectIds.push(subject.id);
    const parentProfile = await prisma.parentProfile.create({ data: { accountId: parent.id, displayName: "治理家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: parentProfile.id, displayName: "小治理", gradeLevel: "GRADE_8" } });
    const profile = await prisma.teacherProfile.create({ data: {
      accountId: teacher.id, displayName: "治理老师", identityType: "FULL_TIME_TEACHER", headline: "公开安全标题",
      bio: "公开安全简介", yearsExperience: 6, hourlyRate: 100, hourlyRateMax: 150, isOnline: true,
      status: "PUBLISHED", publishedAt: now, publicContentSafetyVersion: CURRENT_PUBLIC_CONTENT_SAFETY_VERSION,
    } });
    teacherProfileId = profile.id;
    await prisma.teacherSubject.create({ data: { teacherProfileId, subjectId: subject.id } });
    await prisma.teacherServiceArea.create({ data: { teacherProfileId, regionId: region.id, isPrimary: true } });
    const request = await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id, studentProfileId: student.id, regionId: region.id,
      title: "公开家教需求", description: "公开需求说明", scheduleText: "周末", budgetMin: 8000, budgetMax: 12000,
      teachingMode: "BOTH", publicLocationNote: "公共场所", status: "PUBLISHED", publishedAt: now,
      publicContentSafetyVersion: CURRENT_PUBLIC_CONTENT_SAFETY_VERSION, expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    } });
    requestId = request.id;
    await prisma.requestSubject.create({ data: { tutoringRequestId: request.id, subjectId: subject.id } });
    const greeting = await prisma.greeting.create({ data: {
      senderAccountId: teacher.id, recipientAccountId: parent.id, tutoringRequestId: request.id,
      contextKey: `${teacher.id}:${parent.id}:${request.id}`, message: "希望沟通课程安排",
      cardSnapshot: { teacher: { publicNickname: "治理老师" }, request: { title: "公开家教需求" } },
      status: "ACCEPTED", expiresAt: new Date("2027-01-01T00:00:00.000Z"), respondedAt: now,
    } });
    greetingId = greeting.id;
    const conversation = await prisma.conversation.create({ data: {
      greetingId: greeting.id, teacherId: teacher.id, parentId: parent.id, tutoringRequestId: request.id,
    } });
    conversationId = conversation.id;
    const teacherMessage = await prisma.message.create({ data: {
      conversationId, senderAccountId: teacher.id, clientMessageId: `teacher-${marker}`,
      body: "对方发送的可见消息", sentAt: now, updatedAt: now,
    } });
    teacherMessageId = teacherMessage.id;
    const parentMessage = await prisma.message.create({ data: {
      conversationId, senderAccountId: parent.id, clientMessageId: `parent-${marker}`,
      body: "自己发送的消息", sentAt: now, updatedAt: now,
    } });
    parentMessageId = parentMessage.id;
  });

  beforeEach(async () => {
    await prisma.report.deleteMany({ where: { reporterAccountId: { in: accountIds } } });
    await prisma.block.deleteMany({ where: { blockerAccountId: { in: accountIds } } });
    await prisma.account.updateMany({ where: { id: { in: [parentId, teacherId, outsiderId] } }, data: { status: "ACTIVE" } });
  });

  afterAll(async () => {
    await prisma.report.deleteMany({ where: { OR: [{ reporterAccountId: { in: accountIds } }, { reportedAccountId: { in: accountIds } }] } });
    await prisma.block.deleteMany({ where: { OR: [{ blockerAccountId: { in: accountIds } }, { blockedAccountId: { in: accountIds } }] } });
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.greeting.deleteMany({ where: { id: greetingId } });
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    if (subjectIds.length) await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } });
    if (regionIds.length) await prisma.region.deleteMany({ where: { id: { in: regionIds } } });
    await prisma.$disconnect();
  });

  it.each([0, 1, 2, 3, 4])("derives canonical relations and safe snapshots for target case %s", async (index) => {
    const scenario = cases()[index];
    const result = await service.createReport(scenario.actor, reportInput(scenario.target));
    expect(result).toEqual({ reportId: expect.any(String), status: "PENDING" });
    const report = await prisma.report.findUniqueOrThrow({ where: { id: result.reportId } });
    expect(report).toMatchObject(scenario.expected);
    expect(report.targetSnapshot).toMatchObject({ kind: scenario.target.kind });
    const snapshot = JSON.stringify(report.targetSnapshot);
    expect(snapshot).toContain(scenario.snapshotContains);
    expect(snapshot).not.toContain(parentId);
    expect(snapshot).not.toContain(teacherId);
    expect(snapshot).not.toContain("@private.example");
    expect(snapshot).not.toMatch(/accountId|email|password|private|path/i);
    await expect(prisma.block.count({ where: { blockerAccountId: scenario.actor.id } })).resolves.toBe(0);
  });

  it("returns generic NOT_FOUND for IDOR and hidden role-specific targets", async () => {
    await expect(service.createReport(
      { id: outsiderId, role: "parent" }, reportInput({ kind: "conversation", conversationId }),
    )).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.createReport(
      { id: teacherId, role: "teacher" }, reportInput({ kind: "teacher_profile", profileId: teacherProfileId }),
    )).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.createReport(
      { id: parentId, role: "parent" }, reportInput({ kind: "tutoring_request", requestId }),
    )).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects inactive, realm-mismatched, admin, and self-message actors without leaking targets", async () => {
    await prisma.account.update({ where: { id: parentId }, data: { status: "SUSPENDED" } });
    await expect(service.createReport(
      { id: parentId, role: "parent" }, reportInput({ kind: "message", messageId: teacherMessageId }),
    )).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await prisma.account.update({ where: { id: parentId }, data: { status: "ACTIVE" } });
    await expect(service.createReport(
      { id: teacherId, role: "parent" }, reportInput({ kind: "message", messageId: teacherMessageId }),
    )).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(service.createReport(
      { id: parentId, role: "admin" }, reportInput({ kind: "message", messageId: teacherMessageId }),
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.createReport(
      { id: parentId, role: "parent" }, reportInput({ kind: "message", messageId: parentMessageId }),
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("applies the same IDOR, actor, role, and self protections to blocks", async () => {
    await expect(service.createBlock(
      { id: outsiderId, role: "parent" },
      { target: { kind: "conversation", conversationId }, reason: "不希望继续互动" },
    )).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.createBlock(
      { id: teacherId, role: "teacher" },
      { target: { kind: "teacher_profile", profileId: teacherProfileId }, reason: "不希望继续互动" },
    )).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.createBlock(
      { id: parentId, role: "parent" },
      { target: { kind: "tutoring_request", requestId }, reason: "不希望继续互动" },
    )).rejects.toMatchObject({ code: "NOT_FOUND" });

    await prisma.account.update({ where: { id: parentId }, data: { status: "SUSPENDED" } });
    await expect(service.createBlock(
      { id: parentId, role: "parent" },
      { target: { kind: "message", messageId: teacherMessageId }, reason: "不希望继续互动" },
    )).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await prisma.account.update({ where: { id: parentId }, data: { status: "ACTIVE" } });

    await expect(service.createBlock(
      { id: teacherId, role: "parent" },
      { target: { kind: "message", messageId: teacherMessageId }, reason: "不希望继续互动" },
    )).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(service.createBlock(
      { id: parentId, role: "admin" },
      { target: { kind: "message", messageId: teacherMessageId }, reason: "不希望继续互动" },
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.createBlock(
      { id: parentId, role: "parent" },
      { target: { kind: "message", messageId: parentMessageId }, reason: "不希望继续互动" },
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows reports on visible history after the counterpart is suspended but still rejects blocking", async () => {
    await prisma.account.update({ where: { id: teacherId }, data: { status: "SUSPENDED" } });
    for (const target of [
      { kind: "greeting" as const, greetingId },
      { kind: "conversation" as const, conversationId },
      { kind: "message" as const, messageId: teacherMessageId },
    ]) {
      await expect(service.createReport(
        { id: parentId, role: "parent" }, reportInput(target),
      )).resolves.toMatchObject({ reportId: expect.any(String), status: "PENDING" });
    }
    await expect(service.createBlock(
      { id: parentId, role: "parent" },
      { target: { kind: "conversation", conversationId }, reason: "不希望继续互动" },
    )).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("atomically reports a pending greeting through the existing pair and context lock order", async () => {
    await prisma.greeting.update({
      where: { id: greetingId }, data: { status: "PENDING", respondedAt: null },
    });
    try {
      await expect(service.createReport(
        { id: parentId, role: "parent" },
        reportInput({ kind: "greeting", greetingId }),
      )).resolves.toMatchObject({ reportId: expect.any(String), status: "PENDING" });
      await expect(prisma.report.count({ where: { reporterAccountId: parentId, greetingId } })).resolves.toBe(1);
      await expect(prisma.greeting.findUniqueOrThrow({ where: { id: greetingId } }))
        .resolves.toMatchObject({ status: "REPORTED", respondedAt: now });
      await expect(greetingService.respond(
        { id: parentId, role: "parent" }, greetingId, { action: "accept" },
      )).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await prisma.greeting.update({
        where: { id: greetingId }, data: { status: "ACCEPTED", respondedAt: now },
      });
    }
  });

  it("serializes a pending greeting report ahead of accept without a partial report or deadlock", async () => {
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    const observer = new Client({ connectionString: process.env.DATABASE_URL });
    let reportOutcome: Promise<PromiseSettledResult<unknown>> | undefined;
    let acceptOutcome: Promise<PromiseSettledResult<unknown>> | undefined;
    await prisma.greeting.update({ where: { id: greetingId }, data: { status: "PENDING", respondedAt: null } });
    try {
      await Promise.all([holder.connect(), observer.connect()]);
      await holder.query("BEGIN");
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        accountPairLockKey(teacherId, parentId),
      ]);
      const holderPid = Number((await holder.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      const beforeDeadlocks = Number((await observer.query(
        `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`,
      )).rows[0].deadlocks);

      const report = service.createReport(
        { id: parentId, role: "parent" }, reportInput({ kind: "greeting", greetingId }),
      );
      reportOutcome = report.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
      await waitForPairWaiters(observer, holderPid, 1);

      const accept = greetingService.respond(
        { id: parentId, role: "parent" }, greetingId, { action: "accept" },
      );
      acceptOutcome = accept.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
      await waitForPairWaiters(observer, holderPid, 2);
      await holder.query("COMMIT");

      const [reportResult, acceptResult] = await Promise.all([reportOutcome, acceptOutcome]);
      expect(reportResult).toMatchObject({ status: "fulfilled", value: { reportId: expect.any(String) } });
      expect(acceptResult).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
      await expect(prisma.report.count({ where: { reporterAccountId: parentId, greetingId } })).resolves.toBe(1);
      await expect(prisma.greeting.findUniqueOrThrow({ where: { id: greetingId } }))
        .resolves.toMatchObject({ status: "REPORTED" });
      const afterDeadlocks = Number((await observer.query(
        `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`,
      )).rows[0].deadlocks);
      expect(afterDeadlocks).toBe(beforeDeadlocks);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await Promise.all([reportOutcome, acceptOutcome].filter(Boolean));
      await Promise.all([holder.end().catch(() => undefined), observer.end().catch(() => undefined)]);
      await prisma.greeting.update({ where: { id: greetingId }, data: { status: "ACCEPTED", respondedAt: now } });
    }
  }, 30_000);

  it("replays one persisted client request and rejects a different key for an open target", async () => {
    const target = { kind: "message" as const, messageId: teacherMessageId };
    const clientRequestId = crypto.randomUUID();
    const first = await service.createReport({ id: parentId, role: "parent" }, reportInput(target, clientRequestId));
    const replay = await service.createReport({ id: parentId, role: "parent" }, reportInput(target, clientRequestId));
    expect(replay).toEqual(first);
    await expect(service.createReport({ id: parentId, role: "parent" }, {
      ...reportInput(target, clientRequestId), reason: "不同举报原因",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    const rejectedKey = crypto.randomUUID();
    await expect(service.createReport(
      { id: parentId, role: "parent" }, reportInput(target, rejectedKey),
    )).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(prisma.report.count({ where: { reporterAccountId: parentId, targetType: "MESSAGE", targetId: teacherMessageId } }))
      .resolves.toBe(1);
    await expect(service.createReport(
      { id: parentId, role: "parent" },
      reportInput({ kind: "teacher_profile", profileId: teacherProfileId }, rejectedKey),
    )).resolves.toMatchObject({ reportId: expect.any(String), status: "PENDING" });
  });

  it("allows one concurrent open report and maps every losing race to CONFLICT", async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.createReport(
      { id: parentId, role: "parent" }, reportInput({ kind: "message", messageId: teacherMessageId }),
    )));
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(rejected.every((result) => result.reason?.code === "CONFLICT")).toBe(true);
    expect(JSON.stringify(rejected)).not.toMatch(/P2002|P2034/);
    await expect(prisma.report.count({ where: { reporterAccountId: parentId, targetType: "MESSAGE", targetId: teacherMessageId } }))
      .resolves.toBe(1);
  });

  it.each([0, 1, 2, 3, 4])("derives and idempotently blocks the counterpart for target case %s", async (index) => {
    const scenario = cases()[index];
    await expect(service.createBlock(scenario.actor, { target: scenario.target, reason: "不希望继续互动" }))
      .resolves.toEqual({ blocked: true });
    await expect(service.createBlock(scenario.actor, { target: scenario.target, reason: "重复请求不改原因" }))
      .resolves.toEqual({ blocked: true });
    const rows = await prisma.block.findMany({ where: { blockerAccountId: scenario.actor.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blockedAccountId: scenario.expected.reportedAccountId, reason: "不希望继续互动" });
    await expect(prisma.report.count({ where: { reporterAccountId: scenario.actor.id } })).resolves.toBe(0);
  });

  it("serializes a concurrent block with greeting and chat sends, then blocks both channels without deadlock", async () => {
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    const observer = new Client({ connectionString: process.env.DATABASE_URL });
    const outcomes: Array<Promise<PromiseSettledResult<unknown>>> = [];
    try {
      await Promise.all([holder.connect(), observer.connect()]);
      await holder.query("BEGIN");
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        accountPairLockKey(teacherId, parentId),
      ]);
      const holderPid = Number((await holder.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      const beforeDeadlocks = Number((await observer.query(
        `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`,
      )).rows[0].deadlocks);

      const block = service.createBlock(
        { id: parentId, role: "parent" },
        { target: { kind: "conversation", conversationId }, reason: "停止后续联系" },
      );
      outcomes.push(block.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      ));
      await waitForPairWaiters(observer, holderPid, 1);

      const concurrentMessage = chatService.sendMessage(
        { id: teacherId, role: "teacher" }, conversationId,
        { clientMessageId: crypto.randomUUID(), body: "并发发送尝试" },
      );
      const concurrentGreeting = greetingService.send(
        { id: teacherId, role: "teacher" }, { targetId: requestId, requestId, note: "并发问候尝试" },
      );
      outcomes.push(...[concurrentMessage, concurrentGreeting].map((operation) => operation.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      )));
      await waitForPairWaiters(observer, holderPid, 3);
      await holder.query("COMMIT");

      const settled = await Promise.all(outcomes);
      expect(settled[0]).toMatchObject({ status: "fulfilled", value: { blocked: true } });
      expect(settled[1]).toMatchObject({ status: "rejected", reason: { code: "BLOCKED" } });
      expect(settled[2]).toMatchObject({ status: "rejected", reason: { code: "BLOCKED" } });
      const afterDeadlocks = Number((await observer.query(
        `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`,
      )).rows[0].deadlocks);
      expect(afterDeadlocks).toBe(beforeDeadlocks);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await Promise.all(outcomes);
      await Promise.all([holder.end().catch(() => undefined), observer.end().catch(() => undefined)]);
    }
  }, 30_000);
});
