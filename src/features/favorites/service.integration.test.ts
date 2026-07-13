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
    const profile = await prisma.teacherProfile.create({ data: { accountId: teacherId, displayName: "收藏老师", identityType: "FULL_TIME_TEACHER", headline: "公开老师", bio: "公开自述", yearsExperience: 2, hourlyRate: 80, hourlyRateMax: 100, status: "PUBLISHED", publishedAt: new Date(), publicContentSafetyVersion: 1 } }); profileId = profile.id;
    await prisma.teacherSubject.create({ data: { teacherProfileId: profileId, subjectId: subject.id } });
    await prisma.teacherServiceArea.create({ data: { teacherProfileId: profileId, regionId: region.id, isPrimary: true } });
    const request = await prisma.tutoringRequest.create({ data: { parentProfileId: parent.id, studentProfileId: student.id, regionId: region.id, title: "公开需求", description: "公开描述", budgetMin: 8000, budgetMax: 10000, teachingMode: "BOTH", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now()+DAY), publicContentSafetyVersion: 1 } }); requestId = request.id;
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
    await expect(service.has({ id: parentId, role: "parent" }, { targetType: "teacher", targetId: profileId })).resolves.toBe(true);
    await expect(service.add({ id: teacherId, role: "teacher" }, { targetType: "teacher", targetId: profileId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.stringify(await service.list({ id: parentId, role: "parent" }))).not.toMatch(/email|username|password|evidence/i);
    await service.remove({ id: parentId, role: "parent" }, { targetType: "teacher", targetId: profileId });
    await expect(service.has({ id: parentId, role: "parent" }, { targetType: "teacher", targetId: profileId })).resolves.toBe(false);
    await service.remove({ id: parentId, role: "parent" }, { targetType: "teacher", targetId: profileId });
  });

  it("does not expose a published teacher whose headline is missing", async () => {
    const service = createFavoriteService(prisma);
    await prisma.teacherProfile.update({ where: { id: profileId }, data: { headline: null } });
    try {
      await expect(service.add(
        { id: parentId, role: "parent" },
        { targetType: "teacher", targetId: profileId },
      )).rejects.toMatchObject({ code: "INVALID_TARGET" });
    } finally {
      await prisma.favorite.deleteMany({ where: { ownerAccountId: parentId, teacherProfileId: profileId } });
      await prisma.teacherProfile.update({ where: { id: profileId }, data: { headline: "公开老师" } });
    }
  });

  it.each(["target", "subject", "region", "target-account", "actor-account"] as const)(
    "does not save a teacher favorite when %s is concurrently deactivated",
    async (kind) => {
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set("options", "-c lock_timeout=2000ms -c statement_timeout=5000ms");
      const limited = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
      const service = createFavoriteService(limited);
      let unlock!: () => void;
      let markLocked!: () => void;
      const release = new Promise<void>((resolve) => { unlock = resolve; });
      const locked = new Promise<void>((resolve) => { markLocked = resolve; });
      const deactivation = prisma.$transaction(async (transaction) => {
        if (kind === "target") await transaction.teacherProfile.update({ where: { id: profileId }, data: { status: "DRAFT", publishedAt: null } });
        if (kind === "subject") await transaction.subject.update({ where: { id: subjectIds[0] }, data: { isActive: false } });
        if (kind === "region") await transaction.region.update({ where: { id: regionIds[0] }, data: { isActive: false } });
        if (kind === "target-account") await transaction.account.update({ where: { id: teacherId }, data: { status: "DISABLED" } });
        if (kind === "actor-account") await transaction.account.update({ where: { id: parentId }, data: { status: "DISABLED" } });
        markLocked();
        await release;
      });
      try {
        await locked;
        const adding = service.add({ id: parentId, role: "parent" }, { targetType: "teacher", targetId: profileId });
        unlock();
        await deactivation;
        await expect(adding).rejects.toMatchObject({ code: kind === "actor-account" ? "UNAUTHORIZED" : "INVALID_TARGET" });
        await expect(prisma.favorite.count({ where: { ownerAccountId: parentId, teacherProfileId: profileId } })).resolves.toBe(0);
      } finally {
        unlock();
        await deactivation.catch(() => undefined);
        await limited.$disconnect();
        if (kind === "target") await prisma.teacherProfile.update({ where: { id: profileId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
        if (kind === "subject") await prisma.subject.update({ where: { id: subjectIds[0] }, data: { isActive: true } });
        if (kind === "region") await prisma.region.update({ where: { id: regionIds[0] }, data: { isActive: true } });
        if (kind === "target-account") await prisma.account.update({ where: { id: teacherId }, data: { status: "ACTIVE" } });
        if (kind === "actor-account") await prisma.account.update({ where: { id: parentId }, data: { status: "ACTIVE" } });
      }
    },
  );

  it("allows only teacher→public request and rejects stale targets", async () => {
    const service = createFavoriteService(prisma);
    await expect(service.add({ id: teacherId, role: "teacher" }, { targetType: "request", targetId: requestId })).resolves.toMatchObject({ targetType: "request" });
    await expect(service.add({ id: parentId, role: "parent" }, { targetType: "request", targetId: requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.tutoringRequest.update({ where: { id: requestId }, data: { status: "DRAFT", publishedAt: null } });
    await expect(service.add({ id: teacherId, role: "teacher" }, { targetType: "request", targetId: requestId })).rejects.toMatchObject({ code: "INVALID_TARGET" });
  });

  it("enforces exactly one favorite target for raw database writes", async () => {
    await expect(prisma.$executeRaw`
      INSERT INTO "Favorite" ("id", "ownerAccountId", "teacherProfileId", "tutoringRequestId")
      VALUES (${crypto.randomUUID()}::uuid, ${parentId}::uuid, ${profileId}::uuid, ${requestId}::uuid)
    `).rejects.toMatchObject({ meta: expect.objectContaining({ driverAdapterError: expect.anything() }) });
    await expect(prisma.$executeRaw`
      INSERT INTO "Favorite" ("id", "ownerAccountId", "teacherProfileId", "tutoringRequestId")
      VALUES (${crypto.randomUUID()}::uuid, ${parentId}::uuid, NULL, NULL)
    `).rejects.toMatchObject({ meta: expect.objectContaining({ driverAdapterError: expect.anything() }) });
    await expect(prisma.favorite.count({ where: { ownerAccountId: parentId, OR: [
      { teacherProfileId: profileId, tutoringRequestId: requestId },
      { teacherProfileId: null, tutoringRequestId: null },
    ] } })).resolves.toBe(0);
  });

  it("filters unvalidated unsafe targets before applying the initial page limit", async () => {
    const staleAccount = await prisma.account.create({ data: {
      role: "TEACHER",
      username: `fav-stale-${marker}`,
      normalizedUsername: `fav-stale-${marker}`,
      email: `fav-stale-${marker}@example.test`,
      normalizedEmail: `fav-stale-${marker}@example.test`,
      passwordHash: "test",
    } });
    accountIds.push(staleAccount.id);
    const staleProfile = await prisma.teacherProfile.create({ data: {
      accountId: staleAccount.id,
      displayName: "已下架老师",
      identityType: "FULL_TIME_TEACHER",
      headline: "Signal: unsafe88",
      bio: "公开教学自述",
      yearsExperience: 3,
      hourlyRate: 80,
      hourlyRateMax: 120,
      status: "PUBLISHED",
      publishedAt: new Date("2026-07-04T00:00:00.000Z"),
      publicContentSafetyVersion: 0,
    } });
    await prisma.teacherSubject.create({ data: { teacherProfileId: staleProfile.id, subjectId: subjectIds[0] } });
    await prisma.teacherServiceArea.create({ data: { teacherProfileId: staleProfile.id, regionId: regionIds[0], isPrimary: true } });
    await prisma.favorite.deleteMany({ where: { ownerAccountId: parentId } });
    await prisma.favorite.createMany({ data: [
      { ownerAccountId: parentId, teacherProfileId: staleProfile.id, createdAt: new Date("2026-07-03T00:00:00.000Z") },
      { ownerAccountId: parentId, teacherProfileId: profileId, createdAt: new Date("2026-07-02T00:00:00.000Z") },
    ] });
    try {
      const page = await createFavoriteService(prisma).list(
        { id: parentId, role: "parent" },
        { pageSize: 1 },
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ targetId: profileId });
      expect(page.nextCursor).toBeNull();
    } finally {
      await prisma.favorite.deleteMany({ where: { ownerAccountId: parentId } });
    }
  });

  it("walks more than 50 favorites with stable keyset cursors while newer rows arrive", async () => {
    const pagingParent = await prisma.account.create({ data: {
      role: "PARENT", username: `fav-paging-${marker}`, normalizedUsername: `fav-paging-${marker}`,
      email: `fav-paging-${marker}@example.test`, normalizedEmail: `fav-paging-${marker}@example.test`, passwordHash: "test",
    } });
    accountIds.push(pagingParent.id);
    const targets = Array.from({ length: 56 }, (_, index) => ({
      accountId: crypto.randomUUID(),
      profileId: crypto.randomUUID(),
      index,
    }));
    accountIds.push(...targets.map(({ accountId }) => accountId));
    await prisma.account.createMany({ data: targets.map(({ accountId, index }) => ({
      id: accountId, role: "TEACHER", username: `fav-page-t-${index}-${marker}`,
      normalizedUsername: `fav-page-t-${index}-${marker}`, email: `fav-page-t-${index}-${marker}@example.test`,
      normalizedEmail: `fav-page-t-${index}-${marker}@example.test`, passwordHash: "test",
    })) });
    await prisma.teacherProfile.createMany({ data: targets.map(({ accountId, profileId, index }) => ({
      id: profileId, accountId, displayName: `分页老师${index}`, identityType: "FULL_TIME_TEACHER",
      headline: [10, 30].includes(index) ? "Signal: unsafe88" : `分页摘要${index}`,
      bio: "分页公开自述", yearsExperience: 2, hourlyRate: 80,
      hourlyRateMax: 100, status: "PUBLISHED", publishedAt: new Date("2026-07-01T00:00:00.000Z"),
      publicContentSafetyVersion: [10, 30].includes(index) ? 0 : 1,
    })) });
    await prisma.teacherSubject.createMany({ data: targets.map(({ profileId }) => ({
      teacherProfileId: profileId, subjectId: subjectIds[0],
    })) });
    await prisma.teacherServiceArea.createMany({ data: targets.map(({ profileId }) => ({
      teacherProfileId: profileId, regionId: regionIds[0], isPrimary: true,
    })) });

    const rows = targets.slice(0, 55).map(({ profileId, index }) => ({
      id: crypto.randomUUID(), ownerAccountId: pagingParent.id, teacherProfileId: profileId,
      createdAt: new Date(`2026-07-${String(1 + Math.floor(index / 5)).padStart(2, "0")}T12:00:00.000Z`),
    }));
    await prisma.favorite.createMany({ data: rows });
    const expected = rows
      .filter((row) => ![targets[10].profileId, targets[30].profileId].includes(row.teacherProfileId))
      .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id))
      .map(({ id }) => id);
    const service = createFavoriteService(prisma);
    const collected: string[] = [];
    const pageLengths: number[] = [];
    let page = await service.list({ id: pagingParent.id, role: "parent" }, { pageSize: 20 });
    pageLengths.push(page.items.length);
    collected.push(...page.items.map(({ id }) => id));
    expect(page.nextCursor).toEqual(expect.any(String));

    const late = await prisma.favorite.create({ data: {
      ownerAccountId: pagingParent.id, teacherProfileId: targets[55].profileId,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    } });
    while (page.nextCursor) {
      page = await service.list(
        { id: pagingParent.id, role: "parent" },
        { pageSize: 20, cursor: page.nextCursor },
      );
      pageLengths.push(page.items.length);
      collected.push(...page.items.map(({ id }) => id));
    }

    expect(pageLengths).toEqual([20, 20, 13]);
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(53);
    expect(collected).not.toContain(late.id);
  });
});

const DAY = 24 * 60 * 60 * 1000;
