// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGreetingService } from "./service";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

describe("greeting workflow against PostgreSQL", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const accountIds: string[] = [];
  const regionIds: string[] = [];
  const subjectIds: string[] = [];
  let parentId = "";
  let teacherId = "";
  let teacherProfileId = "";
  let requestId = "";

  async function account(role: "PARENT" | "TEACHER", label: string) {
    const row = await prisma.account.create({ data: {
      role, username: `${label}-${marker}`, normalizedUsername: `${label}-${marker}`,
      email: `${label}-${marker}@example.test`, normalizedEmail: `${label}-${marker}@example.test`, passwordHash: "test",
    } });
    accountIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const parent = await account("PARENT", "g-parent"); parentId = parent.id;
    const teacher = await account("TEACHER", "g-teacher"); teacherId = teacher.id;
    const region = await prisma.region.create({ data: { code: `G${marker}`, name: "问候测试区", level: 3 } }); regionIds.push(region.id);
    const subject = await prisma.subject.create({ data: { slug: `g-${marker}`, name: "问候数学" } }); subjectIds.push(subject.id);
    const parentProfile = await prisma.parentProfile.create({ data: { accountId: parentId, displayName: "树家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: parentProfile.id, displayName: "小树", gradeLevel: "GRADE_8" } });
    const teacherProfile = await prisma.teacherProfile.create({ data: {
      accountId: teacherId, displayName: "林老师", identityType: "FULL_TIME_TEACHER", headline: "把数学讲清楚", bio: "耐心教学",
      yearsExperience: 5, hourlyRate: 100, hourlyRateMax: 150, isOnline: true, status: "PUBLISHED", publishedAt: new Date(),
    } });
    teacherProfileId = teacherProfile.id;
    await prisma.teacherSubject.create({ data: { teacherProfileId, subjectId: subject.id } });
    await prisma.teacherServiceArea.create({ data: { teacherProfileId, regionId: region.id, isPrimary: true } });
    const request = await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id, studentProfileId: student.id, regionId: region.id, title: "初二数学巩固", description: "补基础",
      scheduleText: "周末", budgetMin: 8000, budgetMax: 12000, teachingMode: "BOTH", publicLocationNote: "图书馆附近",
      status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
    } });
    requestId = request.id;
    await prisma.requestSubject.create({ data: { tutoringRequestId: requestId, subjectId: subject.id } });
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { OR: [{ teacherId: { in: accountIds } }, { parentId: { in: accountIds } }] } });
    await prisma.report.deleteMany({ where: { OR: [{ reporterAccountId: { in: accountIds } }, { reportedAccountId: { in: accountIds } }] } });
    await prisma.greeting.deleteMany({ where: { OR: [{ senderAccountId: { in: accountIds } }, { recipientAccountId: { in: accountIds } }] } });
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    if (subjectIds.length) await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } });
    if (regionIds.length) await prisma.region.deleteMany({ where: { id: { in: regionIds } } });
    await prisma.$disconnect();
  });

  it("shares one context between both directions and keeps card fields server-generated", async () => {
    const service = createGreetingService(prisma);
    const first = await service.send({ id: parentId, role: "parent" }, { targetId: teacherProfileId, requestId, note: "希望交流教学安排" });
    expect(first).toMatchObject({ status: "PENDING", note: "希望交流教学安排" });
    expect(first.card).toMatchObject({ teacher: { publicNickname: "林老师" }, request: { title: "初二数学巩固" } });
    expect(JSON.stringify(first)).not.toContain("example.test");
    await expect(service.send({ id: teacherId, role: "teacher" }, { targetId: requestId, requestId, note: "可以辅导" }))
      .rejects.toMatchObject({ code: "PENDING_EXISTS" });
    await expect(prisma.greeting.count({ where: { tutoringRequestId: requestId } })).resolves.toBe(1);
  });

  it("only lets the recipient accept and creates exactly one context conversation under concurrency", async () => {
    const service = createGreetingService(prisma);
    const greeting = await prisma.greeting.findFirstOrThrow({ where: { tutoringRequestId: requestId } });
    await expect(service.respond({ id: parentId, role: "parent" }, greeting.id, { action: "accept" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const results = await Promise.all([
      service.respond({ id: teacherId, role: "teacher" }, greeting.id, { action: "accept" }),
      service.respond({ id: teacherId, role: "teacher" }, greeting.id, { action: "accept" }),
    ]);
    expect(results[0]).toMatchObject({ status: "ACCEPTED", conversationEstablished: true });
    expect(results[1]).toMatchObject({ status: "ACCEPTED", conversationEstablished: true });
    await expect(prisma.conversation.count({ where: { teacherId, parentId, tutoringRequestId: requestId } })).resolves.toBe(1);
  });

  it("enforces exact expiry and rejection retry boundaries", async () => {
    const secondParent = await account("PARENT", "g-boundary-parent");
    const original = await prisma.tutoringRequest.findUniqueOrThrow({ where: { id: requestId }, include: { parentProfile: true } });
    const profile = await prisma.parentProfile.create({ data: { accountId: secondParent.id, displayName: "边界家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: profile.id, displayName: "边界学生", gradeLevel: "GRADE_8" } });
    const request = await prisma.tutoringRequest.create({ data: {
      parentProfileId: profile.id, studentProfileId: student.id, regionId: original.regionId, title: "边界需求", description: "测试边界", budgetMin: 8000, budgetMax: 10000,
      teachingMode: "ONLINE", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
    } });
    const requestSubjects = await prisma.requestSubject.findMany({ where: { tutoringRequestId: requestId } });
    await prisma.requestSubject.createMany({ data: requestSubjects.map(({ subjectId }) => ({ tutoringRequestId: request.id, subjectId })) });
    let now = new Date("2026-01-01T00:00:00.000Z");
    const service = createGreetingService(prisma, () => now);
    const sent = await service.send({ id: teacherId, role: "teacher" }, { targetId: request.id, requestId: request.id, note: "" });
    now = new Date("2026-01-08T00:00:00.000Z");
    await expect(service.respond({ id: secondParent.id, role: "parent" }, sent.id, { action: "reject" })).rejects.toMatchObject({ code: "EXPIRED" });
    await expect(prisma.greeting.findUniqueOrThrow({ where: { id: sent.id } })).resolves.toMatchObject({ status: "EXPIRED" });
  });

  it("blocks both directions and report is tied uniquely to a greeting", async () => {
    const extraParent = await account("PARENT", "g-block-parent");
    const base = await prisma.tutoringRequest.findUniqueOrThrow({ where: { id: requestId } });
    const pp = await prisma.parentProfile.create({ data: { accountId: extraParent.id, displayName: "拦截家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: pp.id, displayName: "拦截学生" } });
    const req = await prisma.tutoringRequest.create({ data: { parentProfileId: pp.id, studentProfileId: student.id, regionId: base.regionId, title: "拦截需求", description: "测试", budgetMin: 1, budgetMax: 2, teachingMode: "ONLINE", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now()+86400000) } });
    await prisma.requestSubject.create({ data: { tutoringRequestId: req.id, subjectId: subjectIds[0] } });
    const service = createGreetingService(prisma);
    const sent = await service.send({ id: teacherId, role: "teacher" }, { targetId: req.id, requestId: req.id, note: "" });
    await expect(service.respond({ id: extraParent.id, role: "parent" }, sent.id, { action: "block", reason: "不希望继续联系" })).resolves.toMatchObject({ status: "BLOCKED" });
    await expect(service.send({ id: extraParent.id, role: "parent" }, { targetId: teacherProfileId, requestId: req.id, note: "" })).rejects.toMatchObject({ code: "BLOCKED" });
  });

  it("expires pending rows while listing and never returns private account fields", async () => {
    const service = createGreetingService(prisma);
    const page = await service.listInbox({ id: parentId, role: "parent" }, { box: "sent", page: 1, pageSize: 20 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page).toMatchObject({ page: 1, pageSize: 20 });
    expect(JSON.stringify(page)).not.toMatch(/username|email|password|notes|evidence/i);
  });

  it("allows a rejected context again at exactly 30 days, reusing the same row", async () => {
    const retryParent = await account("PARENT", "g-retry-parent");
    const pp = await prisma.parentProfile.create({ data: { accountId: retryParent.id, displayName: "重试家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: pp.id, displayName: "重试学生", isActive: true } });
    const req = await prisma.tutoringRequest.create({ data: { parentProfileId: pp.id, studentProfileId: student.id, regionId: regionIds[0], title: "冷却需求", description: "测试三十天", budgetMin: 1, budgetMax: 2, teachingMode: "BOTH", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date("2026-07-01T00:00:00Z") } });
    await prisma.requestSubject.create({ data: { tutoringRequestId: req.id, subjectId: subjectIds[0] } });
    let clock = new Date("2026-03-01T08:00:00.000Z");
    const service = createGreetingService(prisma, () => clock);
    const greeting = await service.send({ id: retryParent.id, role: "parent" }, { targetId: teacherProfileId, requestId: req.id, note: "首次" });
    clock = new Date("2026-03-02T08:00:00.000Z");
    await service.respond({ id: teacherId, role: "teacher" }, greeting.id, { action: "reject" });
    clock = new Date("2026-04-01T07:59:59.999Z");
    await expect(service.send({ id: retryParent.id, role: "parent" }, { targetId: teacherProfileId, requestId: req.id, note: "尚未到期" })).rejects.toMatchObject({ code: "COOLDOWN" });
    clock = new Date("2026-04-01T08:00:00.000Z");
    const retried = await service.send({ id: retryParent.id, role: "parent" }, { targetId: teacherProfileId, requestId: req.id, note: "刚好三十天" });
    expect(retried).toMatchObject({ id: greeting.id, status: "PENDING", note: "刚好三十天" });
    await expect(prisma.greeting.count({ where: { tutoringRequestId: req.id } })).resolves.toBe(1);
  });

  it("enforces the UTC daily attempt limit under concurrency", async () => {
    const limitParent = await account("PARENT", "g-limit-parent");
    const pp = await prisma.parentProfile.create({ data: { accountId: limitParent.id, displayName: "限额家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: pp.id, displayName: "限额学生", isActive: true } });
    const requestIds: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      const req = await prisma.tutoringRequest.create({ data: { parentProfileId: pp.id, studentProfileId: student.id, regionId: regionIds[0], title: `限额需求${index}`, description: "并发日限额", budgetMin: 1, budgetMax: 2, teachingMode: "ONLINE", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date("2026-07-01T00:00:00Z") } });
      await prisma.requestSubject.create({ data: { tutoringRequestId: req.id, subjectId: subjectIds[0] } });
      requestIds.push(req.id);
    }
    const service = createGreetingService(prisma, () => new Date("2026-05-01T23:59:59.000Z"));
    const results = await Promise.allSettled(requestIds.map((id) => service.send({ id: teacherId, role: "teacher" }, { targetId: id, requestId: id, note: "" })));
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(10);
    const rejected = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "DAILY_LIMIT" });
    const rangeStart = new Date("2026-05-01T00:00:00.000Z"), rangeEnd = new Date("2026-05-02T00:00:00.000Z");
    await expect(prisma.greetingAttempt.count({ where: { senderAccountId: teacherId, attemptedAt: { gte: rangeStart, lt: rangeEnd } } })).resolves.toBe(10);
  });

  it("creates one idempotent report and rejects unpublished or deactivated relations", async () => {
    const reportParent = await account("PARENT", "g-report-parent");
    const pp = await prisma.parentProfile.create({ data: { accountId: reportParent.id, displayName: "举报家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: pp.id, displayName: "举报学生", isActive: true } });
    const req = await prisma.tutoringRequest.create({ data: { parentProfileId: pp.id, studentProfileId: student.id, regionId: regionIds[0], title: "举报需求", description: "举报测试", budgetMin: 1, budgetMax: 2, teachingMode: "ONLINE", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now()+DAY) } });
    await prisma.requestSubject.create({ data: { tutoringRequestId: req.id, subjectId: subjectIds[0] } });
    const service = createGreetingService(prisma);
    const greeting = await service.send({ id: teacherId, role: "teacher" }, { targetId: req.id, requestId: req.id, note: "" });
    await service.respond({ id: reportParent.id, role: "parent" }, greeting.id, { action: "report", reason: "疑似不当信息" });
    await expect(service.respond({ id: reportParent.id, role: "parent" }, greeting.id, { action: "report", reason: "重复提交" })).resolves.toMatchObject({ status: "REPORTED", reported: true });
    await expect(prisma.report.count({ where: { greetingId: greeting.id } })).resolves.toBe(1);

    const invalidParent = await account("PARENT", "g-invalid-parent");
    const invalidPp = await prisma.parentProfile.create({ data: { accountId: invalidParent.id, displayName: "失效家长" } });
    const invalidStudent = await prisma.studentProfile.create({ data: { parentProfileId: invalidPp.id, displayName: "失效学生", isActive: true } });
    const invalidReq = await prisma.tutoringRequest.create({ data: { parentProfileId: invalidPp.id, studentProfileId: invalidStudent.id, regionId: regionIds[0], title: "失效需求", description: "检查关联", budgetMin: 1, budgetMax: 2, teachingMode: "BOTH", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now()+DAY) } });
    await prisma.requestSubject.create({ data: { tutoringRequestId: invalidReq.id, subjectId: subjectIds[0] } });
    await prisma.subject.update({ where: { id: subjectIds[0] }, data: { isActive: false } });
    await expect(service.send({ id: invalidParent.id, role: "parent" }, { targetId: teacherProfileId, requestId: invalidReq.id, note: "" })).rejects.toMatchObject({ code: "INVALID_TARGET" });
    await prisma.subject.update({ where: { id: subjectIds[0] }, data: { isActive: true } });
    await prisma.tutoringRequest.update({ where: { id: invalidReq.id }, data: { status: "DRAFT", publishedAt: null } });
    await expect(service.send({ id: invalidParent.id, role: "parent" }, { targetId: teacherProfileId, requestId: invalidReq.id, note: "" })).rejects.toMatchObject({ code: "INVALID_TARGET" });
  });
});

const DAY = 24 * 60 * 60 * 1000;
