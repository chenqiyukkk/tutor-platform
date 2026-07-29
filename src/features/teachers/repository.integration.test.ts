// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaTeacherProfileRepository } from "./repository";
import { TeacherProfileError, createTeacherProfileService } from "./service";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for teacher integration tests");

describe("Prisma teacher profile repository", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const repository = new PrismaTeacherProfileRepository(prisma);
  const service = createTeacherProfileService(repository);
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

  it("upserts one owned profile and atomically replaces subjects and one-plus-four districts", async () => {
    const makeAccount = async (suffix: string) => {
      const account = await prisma.account.create({ data: {
        role: "TEACHER",
        username: `teacher-${suffix}-${marker}`,
        normalizedUsername: `teacher-${suffix}-${marker}`,
        email: `teacher-${suffix}-${marker}@example.test`,
        normalizedEmail: `teacher-${suffix}-${marker}@example.test`,
        passwordHash: "integration-only",
      } });
      accountIds.push(account.id);
      return account;
    };
    const [accountA, accountB] = await Promise.all([makeAccount("a"), makeAccount("b")]);
    const subjects = await Promise.all(["数学", "物理"].map((name, index) =>
      prisma.subject.create({ data: {
        name: `${name}-${marker}`,
        slug: `${marker}-subject-${index}`,
        sortOrder: index,
      } })));
    subjectIds.push(...subjects.map(({ id }) => id));
    const regions = await Promise.all(Array.from({ length: 7 }, (_, index) =>
      prisma.region.create({ data: {
        code: `TP${marker}${index}`,
        name: `测试区${index}`,
        level: 3,
        sortOrder: index,
      } })));
    regionIds.push(...regions.map(({ id }) => id));

    const teacherA = { id: accountA.id, role: "teacher" };
    const initial = await service.saveDraft(teacherA, {
      publicNickname: " A 老师 ",
      identityType: "FULL_TIME_TEACHER",
      bio: "长期从事一线教学，能够根据学生情况设计清晰的学习路径。",
      yearsExperience: 8,
      online: true,
      rateMinCents: 10000,
      rateMaxCents: 18000,
      subjectIds: subjects.map(({ id }) => id),
      primaryRegionId: regions[0].id,
      extraRegionIds: regions.slice(1, 5).map(({ id }) => id),
    });
    expect(initial.accountId).toBe(accountA.id);
    expect(initial.subjects).toHaveLength(2);
    expect(initial.extraRegions).toHaveLength(4);

    const profileB = await prisma.teacherProfile.create({ data: {
      accountId: accountB.id,
      displayName: "B 老师",
    } });
    const updated = await service.saveDraft(teacherA, {
      publicNickname: "A 老师已更新",
      subjectIds: [subjects[1].id],
      primaryRegionId: regions[5].id,
      extraRegionIds: [regions[6].id],
    });
    expect(updated.id).toBe(initial.id);
    expect(updated.subjects.map(({ id }) => id)).toEqual([subjects[1].id]);
    expect(updated.primaryRegion?.id).toBe(regions[5].id);
    expect(updated.extraRegions.map(({ id }) => id)).toEqual([regions[6].id]);
    await expect(prisma.teacherProfile.findUniqueOrThrow({ where: { id: profileB.id } }))
      .resolves.toMatchObject({ displayName: "B 老师" });

    const beforeFailure = await repository.findOwned(accountA.id);
    await expect(service.saveDraft(teacherA, {
      publicNickname: "不应写入",
      subjectIds: [subjects[0].id],
      primaryRegionId: regions[0].id,
      extraRegionIds: regions.slice(1, 6).map(({ id }) => id),
    })).rejects.toBeInstanceOf(TeacherProfileError);
    await expect(repository.findOwned(accountA.id)).resolves.toEqual(beforeFailure);

    await expect(service.saveDraft(teacherA, {
      publicNickname: "也不应写入",
      subjectIds: [subjects[0].id, "ffffffff-ffff-4fff-8fff-ffffffffffff"],
      primaryRegionId: regions[0].id,
    })).rejects.toMatchObject({ code: "INVALID_SUBJECT" });
    await expect(repository.findOwned(accountA.id)).resolves.toEqual(beforeFailure);

    await expect(service.saveDraft(teacherA, {
      publicNickname: "无效地区不应写入",
      subjectIds: [subjects[0].id],
      primaryRegionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    })).rejects.toMatchObject({ code: "INVALID_REGION" });
    await expect(repository.findOwned(accountA.id)).resolves.toEqual(beforeFailure);

    await prisma.region.update({ where: { id: regions[0].id }, data: { isActive: false } });
    await expect(service.saveDraft(teacherA, {
      publicNickname: "停用地区不应写入",
      subjectIds: [subjects[0].id],
      primaryRegionId: regions[0].id,
    })).rejects.toMatchObject({ code: "INVALID_REGION" });
    await expect(repository.findOwned(accountA.id)).resolves.toEqual(beforeFailure);
    await prisma.region.update({ where: { id: regions[0].id }, data: { isActive: true } });

    await service.saveDraft(teacherA, {
      publicNickname: "A 老师",
      headline: "把复杂知识讲清楚",
      identityType: "FULL_TIME_TEACHER",
      bio: "长期从事一线教学，能够根据学生情况设计清晰的学习路径。",
      yearsExperience: 8,
      online: true,
      rateMinCents: 10000,
      rateMaxCents: 18000,
      subjectIds: [subjects[1].id],
      primaryRegionId: regions[5].id,
    });
    await prisma.subject.update({ where: { id: subjects[1].id }, data: { isActive: false } });
    await expect(service.publish(teacherA)).rejects.toMatchObject({ code: "INVALID_SUBJECT" });
    await expect(repository.findOwned(accountA.id)).resolves.toMatchObject({ status: "DRAFT" });

    await prisma.subject.update({ where: { id: subjects[1].id }, data: { isActive: true } });
    await prisma.region.update({ where: { id: regions[5].id }, data: { isActive: false } });
    await expect(service.publish(teacherA)).rejects.toMatchObject({ code: "INVALID_REGION" });
    await expect(repository.findOwned(accountA.id)).resolves.toMatchObject({ status: "DRAFT" });
    await prisma.region.update({ where: { id: regions[5].id }, data: { isActive: true } });

    await prisma.teacherProfile.update({
      where: { accountId: accountA.id },
      data: { displayName: "" },
    });
    await expect(repository.setPublished(accountA.id, true)).rejects.toMatchObject({
      code: "INCOMPLETE_PROFILE",
      fieldErrors: expect.objectContaining({ publicNickname: expect.any(Array) }),
    });
    await expect(repository.findOwned(accountA.id)).resolves.toMatchObject({ status: "DRAFT" });

    await service.saveDraft(teacherA, {
      publicNickname: "A 老师",
      headline: "把复杂知识讲清楚",
      identityType: "FULL_TIME_TEACHER",
      bio: "长期从事一线教学，能够根据学生情况设计清晰的学习路径。",
      yearsExperience: 8,
      online: true,
      rateMinCents: 10000,
      rateMaxCents: 18000,
      subjectIds: [subjects[1].id],
      primaryRegionId: regions[5].id,
    });
    let locked!: () => void;
    let release!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { locked = resolve; });
    const releaseWriter = new Promise<void>((resolve) => { release = resolve; });
    const staleWriter = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "TeacherProfile" WHERE "accountId" = ${accountA.id}::uuid FOR UPDATE`;
      await transaction.teacherProfile.update({
        where: { accountId: accountA.id },
        data: { bio: null, status: "DRAFT", publishedAt: null },
      });
      locked();
      await releaseWriter;
    });
    await lockAcquired;
    const concurrentPublish = repository.setPublished(accountA.id, true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await staleWriter;
    await expect(concurrentPublish).rejects.toMatchObject({ code: "INCOMPLETE_PROFILE" });
    await expect(repository.findOwned(accountA.id)).resolves.toMatchObject({
      bio: null,
      status: "DRAFT",
    });

    await service.saveDraft(teacherA, {
      publicNickname: "A 老师",
      headline: "把复杂知识讲清楚",
      identityType: "FULL_TIME_TEACHER",
      bio: "长期从事一线教学，能够根据学生情况设计清晰的学习路径。",
      yearsExperience: 8,
      online: true,
      rateMinCents: 10000,
      rateMaxCents: 18000,
      subjectIds: [subjects[1].id],
      primaryRegionId: regions[5].id,
    });
    const triggerFunction = `test_teacher_publish_sleep_${marker}`;
    const triggerName = `test_teacher_publish_trigger_${marker}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${triggerFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'PUBLISHED' THEN PERFORM pg_sleep(1); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE ON "TeacherProfile"
      FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"();
    `);
    const delayedPublish = repository.setPublished(accountA.id, true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const deactivate = prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        await transaction.subject.update({
          where: { id: subjects[1].id },
          data: { isActive: false },
        });
      });
      await expect(deactivate).rejects.toThrow();
      await expect(delayedPublish).resolves.toMatchObject({ status: "PUBLISHED" });
      await expect(prisma.teacherProfile.findUniqueOrThrow({ where: { accountId: accountA.id } }))
        .resolves.toMatchObject({ publicContentSafetyVersion: 1 });
      await service.unpublish(teacherA);
      await expect(prisma.teacherProfile.findUniqueOrThrow({ where: { accountId: accountA.id } }))
        .resolves.toMatchObject({ status: "DRAFT", publicContentSafetyVersion: 0 });
    } finally {
      await delayedPublish.catch(() => undefined);
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "TeacherProfile"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${triggerFunction}"()`);
      await prisma.subject.update({ where: { id: subjects[1].id }, data: { isActive: true } });
    }
  });

  it("enforces rate database checks at both legal boundaries without partial updates", async () => {
    const account = await prisma.account.create({ data: {
      role: "TEACHER",
      username: `teacher-rate-${marker}`,
      normalizedUsername: `teacher-rate-${marker}`,
      email: `teacher-rate-${marker}@example.test`,
      normalizedEmail: `teacher-rate-${marker}@example.test`,
      passwordHash: "integration-only",
    } });
    accountIds.push(account.id);

    await expect(prisma.teacherProfile.create({ data: {
      accountId: account.id,
      displayName: "价格测试",
      hourlyRate: -0.01,
      hourlyRateMax: 0,
    } })).rejects.toThrow();
    await expect(prisma.teacherProfile.create({ data: {
      accountId: account.id,
      displayName: "价格测试",
      hourlyRate: 0,
      hourlyRateMax: 1000.01,
    } })).rejects.toThrow();

    const legal = await prisma.teacherProfile.create({ data: {
      accountId: account.id,
      displayName: "价格测试",
      hourlyRate: 0,
      hourlyRateMax: 1000,
    } });
    await expect(prisma.teacherProfile.update({
      where: { id: legal.id },
      data: { hourlyRate: 1000, hourlyRateMax: 999.99 },
    })).rejects.toThrow();
    await expect(prisma.teacherProfile.findUniqueOrThrow({ where: { id: legal.id } }))
      .resolves.toMatchObject({ hourlyRate: expect.objectContaining({}), hourlyRateMax: expect.objectContaining({}) });
    const persisted = await prisma.teacherProfile.findUniqueOrThrow({ where: { id: legal.id } });
    expect(persisted.hourlyRate?.toNumber()).toBe(0);
    expect(persisted.hourlyRateMax?.toNumber()).toBe(1000);
  });

  it("requires an owner edit to clear a moderation hold and rejects suspended-owner writes", async () => {
    const account = await prisma.account.create({ data: {
      role: "TEACHER",
      username: `teacher-hold-${marker}`,
      normalizedUsername: `teacher-hold-${marker}`,
      email: `teacher-hold-${marker}@example.test`,
      normalizedEmail: `teacher-hold-${marker}@example.test`,
      passwordHash: "integration-only",
    } });
    accountIds.push(account.id);
    const subject = await prisma.subject.create({ data: { name: `持有科目-${marker}`, slug: `${marker}-hold-subject` } });
    subjectIds.push(subject.id);
    const region = await prisma.region.create({ data: { code: `TH${marker}`, name: "持有测试区", level: 3 } });
    regionIds.push(region.id);
    const profile = await prisma.teacherProfile.create({ data: {
      accountId: account.id,
      displayName: "持有测试老师",
      headline: "认真负责的测试老师",
      identityType: "FULL_TIME_TEACHER",
      bio: "这是只用于测试的完整教师简介内容，不包含任何真实个人资料。",
      yearsExperience: 3,
      hourlyRate: 100,
      hourlyRateMax: 150,
      status: "DRAFT",
      moderationRejectedAt: new Date(),
      moderationReason: "公开内容需修改",
      subjects: { create: { subjectId: subject.id } },
      serviceAreas: { create: { regionId: region.id, isPrimary: true } },
    } });
    await expect(repository.setPublished(account.id, true)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(prisma.teacherProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .resolves.toMatchObject({ moderationReason: "公开内容需修改", status: "DRAFT" });

    const saved = {
      publicNickname: "持有测试老师",
      headline: "认真负责的测试老师",
      identityType: "FULL_TIME_TEACHER" as const,
      bio: "这是只用于测试的完整教师简介内容，不包含任何真实个人资料。",
      yearsExperience: 3,
      online: false,
      rateMinCents: 10_000,
      rateMaxCents: 15_000,
      subjectIds: [subject.id],
      primaryRegionId: region.id,
      extraRegionIds: [],
    };
    await repository.saveOwned(account.id, saved);
    await expect(prisma.teacherProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .resolves.toMatchObject({ moderationRejectedAt: null, moderationReason: null });
    await expect(repository.setPublished(account.id, true)).resolves.toMatchObject({ status: "PUBLISHED" });

    await prisma.account.update({ where: { id: account.id }, data: { status: "SUSPENDED" } });
    await expect(repository.saveOwned(account.id, saved)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.setPublished(account.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
