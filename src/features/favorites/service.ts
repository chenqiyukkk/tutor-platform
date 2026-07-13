import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import type { AuthenticatedAccount } from "@/features/auth/service";

import { decodeFavoriteCursor, encodeFavoriteCursor, favoriteListQuerySchema } from "./schema";

type Actor = Pick<AuthenticatedAccount, "id" | "role">;
type Db = PrismaClient | Prisma.TransactionClient;
type FavoriteListItem = {
  id: string;
  targetType: "teacher" | "request";
  targetId: string;
  label: string;
  summary: string | null;
  createdAt: string;
};

export const favoriteTargetSchema = z.object({
  targetType: z.enum(["teacher", "request"]),
  targetId: z.string().uuid(),
}).strict();

export class FavoriteWorkflowError extends Error {
  constructor(readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_TARGET", message: string) {
    super(message);
    this.name = "FavoriteWorkflowError";
  }
}

const teacherPublicWhere = {
  status: "PUBLISHED" as const,
  publishedAt: { not: null },
  displayName: { not: "" },
  identityType: { not: null },
  bio: { not: null },
  yearsExperience: { not: null },
  hourlyRate: { not: null },
  hourlyRateMax: { not: null },
  account: { role: "TEACHER" as const, status: "ACTIVE" as const },
  subjects: { some: {}, every: { subject: { isActive: true } } },
  serviceAreas: { some: { isPrimary: true }, every: { region: { isActive: true, level: 3 } } },
};

function requestPublicWhere(now: Date) {
  return {
    status: "PUBLISHED" as const,
    publishedAt: { not: null },
    title: { not: "" },
    description: { not: "" },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    parentProfile: { account: { role: "PARENT" as const, status: "ACTIVE" as const } },
    studentProfile: { is: { isActive: true } },
    region: { is: { isActive: true, level: 3 } },
    subjects: { some: {}, every: { subject: { isActive: true } } },
  };
}

export function createFavoriteService(prisma: PrismaClient, now: () => Date = () => new Date()) {
  async function assertActor(actor: Actor, client: Db = prisma) {
    if (actor.role !== "parent" && actor.role !== "teacher") throw new FavoriteWorkflowError("FORBIDDEN", "仅家长或老师可以收藏");
    const role = actor.role === "parent" ? "PARENT" : "TEACHER";
    const account = await client.account.findFirst({ where: { id: actor.id, role, status: "ACTIVE" }, select: { id: true } });
    if (!account) throw new FavoriteWorkflowError("UNAUTHORIZED", "登录状态无效");
  }

  async function assertTarget(actor: Actor, target: z.infer<typeof favoriteTargetSchema>, client: Db = prisma) {
    if ((actor.role === "parent" && target.targetType !== "teacher") || (actor.role === "teacher" && target.targetType !== "request")) {
      throw new FavoriteWorkflowError("FORBIDDEN", "当前角色不能收藏这个目标");
    }
    if (target.targetType === "teacher") {
      const profile = await client.teacherProfile.findFirst({ where: { AND: [{ id: target.targetId }, teacherPublicWhere] }, select: { id: true, accountId: true } });
      if (!profile || profile.accountId === actor.id) throw new FavoriteWorkflowError("INVALID_TARGET", "老师资料当前不可收藏");
      return;
    }
    const request = await client.tutoringRequest.findFirst({ where: { AND: [{ id: target.targetId }, requestPublicWhere(now())] }, select: { id: true, parentProfileId: true } });
    if (!request) throw new FavoriteWorkflowError("INVALID_TARGET", "家教需求当前不可收藏");
    const parent = await client.parentProfile.findUnique({ where: { id: request.parentProfileId }, select: { accountId: true } });
    if (!parent || parent.accountId === actor.id) throw new FavoriteWorkflowError("INVALID_TARGET", "家教需求当前不可收藏");
  }

  function assertTargetRole(actor: Actor, targetType: "teacher" | "request") {
    if ((actor.role === "parent" && targetType !== "teacher") || (actor.role === "teacher" && targetType !== "request")) {
      throw new FavoriteWorkflowError("FORBIDDEN", "当前角色不能操作这个收藏目标");
    }
  }

  async function lockTargetContext(
    transaction: Prisma.TransactionClient,
    actor: Actor,
    target: z.infer<typeof favoriteTargetSchema>,
  ) {
    // Degenerate forms of the Task 12 global order. Teacher favorites use
    // Profile -> Subjects -> Regions -> Accounts; request favorites use
    // Request -> Subjects -> Region -> Student -> Parent -> Accounts.
    if (target.targetType === "teacher") {
      await transaction.$queryRaw`SELECT "id" FROM "TeacherProfile" WHERE "id" = ${target.targetId}::uuid FOR SHARE`;
      const profile = await transaction.teacherProfile.findUnique({ where: { id: target.targetId }, select: { accountId: true } });
      if (!profile) throw new FavoriteWorkflowError("INVALID_TARGET", "老师资料当前不可收藏");
      const subjectIds = (await transaction.teacherSubject.findMany({ where: { teacherProfileId: target.targetId }, select: { subjectId: true }, orderBy: { subjectId: "asc" } })).map(({ subjectId }) => subjectId);
      if (subjectIds.length) await transaction.$queryRaw`SELECT "id" FROM "Subject" WHERE "id" IN (${Prisma.join(subjectIds)}) ORDER BY "id" FOR SHARE`;
      const regionIds = (await transaction.teacherServiceArea.findMany({ where: { teacherProfileId: target.targetId }, select: { regionId: true }, orderBy: { regionId: "asc" } })).map(({ regionId }) => regionId);
      if (regionIds.length) await transaction.$queryRaw`SELECT "id" FROM "Region" WHERE "id" IN (${Prisma.join(regionIds)}) ORDER BY "id" FOR SHARE`;
      const accountIds = [...new Set([actor.id, profile.accountId])].sort();
      await transaction.$queryRaw`SELECT "id" FROM "Account" WHERE "id" IN (${Prisma.join(accountIds)}) ORDER BY "id" FOR SHARE`;
      return;
    }

    await transaction.$queryRaw`SELECT "id" FROM "TutoringRequest" WHERE "id" = ${target.targetId}::uuid FOR SHARE`;
    const request = await transaction.tutoringRequest.findUnique({ where: { id: target.targetId }, select: { parentProfileId: true, studentProfileId: true, regionId: true } });
    if (!request) throw new FavoriteWorkflowError("INVALID_TARGET", "家教需求当前不可收藏");
    const subjectIds = (await transaction.requestSubject.findMany({ where: { tutoringRequestId: target.targetId }, select: { subjectId: true }, orderBy: { subjectId: "asc" } })).map(({ subjectId }) => subjectId);
    if (subjectIds.length) await transaction.$queryRaw`SELECT "id" FROM "Subject" WHERE "id" IN (${Prisma.join(subjectIds)}) ORDER BY "id" FOR SHARE`;
    if (request.regionId) await transaction.$queryRaw`SELECT "id" FROM "Region" WHERE "id" = ${request.regionId}::uuid FOR SHARE`;
    if (request.studentProfileId) await transaction.$queryRaw`SELECT "id" FROM "StudentProfile" WHERE "id" = ${request.studentProfileId}::uuid FOR SHARE`;
    await transaction.$queryRaw`SELECT "id" FROM "ParentProfile" WHERE "id" = ${request.parentProfileId}::uuid FOR SHARE`;
    const parent = await transaction.parentProfile.findUnique({ where: { id: request.parentProfileId }, select: { accountId: true } });
    if (!parent) throw new FavoriteWorkflowError("INVALID_TARGET", "家教需求当前不可收藏");
    const accountIds = [...new Set([actor.id, parent.accountId])].sort();
    await transaction.$queryRaw`SELECT "id" FROM "Account" WHERE "id" IN (${Prisma.join(accountIds)}) ORDER BY "id" FOR SHARE`;
  }

  return {
    async has(actor: Actor, rawTarget: unknown) {
      const target = favoriteTargetSchema.parse(rawTarget);
      await assertActor(actor);
      assertTargetRole(actor, target.targetType);
      return (await prisma.favorite.count({ where: {
        ownerAccountId: actor.id,
        ...(target.targetType === "teacher" ? { teacherProfileId: target.targetId } : { tutoringRequestId: target.targetId }),
      } })) > 0;
    },

    async add(actor: Actor, rawTarget: unknown) {
      const target = favoriteTargetSchema.parse(rawTarget);
      await assertActor(actor);
      return prisma.$transaction(async (transaction) => {
        await lockTargetContext(transaction, actor, target);
        await assertActor(actor, transaction);
        await assertTarget(actor, target, transaction);
        const row = target.targetType === "teacher"
        ? await transaction.favorite.upsert({
            where: { ownerAccountId_teacherProfileId: { ownerAccountId: actor.id, teacherProfileId: target.targetId } },
            update: {}, create: { ownerAccountId: actor.id, teacherProfileId: target.targetId },
          })
        : await transaction.favorite.upsert({
            where: { ownerAccountId_tutoringRequestId: { ownerAccountId: actor.id, tutoringRequestId: target.targetId } },
            update: {}, create: { ownerAccountId: actor.id, tutoringRequestId: target.targetId },
          });
        return { id: row.id, targetType: target.targetType, targetId: target.targetId, createdAt: row.createdAt.toISOString() };
      }, { isolationLevel: "ReadCommitted" });
    },

    async remove(actor: Actor, rawTarget: unknown) {
      const target = favoriteTargetSchema.parse(rawTarget);
      await assertActor(actor);
      assertTargetRole(actor, target.targetType);
      await prisma.favorite.deleteMany({ where: {
        ownerAccountId: actor.id,
        ...(target.targetType === "teacher" ? { teacherProfileId: target.targetId } : { tutoringRequestId: target.targetId }),
      } });
    },

    async list(actor: Actor, rawQuery: unknown = {}) {
      await assertActor(actor);
      const query = favoriteListQuerySchema.parse(rawQuery);
      const cursor = query.cursor ? decodeFavoriteCursor(query.cursor) : null;
      const where: Prisma.FavoriteWhereInput = {
        ownerAccountId: actor.id,
        ...(actor.role === "parent"
          ? { teacherProfileId: { not: null } }
          : { tutoringRequestId: { not: null } }),
        ...(cursor ? { OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ] } : {}),
      };
      const rows = await prisma.favorite.findMany({
        where,
        select: { id: true, teacherProfileId: true, tutoringRequestId: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: query.pageSize + 1,
      });
      const hasMore = rows.length > query.pageSize;
      const pageRows = hasMore ? rows.slice(0, query.pageSize) : rows;
      const boundary = hasMore ? pageRows.at(-1) : undefined;

      let items: FavoriteListItem[];
      if (actor.role === "parent") {
        const targetIds = pageRows.flatMap(({ teacherProfileId }) => teacherProfileId ? [teacherProfileId] : []);
        const targets = await prisma.teacherProfile.findMany({
          where: { AND: [{ id: { in: targetIds } }, teacherPublicWhere] },
          select: { id: true, displayName: true, headline: true },
        });
        const byId = new Map(targets.map((target) => [target.id, target]));
        items = pageRows.flatMap((favorite) => {
          const target = favorite.teacherProfileId ? byId.get(favorite.teacherProfileId) : undefined;
          return target ? [{
            id: favorite.id,
            targetType: "teacher",
            targetId: target.id,
            label: target.displayName,
            summary: target.headline,
            createdAt: favorite.createdAt.toISOString(),
          }] : [];
        });
      } else {
        const targetIds = pageRows.flatMap(({ tutoringRequestId }) => tutoringRequestId ? [tutoringRequestId] : []);
        const targets = await prisma.tutoringRequest.findMany({
          where: { AND: [{ id: { in: targetIds } }, requestPublicWhere(now())] },
          select: { id: true, title: true },
        });
        const byId = new Map(targets.map((target) => [target.id, target]));
        items = pageRows.flatMap((favorite) => {
          const target = favorite.tutoringRequestId ? byId.get(favorite.tutoringRequestId) : undefined;
          return target ? [{
            id: favorite.id,
            targetType: "request",
            targetId: target.id,
            label: target.title,
            summary: null,
            createdAt: favorite.createdAt.toISOString(),
          }] : [];
        });
      }

      return {
        items,
        pageSize: query.pageSize,
        nextCursor: boundary ? encodeFavoriteCursor({ createdAt: boundary.createdAt, id: boundary.id }) : null,
      };
    },
  };
}

export type FavoriteService = ReturnType<typeof createFavoriteService>;
