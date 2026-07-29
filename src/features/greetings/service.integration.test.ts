// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGreetingService } from "./service";
import { PrismaTeacherProfileRepository } from "@/features/teachers/repository";
import { createTeacherProfileService } from "@/features/teachers/service";

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

  async function isolatedScenario(label: string) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const parent = await account("PARENT", `${label}-parent-${suffix}`);
    const teacher = await account("TEACHER", `${label}-teacher-${suffix}`);
    const region = await prisma.region.create({ data: { code: `G${crypto.randomUUID().replaceAll("-", "").slice(0, 11)}`, name: `${label}区`, level: 3 } });
    regionIds.push(region.id);
    const subject = await prisma.subject.create({ data: { slug: `g-${crypto.randomUUID()}`, name: `${label}科目` } });
    subjectIds.push(subject.id);
    const parentProfile = await prisma.parentProfile.create({ data: { accountId: parent.id, displayName: `${label}家长`, status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: parentProfile.id, displayName: `${label}学生`, gradeLevel: "GRADE_8" } });
    const teacherProfile = await prisma.teacherProfile.create({ data: {
      accountId: teacher.id, displayName: `${label}老师`, identityType: "FULL_TIME_TEACHER", headline: "并发边界",
      bio: "安全流程测试", yearsExperience: 3, hourlyRate: 80, hourlyRateMax: 120, isOnline: true,
      status: "PUBLISHED", publishedAt: new Date("2026-07-01T00:00:00.000Z"),
    } });
    await prisma.teacherSubject.create({ data: { teacherProfileId: teacherProfile.id, subjectId: subject.id } });
    await prisma.teacherServiceArea.create({ data: { teacherProfileId: teacherProfile.id, regionId: region.id, isPrimary: true } });
    const request = await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id, studentProfileId: student.id, regionId: region.id, title: `${label}需求`,
      description: "安全流程测试", budgetMin: 1, budgetMax: 2, teachingMode: "BOTH", status: "PUBLISHED",
      publishedAt: new Date("2026-07-01T00:00:00.000Z"), expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    } });
    await prisma.requestSubject.create({ data: { tutoringRequestId: request.id, subjectId: subject.id } });
    const service = createGreetingService(prisma, () => new Date("2026-07-13T12:00:00.000Z"));
    const greeting = await service.send({ id: teacher.id, role: "teacher" }, { targetId: request.id, requestId: request.id, note: "" });
    return { service, greeting, parent, teacher, parentProfile, student, teacherProfile, request, subject, region };
  }

  async function invalidateScenario(
    scenario: Awaited<ReturnType<typeof isolatedScenario>>,
    invalidation: Invalidation,
  ) {
    if (invalidation === "profile-missing") await prisma.teacherProfile.delete({ where: { id: scenario.teacherProfile.id } });
    if (invalidation === "profile-unpublished") await prisma.teacherProfile.update({ where: { id: scenario.teacherProfile.id }, data: { status: "DRAFT", publishedAt: null } });
    if (invalidation === "profile-headline-missing") await prisma.teacherProfile.update({ where: { id: scenario.teacherProfile.id }, data: { headline: null } });
    if (invalidation === "profile-headline-unsafe") await prisma.teacherProfile.update({ where: { id: scenario.teacherProfile.id }, data: { headline: "Signal: tutor88" } });
    if (invalidation === "request-unpublished") await prisma.tutoringRequest.update({ where: { id: scenario.request.id }, data: { status: "DRAFT", publishedAt: null } });
    if (invalidation === "request-mode-missing") await prisma.tutoringRequest.update({ where: { id: scenario.request.id }, data: { teachingMode: null } });
    if (invalidation === "student-inactive") await prisma.studentProfile.update({ where: { id: scenario.student.id }, data: { isActive: false } });
    if (invalidation === "student-alias-unsafe") await prisma.studentProfile.update({ where: { id: scenario.student.id }, data: { displayName: "抖音号 tutor88" } });
    if (invalidation === "subject-inactive") await prisma.subject.update({ where: { id: scenario.subject.id }, data: { isActive: false } });
    if (invalidation === "region-inactive") await prisma.region.update({ where: { id: scenario.region.id }, data: { isActive: false } });
    if (invalidation === "sender-account-disabled") await prisma.account.update({ where: { id: scenario.teacher.id }, data: { status: "DISABLED" } });
  }

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
    await prisma.verification.create({ data: {
      accountId: teacherId, teacherProfileId, type: "IDENTITY", status: "APPROVED",
      evidence: { documentPath: "private/identity-card.png" }, reviewNote: "private-review-note",
      reviewedAt: new Date(), expiresAt: new Date(Date.now() + 30 * DAY),
    } });
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
    expect(first.card).toMatchObject({
      teacher: {
        publicNickname: "林老师", identityType: "FULL_TIME_TEACHER", headline: "把数学讲清楚",
        yearsExperience: 5, rateMinCents: 10000, rateMaxCents: 15000, online: true, verified: true,
        subjects: [{ name: "问候数学" }], serviceAreas: [{ name: "问候测试区", isPrimary: true }],
      },
      request: {
        title: "初二数学巩固", studentAlias: "小树", gradeLevel: "GRADE_8",
        budgetMinCents: 8000, budgetMaxCents: 12000, teachingMode: "BOTH", scheduleText: "周末",
        region: { name: "问候测试区" }, subjects: [{ name: "问候数学" }],
      },
    });
    expect(JSON.stringify(first)).not.toContain("example.test");
    expect(JSON.stringify(first)).not.toMatch(/evidence|reviewNote|documentPath|private-review-note/i);
    await expect(service.send({ id: teacherId, role: "teacher" }, { targetId: requestId, requestId, note: "可以辅导" }))
      .rejects.toMatchObject({ code: "PENDING_EXISTS" });
    await expect(prisma.greeting.count({ where: { tutoringRequestId: requestId } })).resolves.toBe(1);
  });

  it("carries the headline saved and published by the formal teacher workflow into the greeting card", async () => {
    const parent = await account("PARENT", `headline-parent-${crypto.randomUUID().slice(0, 8)}`);
    const teacher = await account("TEACHER", `headline-teacher-${crypto.randomUUID().slice(0, 8)}`);
    const parentProfile = await prisma.parentProfile.create({ data: { accountId: parent.id, displayName: "标题流程家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: parentProfile.id, displayName: "标题流程学生", gradeLevel: "GRADE_8" } });
    const teacherService = createTeacherProfileService(new PrismaTeacherProfileRepository(prisma));
    const saved = await teacherService.saveDraft({ id: teacher.id, role: "teacher" }, {
      publicNickname: "周老师",
      headline: "把复杂几何拆成清晰步骤",
      identityType: "FULL_TIME_TEACHER",
      bio: "专注初中几何教学，帮助学生建立稳定的解题方法。",
      yearsExperience: 6,
      online: true,
      rateMinCents: 10_000,
      rateMaxCents: 15_000,
      subjectIds: [subjectIds[0]],
      primaryRegionId: regionIds[0],
      extraRegionIds: [],
    });
    expect(saved.headline).toBe("把复杂几何拆成清晰步骤");
    await teacherService.publish({ id: teacher.id, role: "teacher" });
    const request = await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id,
      studentProfileId: student.id,
      regionId: regionIds[0],
      title: "初二几何巩固",
      description: "希望建立几何思路",
      scheduleText: "周末下午",
      budgetMin: 8_000,
      budgetMax: 12_000,
      teachingMode: "BOTH",
      publicLocationNote: "图书馆附近",
      status: "PUBLISHED",
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + DAY),
    } });
    await prisma.requestSubject.create({ data: { tutoringRequestId: request.id, subjectId: subjectIds[0] } });

    const greeting = await createGreetingService(prisma).send(
      { id: parent.id, role: "parent" },
      { targetId: saved.id, requestId: request.id, note: "" },
    );
    expect(greeting.card).toMatchObject({ teacher: { headline: "把复杂几何拆成清晰步骤" } });
  });

  it("whitelists persisted card snapshots on inbox and response DTO boundaries", async () => {
    const scenario = await isolatedScenario("快照脱敏");
    const current = scenario.greeting.card as {
      teacher: Record<string, unknown>;
      request: Record<string, unknown>;
    };
    const poisonedCurrent = {
      ...current,
      evidence: "TOP-SECRET-EVIDENCE",
      reviewNote: "TOP-SECRET-REVIEW",
      teacher: { ...current.teacher, email: "teacher-secret@example.test" },
      request: { ...current.request, studentNotes: "PRIVATE-STUDENT-NOTES" },
    };
    await prisma.greeting.update({
      where: { id: scenario.greeting.id },
      data: { cardSnapshot: poisonedCurrent as Prisma.InputJsonValue },
    });

    const page = await scenario.service.listInbox(
      { id: scenario.parent.id, role: "parent" },
      { box: "received", pageSize: 20 },
    );
    const inboxItem = page.items.find(({ id }) => id === scenario.greeting.id);
    expect(inboxItem?.card).toEqual({ legacy: true });
    expect(JSON.stringify(page)).not.toMatch(/TOP-SECRET|teacher-secret|PRIVATE-STUDENT-NOTES/i);

    const response = await scenario.service.respond(
      { id: scenario.parent.id, role: "parent" },
      scenario.greeting.id,
      { action: "reject" },
    );
    expect(response.card).toEqual({ legacy: true });
    expect(JSON.stringify(response)).not.toMatch(/TOP-SECRET|teacher-secret|PRIVATE-STUDENT-NOTES/i);

    await prisma.greeting.update({ where: { id: scenario.greeting.id }, data: { cardSnapshot: { legacy: true } } });
    const legacyPage = await scenario.service.listInbox(
      { id: scenario.parent.id, role: "parent" },
      { box: "received", pageSize: 20 },
    );
    expect(legacyPage.items.find(({ id }) => id === scenario.greeting.id)?.card).toEqual({ legacy: true });

    await prisma.greeting.update({
      where: { id: scenario.greeting.id },
      data: { cardSnapshot: { legacy: true, email: "legacy-secret@example.test" } },
    });
    const unsafeLegacyPage = await scenario.service.listInbox(
      { id: scenario.parent.id, role: "parent" },
      { box: "received", pageSize: 20 },
    );
    expect(unsafeLegacyPage.items.find(({ id }) => id === scenario.greeting.id)?.card).toEqual({ legacy: true });
    expect(JSON.stringify(unsafeLegacyPage)).not.toContain("legacy-secret@example.test");

    await prisma.greeting.update({
      where: { id: scenario.greeting.id },
      data: { cardSnapshot: { unknown: "UNKNOWN-SECRET" } },
    });
    const unknownPage = await scenario.service.listInbox(
      { id: scenario.parent.id, role: "parent" },
      { box: "received", pageSize: 20 },
    );
    expect(unknownPage.items.find(({ id }) => id === scenario.greeting.id)?.card).toEqual({ legacy: true });
    expect(JSON.stringify(unknownPage)).not.toContain("UNKNOWN-SECRET");
  });

  it("marks verification true only for approved records that have not expired", async () => {
    const scenario = await isolatedScenario("认证边界");
    expect(scenario.greeting.card).toMatchObject({ teacher: { verified: false } });
    await prisma.greeting.delete({ where: { id: scenario.greeting.id } });
    const verification = await prisma.verification.create({ data: {
      accountId: scenario.teacher.id, teacherProfileId: scenario.teacherProfile.id, type: "IDENTITY", status: "APPROVED",
      evidence: { path: "private-proof" }, reviewNote: "private-note", reviewedAt: new Date("2026-07-01T00:00:00.000Z"),
      expiresAt: new Date("2026-07-13T12:00:00.000Z"),
    } });
    const expired = await scenario.service.send({ id: scenario.teacher.id, role: "teacher" }, { targetId: scenario.request.id, requestId: scenario.request.id, note: "" });
    expect(expired.card).toMatchObject({ teacher: { verified: false } });
    expect(JSON.stringify(expired.card)).not.toMatch(/evidence|reviewNote|private-proof|private-note/i);

    await prisma.greeting.delete({ where: { id: expired.id } });
    await prisma.verification.update({ where: { id: verification.id }, data: { expiresAt: new Date("2026-07-13T12:00:00.001Z") } });
    const active = await scenario.service.send({ id: scenario.teacher.id, role: "teacher" }, { targetId: scenario.request.id, requestId: scenario.request.id, note: "" });
    expect(active.card).toMatchObject({ teacher: { verified: true } });
  });

  it("serializes simultaneous opposite-direction sends into exactly one context", async () => {
    const scenario = await isolatedScenario("双向并发");
    await prisma.greeting.delete({ where: { id: scenario.greeting.id } });
    await prisma.greetingAttempt.deleteMany({ where: { senderAccountId: { in: [scenario.parent.id, scenario.teacher.id] } } });

    const results = await Promise.allSettled([
      scenario.service.send({ id: scenario.teacher.id, role: "teacher" }, { targetId: scenario.request.id, requestId: scenario.request.id, note: "老师发起" }),
      scenario.service.send({ id: scenario.parent.id, role: "parent" }, { targetId: scenario.teacherProfile.id, requestId: scenario.request.id, note: "家长发起" }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "PENDING_EXISTS" });
    await expect(prisma.greeting.count({ where: { tutoringRequestId: scenario.request.id } })).resolves.toBe(1);
  });

  it.each(["profile", "request", "subject", "region", "sender-account"] as const)(
    "does not save a greeting when %s is concurrently deactivated under lock_timeout",
    async (kind) => {
      const scenario = await isolatedScenario(`并发停用-${kind}`);
      await prisma.greeting.delete({ where: { id: scenario.greeting.id } });
      await prisma.greetingAttempt.deleteMany({ where: { senderAccountId: scenario.teacher.id } });
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set("options", "-c lock_timeout=2000ms -c statement_timeout=5000ms");
      const limited = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
      const service = createGreetingService(limited, () => new Date("2026-07-13T12:00:00.000Z"));
      let unlock!: () => void;
      let markLocked!: () => void;
      const release = new Promise<void>((resolve) => { unlock = resolve; });
      const locked = new Promise<void>((resolve) => { markLocked = resolve; });
      const deactivation = prisma.$transaction(async (transaction) => {
        if (kind === "profile") await transaction.teacherProfile.update({ where: { id: scenario.teacherProfile.id }, data: { status: "DRAFT", publishedAt: null } });
        if (kind === "request") await transaction.tutoringRequest.update({ where: { id: scenario.request.id }, data: { status: "DRAFT", publishedAt: null } });
        if (kind === "subject") await transaction.subject.update({ where: { id: scenario.subject.id }, data: { isActive: false } });
        if (kind === "region") await transaction.region.update({ where: { id: scenario.region.id }, data: { isActive: false } });
        if (kind === "sender-account") await transaction.account.update({ where: { id: scenario.teacher.id }, data: { status: "DISABLED" } });
        markLocked();
        await release;
      });
      try {
        await locked;
        const sending = service.send({ id: scenario.teacher.id, role: "teacher" }, { targetId: scenario.request.id, requestId: scenario.request.id, note: "" });
        unlock();
        await deactivation;
        await expect(sending).rejects.toMatchObject({ code: kind === "sender-account" ? "UNAUTHORIZED" : "INVALID_TARGET" });
        await expect(prisma.greeting.count({ where: { tutoringRequestId: scenario.request.id } })).resolves.toBe(0);
      } finally {
        unlock();
        await deactivation.catch(() => undefined);
        await limited.$disconnect();
      }
    },
  );

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

  it("serializes block before a send for another request owned by the same account pair", async () => {
    const scenario = await isolatedScenario("跨需求锁");
    const secondRequest = await prisma.tutoringRequest.create({ data: {
      parentProfileId: scenario.parentProfile.id,
      studentProfileId: scenario.student.id,
      regionId: scenario.region.id,
      title: "跨需求锁第二条需求",
      description: "验证屏蔽与发送串行",
      budgetMin: 8_000,
      budgetMax: 12_000,
      teachingMode: "BOTH",
      status: "PUBLISHED",
      publishedAt: new Date("2026-07-01T00:00:00.000Z"),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    } });
    await prisma.requestSubject.create({ data: { tutoringRequestId: secondRequest.id, subjectId: scenario.subject.id } });

    const functionName = `test_block_sleep_${marker}`;
    const triggerName = `test_block_sleep_trigger_${marker}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(1);
        RETURN NEW;
      END $$;
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "Block"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
    try {
      const blocking = scenario.service.respond(
        { id: scenario.parent.id, role: "parent" },
        scenario.greeting.id,
        { action: "block", reason: "跨需求并发测试" },
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      const sending = scenario.service.send(
        { id: scenario.teacher.id, role: "teacher" },
        { targetId: secondRequest.id, requestId: secondRequest.id, note: "" },
      );

      await expect(blocking).resolves.toMatchObject({ status: "BLOCKED" });
      await expect(sending).rejects.toMatchObject({ code: "BLOCKED" });
      await expect(prisma.greeting.count({ where: { tutoringRequestId: secondRequest.id } })).resolves.toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "Block"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  });

  it("expires pending rows while listing and never returns private account fields", async () => {
    const service = createGreetingService(prisma);
    const page = await service.listInbox({ id: parentId, role: "parent" }, { box: "sent", pageSize: 20 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page).toMatchObject({ pageSize: 20 });
    expect(JSON.stringify(page)).not.toMatch(/username|email|password|notes|evidence/i);
  });

  it("隐藏旧数据中不符合联系方式策略的补充说明", async () => {
    const greeting = await prisma.greeting.create({ data: {
      senderAccountId: parentId,
      recipientAccountId: teacherId,
      tutoringRequestId: requestId,
      contextKey: `legacy-policy:${crypto.randomUUID()}`,
      message: "WhatsApp: tutor_88",
      cardSnapshot: { legacy: true },
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    } });

    const page = await createGreetingService(prisma).listInbox(
      { id: parentId, role: "parent" },
      { box: "sent", pageSize: 20 },
    );
    expect(page.items.find(({ id }) => id === greeting.id)?.note).toBe("历史说明已隐藏");
  });

  it("walks more than 50 inbox rows with stable keyset cursors while newer rows arrive", async () => {
    const pagingParent = await account("PARENT", "g-paging-parent");
    const parentProfile = await prisma.parentProfile.create({ data: { accountId: pagingParent.id, displayName: "分页家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: parentProfile.id, displayName: "分页学生", isActive: true } });
    const rows: Array<{ id: string; createdAt: Date }> = [];
    for (let index = 0; index < 55; index += 1) {
      const request = await prisma.tutoringRequest.create({ data: {
        parentProfileId: parentProfile.id, studentProfileId: student.id, regionId: regionIds[0],
        title: `分页需求${index}`, description: "分页稳定性", budgetMin: 1, budgetMax: 2,
        teachingMode: "ONLINE", status: "PUBLISHED", publishedAt: new Date("2026-07-01T00:00:00.000Z"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      } });
      const createdAt = new Date(`2026-07-${String(1 + Math.floor(index / 5)).padStart(2, "0")}T12:00:00.000Z`);
      const greeting = await prisma.greeting.create({ data: {
        senderAccountId: teacherId, recipientAccountId: pagingParent.id, tutoringRequestId: request.id,
        contextKey: `${teacherId}:${pagingParent.id}:${request.id}`, cardSnapshot: { legacy: true },
        createdAt, expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      } });
      rows.push({ id: greeting.id, createdAt });
    }
    const expected = rows.toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id)).map(({ id }) => id);
    const service = createGreetingService(prisma, () => new Date("2026-07-13T12:00:00.000Z"));
    const collected: string[] = [];
    let page = await service.listInbox({ id: pagingParent.id, role: "parent" }, { box: "received", pageSize: 20 });
    collected.push(...page.items.map(({ id }) => id));
    expect(page.nextCursor).toEqual(expect.any(String));

    const lateRequest = await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id, studentProfileId: student.id, regionId: regionIds[0], title: "并发新需求",
      description: "第一页之后插入", budgetMin: 1, budgetMax: 2, teachingMode: "ONLINE", status: "PUBLISHED",
      publishedAt: new Date(), expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    } });
    const late = await prisma.greeting.create({ data: {
      senderAccountId: teacherId, recipientAccountId: pagingParent.id, tutoringRequestId: lateRequest.id,
      contextKey: `${teacherId}:${pagingParent.id}:${lateRequest.id}`, cardSnapshot: { legacy: true },
      createdAt: new Date("2026-08-01T00:00:00.000Z"), expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    } });

    while (page.nextCursor) {
      page = await service.listInbox({ id: pagingParent.id, role: "parent" }, { box: "received", pageSize: 20, cursor: page.nextCursor });
      collected.push(...page.items.map(({ id }) => id));
    }
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(55);
    expect(collected).not.toContain(late.id);
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

  it("counts a cooldown-rejected send as an attempt on that UTC day", async () => {
    const scenario = await isolatedScenario("冷却计数");
    await scenario.service.respond({ id: scenario.parent.id, role: "parent" }, scenario.greeting.id, { action: "reject" });
    const retryAt = new Date("2026-07-14T08:00:00.000Z");
    const retryService = createGreetingService(prisma, () => retryAt);
    await expect(retryService.send({ id: scenario.teacher.id, role: "teacher" }, {
      targetId: scenario.request.id, requestId: scenario.request.id, note: "冷却期重试",
    })).rejects.toMatchObject({ code: "COOLDOWN" });
    await expect(prisma.greetingAttempt.count({ where: {
      senderAccountId: scenario.teacher.id,
      attemptedAt: { gte: new Date("2026-07-14T00:00:00.000Z"), lt: new Date("2026-07-15T00:00:00.000Z") },
    } })).resolves.toBe(1);
  });

  it("keeps independent ten-attempt limits on both sides of UTC midnight under concurrency", async () => {
    const scenario = await isolatedScenario("午夜限额");
    await prisma.greeting.delete({ where: { id: scenario.greeting.id } });
    await prisma.greetingAttempt.deleteMany({ where: { senderAccountId: { in: [scenario.parent.id, scenario.teacher.id] } } });
    const requests = [scenario.request];
    for (let index = 1; index < 20; index += 1) {
      const request = await prisma.tutoringRequest.create({ data: {
        parentProfileId: scenario.parentProfile.id, studentProfileId: scenario.student.id, regionId: scenario.region.id,
        title: `午夜需求${index}`, description: "UTC 边界", budgetMin: 1, budgetMax: 2, teachingMode: "ONLINE",
        status: "PUBLISHED", publishedAt: new Date("2026-07-01T00:00:00.000Z"), expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      } });
      await prisma.requestSubject.create({ data: { tutoringRequestId: request.id, subjectId: scenario.subject.id } });
      requests.push(request);
    }
    let clock = new Date("2026-07-13T23:59:59.999Z");
    const service = createGreetingService(prisma, () => clock);
    await expect(Promise.all(requests.slice(0, 10).map((request) => service.send(
      { id: scenario.parent.id, role: "parent" },
      { targetId: scenario.teacherProfile.id, requestId: request.id, note: "" },
    )))).resolves.toHaveLength(10);
    clock = new Date("2026-07-14T00:00:00.000Z");
    await expect(Promise.all(requests.slice(10).map((request) => service.send(
      { id: scenario.parent.id, role: "parent" },
      { targetId: scenario.teacherProfile.id, requestId: request.id, note: "" },
    )))).resolves.toHaveLength(10);
    await expect(prisma.greetingAttempt.count({ where: {
      senderAccountId: scenario.parent.id,
      attemptedAt: { gte: new Date("2026-07-13T00:00:00.000Z"), lt: new Date("2026-07-14T00:00:00.000Z") },
    } })).resolves.toBe(10);
    await expect(prisma.greetingAttempt.count({ where: {
      senderAccountId: scenario.parent.id,
      attemptedAt: { gte: new Date("2026-07-14T00:00:00.000Z"), lt: new Date("2026-07-15T00:00:00.000Z") },
    } })).resolves.toBe(10);
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
    const reports = await prisma.report.findMany({ where: { greetingId: greeting.id }, orderBy: { createdAt: "asc" } });
    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report).toMatchObject({
      targetType: "GREETING",
      targetId: greeting.id,
      targetSnapshot: { card: greeting.card, note: greeting.note },
    });
    expect(JSON.stringify(report.targetSnapshot)).not.toContain(reportParent.id);
    expect(JSON.stringify(report.targetSnapshot)).not.toContain(teacherId);

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

  it.each(INVALIDATIONS.flatMap((invalidation) => SAFE_ACTIONS.map((action) => [invalidation, action] as const)))(
    "allows recipient safety action %s / %s after public context invalidation",
    async (invalidation, action) => {
      const scenario = await isolatedScenario(`安全-${invalidation}-${action}`);
      await invalidateScenario(scenario, invalidation);
      const input = action === "reject" ? { action } as const : { action, reason: "不希望继续联系" } as const;

      await expect(scenario.service.respond({ id: scenario.parent.id, role: "parent" }, scenario.greeting.id, input))
        .resolves.toMatchObject({ status: action === "reject" ? "REJECTED" : action === "report" ? "REPORTED" : "BLOCKED" });
      if (action === "report") {
        await expect(prisma.report.count({ where: { greetingId: scenario.greeting.id } })).resolves.toBe(1);
        await expect(prisma.block.count({ where: { blockerAccountId: scenario.parent.id, blockedAccountId: scenario.teacher.id } })).resolves.toBe(0);
        await expect(scenario.service.respond({ id: scenario.parent.id, role: "parent" }, scenario.greeting.id, input)).resolves.toMatchObject({ reported: true });
      }
      if (action === "block") {
        await expect(prisma.block.count({ where: { blockerAccountId: scenario.parent.id, blockedAccountId: scenario.teacher.id } })).resolves.toBe(1);
      }
    },
  );

  it.each(INVALIDATIONS)("rejects accept after %s invalidates the public context", async (invalidation) => {
    const scenario = await isolatedScenario(`接受-${invalidation}`);
    await invalidateScenario(scenario, invalidation);
    await expect(scenario.service.respond({ id: scenario.parent.id, role: "parent" }, scenario.greeting.id, { action: "accept" }))
      .rejects.toMatchObject({ code: "INVALID_TARGET" });
    await expect(prisma.conversation.count({ where: { greetingId: scenario.greeting.id } })).resolves.toBe(0);
  });

  it.each(["accept", "reject", "report", "block"] as const)("rejects sender and unrelated-account %s transitions", async (action) => {
    const scenario = await isolatedScenario(`越权-${action}`);
    const stranger = await account("PARENT", `stranger-${action}-${crypto.randomUUID().slice(0, 8)}`);
    const input = action === "report" || action === "block" ? { action, reason: "越权测试" } as const : { action } as const;
    await expect(scenario.service.respond({ id: scenario.teacher.id, role: "teacher" }, scenario.greeting.id, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scenario.service.respond({ id: stranger.id, role: "parent" }, scenario.greeting.id, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(prisma.greeting.findUniqueOrThrow({ where: { id: scenario.greeting.id } })).resolves.toMatchObject({ status: "PENDING" });
  });

  it.each(["accept", "reject", "report", "block"] as const)("requires an active recipient before %s", async (action) => {
    const scenario = await isolatedScenario(`停用接收方-${action}`);
    await prisma.account.update({ where: { id: scenario.parent.id }, data: { status: "DISABLED" } });
    const input = action === "report" || action === "block" ? { action, reason: "认证顺序测试" } as const : { action } as const;
    await expect(scenario.service.respond({ id: scenario.parent.id, role: "parent" }, scenario.greeting.id, input))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(prisma.greeting.findUniqueOrThrow({ where: { id: scenario.greeting.id } })).resolves.toMatchObject({ status: "PENDING" });
  });

  it.each(["accept", "reject", "report", "block"] as const)("checks exact expiry before %s", async (action) => {
    const scenario = await isolatedScenario(`过期-${action}`);
    const expiredService = createGreetingService(prisma, () => new Date("2026-07-21T12:00:00.000Z"));
    const input = action === "report" || action === "block" ? { action, reason: "过期顺序测试" } as const : { action } as const;
    await expect(expiredService.respond({ id: scenario.parent.id, role: "parent" }, scenario.greeting.id, input))
      .rejects.toMatchObject({ code: "EXPIRED" });
    await expect(prisma.greeting.findUniqueOrThrow({ where: { id: scenario.greeting.id } })).resolves.toMatchObject({ status: "EXPIRED" });
  });
});

const DAY = 24 * 60 * 60 * 1000;
const INVALIDATIONS = [
  "profile-missing", "profile-unpublished", "profile-headline-missing", "profile-headline-unsafe", "request-unpublished", "request-mode-missing", "student-inactive", "student-alias-unsafe",
  "subject-inactive", "region-inactive", "sender-account-disabled",
] as const;
type Invalidation = typeof INVALIDATIONS[number];
const SAFE_ACTIONS = ["reject", "report", "block"] as const;
