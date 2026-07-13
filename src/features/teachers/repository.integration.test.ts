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

    await service.saveDraft(teacherA, {
      publicNickname: "A 老师",
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
  });
});
