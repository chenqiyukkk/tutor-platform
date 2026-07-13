// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createFavoriteService } from "./service";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

describe("favorites against PostgreSQL", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const accountIds: string[] = [];
  const regionIds: string[] = [];
  const subjectIds: string[] = [];
  let parentId = "", teacherId = "", profileId = "", requestId = "";

  beforeAll(async () => {
    const makeAccount = async (role: "PARENT" | "TEACHER", name: string) => {
      const row = await prisma.account.create({ data: { role, username: `${name}-${marker}`, normalizedUsername: `${name}-${marker}`, email: `${name}-${marker}@example.test`, normalizedEmail: `${name}-${marker}@example.test`, passwordHash: "test" } });
      accountIds.push(row.id); return row;
    };
    parentId = (await makeAccount("PARENT", "fav-parent")).id;
    teacherId = (await makeAccount("TEACHER", "fav-teacher")).id;
    const region = await prisma.region.create({ data: { code: `F${marker}`, name: "收藏区", level: 3 } }); regionIds.push(region.id);
    const subject = await prisma.subject.create({ data: { slug: `f-${marker}`, name: "收藏数学" } }); subjectIds.push(subject.id);
    const parent = await prisma.parentProfile.create({ data: { accountId: parentId, displayName: "收藏家长", status: "PUBLISHED" } });
    const student = await prisma.studentProfile.create({ data: { parentProfileId: parent.id, displayName: "收藏学生", isActive: true } });
    const profile = await prisma.teacherProfile.create({ data: { accountId: teacherId, displayName: "收藏老师", identityType: "FULL_TIME_TEACHER", headline: "公开老师", bio: "公开自述", yearsExperience: 2, hourlyRate: 80, hourlyRateMax: 100, status: "PUBLISHED", publishedAt: new Date() } }); profileId = profile.id;
    await prisma.teacherSubject.create({ data: { teacherProfileId: profileId, subjectId: subject.id } });
    await prisma.teacherServiceArea.create({ data: { teacherProfileId: profileId, regionId: region.id, isPrimary: true } });
    const request = await prisma.tutoringRequest.create({ data: { parentProfileId: parent.id, studentProfileId: student.id, regionId: region.id, title: "公开需求", description: "公开描述", budgetMin: 8000, budgetMax: 10000, teachingMode: "BOTH", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now()+DAY) } }); requestId = request.id;
    await prisma.requestSubject.create({ data: { tutoringRequestId: requestId, subjectId: subject.id } });
  });

  afterAll(async () => {
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    if (subjectIds.length) await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } });
    if (regionIds.length) await prisma.region.deleteMany({ where: { id: { in: regionIds } } });
    await prisma.$disconnect();
  });

  it("allows only parent→public teacher and is idempotent", async () => {
    const service = createFavoriteService(prisma);
    const first = await service.add({ id: parentId, role: "parent" }, { targetType: "teacher", targetId: profileId });
    const second = await service.add({ id: parentId, role: "parent" }, { targetType: "teacher", targetId: profileId });
    expect(second.id).toBe(first.id);
    await expect(service.add({ id: teacherId, role: "teacher" }, { targetType: "teacher", targetId: profileId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.stringify(await service.list({ id: parentId, role: "parent" }))).not.toMatch(/email|username|password|evidence/i);
    await service.remove({ id: parentId, role: "parent" }, { targetType: "teacher", targetId: profileId });
    await service.remove({ id: parentId, role: "parent" }, { targetType: "teacher", targetId: profileId });
  });

  it("allows only teacher→public request and rejects stale targets", async () => {
    const service = createFavoriteService(prisma);
    await expect(service.add({ id: teacherId, role: "teacher" }, { targetType: "request", targetId: requestId })).resolves.toMatchObject({ targetType: "request" });
    await expect(service.add({ id: parentId, role: "parent" }, { targetType: "request", targetId: requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.tutoringRequest.update({ where: { id: requestId }, data: { status: "DRAFT", publishedAt: null } });
    await expect(service.add({ id: teacherId, role: "teacher" }, { targetType: "request", targetId: requestId })).rejects.toMatchObject({ code: "INVALID_TARGET" });
  });
});

const DAY = 24 * 60 * 60 * 1000;
