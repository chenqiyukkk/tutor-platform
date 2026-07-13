// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaDirectoryRepository } from "./repository";
import { createDirectoryHandlers } from "./route-handler";
import { findAdjacentRegionPairs } from "./adjacency";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for directory integration tests");

describe("Prisma public directory repository", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const repository = new PrismaDirectoryRepository(prisma);
  const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const accountIds: string[] = [];
  const subjectIds: string[] = [];
  const regionIds: string[] = [];
  let visibleTeacherId = "";
  let visibleRequestId = "";
  let activeSubjectId = "";
  let activeRegionId = "";
  let canonicalAdjacentPair: [string, string] = ["", ""];
  let expiredRequestId = "";
  let hiddenTeacherIds: string[] = [];
  let hiddenRequestIds: string[] = [];

  async function account(role: "TEACHER" | "PARENT", label: string, status: "ACTIVE" | "DISABLED" = "ACTIVE") {
    const created = await prisma.account.create({ data: {
      role,
      status,
      username: `${label}-${marker}`,
      normalizedUsername: `${label}-${marker}`,
      email: `${label}-${marker}@private.example`,
      normalizedEmail: `${label}-${marker}@private.example`,
      passwordHash: `private-password-${label}`,
    } });
    accountIds.push(created.id);
    return created;
  }

  afterAll(async () => {
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    if (subjectIds.length) await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } });
    if (regionIds.length) await prisma.region.deleteMany({ where: { id: { in: regionIds } } });
    await prisma.$disconnect();
  });

  beforeAll(async () => {
    const activeSubject = await prisma.subject.create({ data: {
      name: `数学-${marker}`, slug: `directory-math-${marker}`,
    } });
    const inactiveSubject = await prisma.subject.create({ data: {
      name: `停用科目-${marker}`, slug: `directory-inactive-${marker}`, isActive: false,
    } });
    subjectIds.push(activeSubject.id, inactiveSubject.id);
    activeSubjectId = activeSubject.id;
    const activeRegion = await prisma.region.create({ data: {
      code: `DIRECTORY-${marker}`, name: `海淀测试区-${marker}`, level: 3,
    } });
    const inactiveRegion = await prisma.region.create({ data: {
      code: `DIRECTORY-INACTIVE-${marker}`, name: `停用测试区-${marker}`, level: 3, isActive: false,
    } });
    const adjacentRegion = await prisma.region.create({ data: {
      code: `DIRECTORY-ADJACENT-${marker}`, name: `相邻测试区-${marker}`, level: 3,
    } });
    regionIds.push(activeRegion.id, inactiveRegion.id, adjacentRegion.id);
    activeRegionId = activeRegion.id;
    canonicalAdjacentPair = [activeRegion.id, adjacentRegion.id].sort() as [string, string];
    await prisma.regionAdjacency.create({ data: {
      regionAId: canonicalAdjacentPair[0],
      regionBId: canonicalAdjacentPair[1],
    } });
    const publishedAt = new Date("2026-07-01T08:00:00.000Z");

    const visibleAccount = await account("TEACHER", "visible-teacher");
    const visibleTeacher = await prisma.teacherProfile.create({ data: {
      accountId: visibleAccount.id,
      displayName: `林老师-${marker}`,
      identityType: "FULL_TIME_TEACHER",
      headline: "把几何讲成方法",
      bio: "公开教学简介",
      yearsExperience: 8,
      hourlyRate: 100,
      hourlyRateMax: 180,
      isOnline: true,
      status: "PUBLISHED",
      publishedAt,
      subjects: { create: { subjectId: activeSubject.id } },
      serviceAreas: { create: { regionId: activeRegion.id, isPrimary: true } },
    } });
    visibleTeacherId = visibleTeacher.id;
    await prisma.verification.create({ data: {
      accountId: visibleAccount.id,
      teacherProfileId: visibleTeacher.id,
      type: "IDENTITY",
      status: "APPROVED",
      evidence: { documentPath: "/private/teacher-card.jpg" },
      reviewNote: "private review",
    } });

    const draftAccount = await account("TEACHER", "draft-teacher");
    await prisma.teacherProfile.create({ data: {
      accountId: draftAccount.id, displayName: "草稿教师", status: "DRAFT",
      subjects: { create: { subjectId: activeSubject.id } },
      serviceAreas: { create: { regionId: activeRegion.id, isPrimary: true } },
    } });
    const disabledAccount = await account("TEACHER", "disabled-teacher", "DISABLED");
    const disabledTeacher = await prisma.teacherProfile.create({ data: {
      accountId: disabledAccount.id, displayName: "停用教师", identityType: "FULL_TIME_TEACHER",
      bio: "除账号状态外均完整", yearsExperience: 5, hourlyRate: 100, hourlyRateMax: 180,
      status: "PUBLISHED", publishedAt,
      subjects: { create: { subjectId: activeSubject.id } },
      serviceAreas: { create: { regionId: activeRegion.id, isPrimary: true } },
    } });
    const inactiveSubjectAccount = await account("TEACHER", "inactive-subject-teacher");
    const inactiveSubjectTeacher = await prisma.teacherProfile.create({ data: {
      accountId: inactiveSubjectAccount.id, displayName: "科目停用教师", identityType: "FULL_TIME_TEACHER",
      bio: "除科目状态外均完整", yearsExperience: 5, hourlyRate: 100, hourlyRateMax: 180,
      status: "PUBLISHED", publishedAt,
      subjects: { create: { subjectId: inactiveSubject.id } },
      serviceAreas: { create: { regionId: activeRegion.id, isPrimary: true } },
    } });
    const inactiveRegionAccount = await account("TEACHER", "inactive-region-teacher");
    const inactiveRegionTeacher = await prisma.teacherProfile.create({ data: {
      accountId: inactiveRegionAccount.id, displayName: "地区停用教师", identityType: "FULL_TIME_TEACHER",
      bio: "除地区状态外均完整", yearsExperience: 5, hourlyRate: 100, hourlyRateMax: 180,
      status: "PUBLISHED", publishedAt,
      subjects: { create: { subjectId: activeSubject.id } },
      serviceAreas: { create: { regionId: inactiveRegion.id, isPrimary: true } },
    } });

    const visibleParent = await account("PARENT", "visible-parent");
    const parentProfile = await prisma.parentProfile.create({ data: {
      accountId: visibleParent.id, displayName: "不可公开的家长姓名",
    } });
    const student = await prisma.studentProfile.create({ data: {
      parentProfileId: parentProfile.id,
      displayName: "小树",
      gradeLevel: "GRADE_8",
      notes: "不可公开的学生诊断记录",
    } });
    const visibleRequest = await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id,
      studentProfileId: student.id,
      regionId: activeRegion.id,
      title: "初二数学巩固",
      description: "希望梳理几何基础",
      scheduleText: "周六下午",
      budgetMin: 10000,
      budgetMax: 16000,
      teachingMode: "BOTH",
      publicLocationNote: "五道口商圈附近",
      status: "PUBLISHED",
      publishedAt,
      subjects: { create: { subjectId: activeSubject.id } },
    } });
    visibleRequestId = visibleRequest.id;
    await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id, studentProfileId: student.id, regionId: activeRegion.id,
      title: "草稿需求", description: "不应公开", status: "DRAFT",
      subjects: { create: { subjectId: activeSubject.id } },
    } });
    const inactiveSubjectRequest = await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id, studentProfileId: student.id, regionId: activeRegion.id,
      title: "科目停用需求", description: "除科目状态外均完整", scheduleText: "周六",
      budgetMin: 10000, budgetMax: 16000, teachingMode: "BOTH",
      status: "PUBLISHED", publishedAt,
      subjects: { create: { subjectId: inactiveSubject.id } },
    } });
    const inactiveRegionRequest = await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id, studentProfileId: student.id, regionId: inactiveRegion.id,
      title: "地区停用需求", description: "除地区状态外均完整", scheduleText: "周六",
      budgetMin: 10000, budgetMax: 16000, teachingMode: "BOTH",
      status: "PUBLISHED", publishedAt,
      subjects: { create: { subjectId: activeSubject.id } },
    } });
    const expiredRequest = await prisma.tutoringRequest.create({ data: {
      parentProfileId: parentProfile.id, studentProfileId: student.id, regionId: activeRegion.id,
      title: "已过期需求", description: "除过期时间外均完整", scheduleText: "周六",
      budgetMin: 10000, budgetMax: 16000, teachingMode: "BOTH",
      status: "PUBLISHED", publishedAt, expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      subjects: { create: { subjectId: activeSubject.id } },
    } });
    expiredRequestId = expiredRequest.id;
    hiddenTeacherIds = [
      disabledTeacher.id,
      inactiveSubjectTeacher.id,
      inactiveRegionTeacher.id,
    ];
    hiddenRequestIds = [
      inactiveSubjectRequest.id,
      inactiveRegionRequest.id,
      expiredRequest.id,
    ];
  });

  it("returns only publishable teachers and requests through public whitelist DTOs", async () => {

    const teachers = await repository.listTeachers({
      page: 1, pageSize: 12,
    });
    const requests = await repository.listRequests({
      page: 1, pageSize: 12,
    });

    expect(teachers.total).toBe(1);
    expect(teachers.items).toHaveLength(1);
    expect(teachers.items[0]).toMatchObject({
      id: visibleTeacherId,
      publicNickname: `林老师-${marker}`,
      verified: true,
    });
    expect(teachers.items.map(({ id }) => id)).not.toEqual(expect.arrayContaining(hiddenTeacherIds));
    expect(requests.total).toBe(1);
    expect(requests.items).toHaveLength(1);
    expect(requests.items[0]).toMatchObject({
      id: visibleRequestId,
      studentAlias: "小树",
      gradeLevel: "GRADE_8",
    });
    expect(requests.items.map(({ id }) => id)).not.toEqual(expect.arrayContaining(hiddenRequestIds));
    const payload = JSON.stringify({ teachers, requests });
    expect(payload).not.toContain("@private.example");
    expect(payload).not.toContain("private-password");
    expect(payload).not.toContain("/private/teacher-card.jpg");
    expect(payload).not.toContain("private review");
    expect(payload).not.toContain("不可公开的家长姓名");
    expect(payload).not.toContain("不可公开的学生诊断记录");
  });

  it("applies directory-specific filters and stable page ordering", async () => {
    for (const label of ["stable-a", "stable-b"]) {
      const extraAccount = await account("TEACHER", label);
      const profile = await prisma.teacherProfile.create({ data: {
        accountId: extraAccount.id,
        displayName: `稳定分页-${label}`,
        identityType: "FULL_TIME_TEACHER",
        headline: "稳定分页测试",
        bio: "公开教学简介",
        yearsExperience: 3,
        hourlyRate: 100,
        hourlyRateMax: 180,
        isOnline: true,
        status: "PUBLISHED",
        publishedAt: new Date("2026-07-01T08:00:00.000Z"),
      } });
      await prisma.teacherSubject.create({ data: {
        teacherProfileId: profile.id, subjectId: activeSubjectId,
      } });
      await prisma.teacherServiceArea.create({ data: {
        teacherProfileId: profile.id, regionId: activeRegionId, isPrimary: true,
      } });
    }
    const identity = await repository.listTeachers({
      identityType: "FULL_TIME_TEACHER", page: 1, pageSize: 12,
    });
    const online = await repository.listTeachers({ mode: "ONLINE", page: 1, pageSize: 12 });
    const offlineMiss = await repository.listTeachers({ mode: "OFFLINE", district: crypto.randomUUID(), page: 1, pageSize: 12 });
    const teacherBudget = await repository.listTeachers({ budgetMin: 12000, budgetMax: 13000, page: 1, pageSize: 12 });
    const requestBudget = await repository.listRequests({ budgetMin: 12000, budgetMax: 13000, page: 1, pageSize: 12 });
    const requestFilters = await repository.listRequests({
      district: activeRegionId, subject: activeSubjectId, mode: "OFFLINE", page: 1, pageSize: 12,
    });

    expect(identity.items.map(({ id }) => id)).toContain(visibleTeacherId);
    expect(online.items.map(({ id }) => id)).toContain(visibleTeacherId);
    expect(offlineMiss.items).toHaveLength(0);
    expect(teacherBudget.items.map(({ id }) => id)).toContain(visibleTeacherId);
    expect(requestBudget.items.map(({ id }) => id)).toContain(visibleRequestId);
    expect(requestFilters.items.map(({ id }) => id)).toContain(visibleRequestId);

    const first = await repository.listTeachers({ page: 1, pageSize: 1 });
    const second = await repository.listTeachers({ page: 2, pageSize: 1 });
    const third = await repository.listTeachers({ page: 3, pageSize: 1 });
    const repeated = await repository.listTeachers({ page: 1, pageSize: 1 });
    expect(new Set([...first.items, ...second.items, ...third.items].map(({ id }) => id)).size).toBe(3);
    expect(repeated.items.map(({ id }) => id)).toEqual(first.items.map(({ id }) => id));
  });

  it("returns null for missing or non-public details and detailed safe DTOs for public records", async () => {
    await expect(repository.getTeacherPreview(crypto.randomUUID())).resolves.toBeNull();
    await expect(repository.getRequestPreview(crypto.randomUUID())).resolves.toBeNull();
    await expect(repository.getTeacherPreview(visibleTeacherId)).resolves.not.toHaveProperty("bio");
    await expect(repository.getTeacherDetail(visibleTeacherId)).resolves.toMatchObject({
      id: visibleTeacherId, bio: "公开教学简介",
    });
    await expect(repository.getRequestPreview(visibleRequestId)).resolves.not.toHaveProperty("description");
    await expect(repository.getRequestPreview(visibleRequestId)).resolves.not.toHaveProperty("publicLocationNote");
    await expect(repository.getRequestDetail(visibleRequestId)).resolves.toMatchObject({
      id: visibleRequestId,
      description: "希望梳理几何基础",
      publicLocationNote: "五道口商圈附近",
    });
    await expect(repository.getRequestPreview(expiredRequestId)).resolves.toBeNull();
    await expect(repository.getRequestDetail(expiredRequestId)).resolves.toBeNull();
  });

  it("rejects invalid, repeated, and unknown API queries before a real repository call", async () => {
    const handlers = createDirectoryHandlers(repository);
    for (const query of ["page=1&page=2", "unknown=value", "pageSize=25"]) {
      const response = await handlers.teachers.GET(new Request(`https://example.test/api/directory/teachers?${query}`));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_QUERY" });
    }
  });

  it("loads deterministic neighboring districts from real database context", async () => {
    await expect(findAdjacentRegionPairs(prisma, [activeRegionId])).resolves.toEqual([
      canonicalAdjacentPair,
    ]);
  });
});
