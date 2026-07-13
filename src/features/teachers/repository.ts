import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  TeacherProfileError,
  validatePublishable,
  type SavedTeacherProfile,
  type TeacherProfile,
  type TeacherProfileRepository,
} from "./service";

const profileInclude = {
  subjects: { include: { subject: true } },
  serviceAreas: { include: { region: true } },
} satisfies Prisma.TeacherProfileInclude;

type ProfileRow = Prisma.TeacherProfileGetPayload<{ include: typeof profileInclude }>;

function toCents(value: Prisma.Decimal | null) {
  return value === null ? null : Math.round(value.toNumber() * 100);
}

function fromCents(value: number | null) {
  return value === null ? null : new Prisma.Decimal(value).dividedBy(100);
}

function toProfile(row: ProfileRow): TeacherProfile {
  const areas = row.serviceAreas
    .map(({ isPrimary, region }) => ({ id: region.id, name: region.name, isPrimary }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  return {
    id: row.id,
    accountId: row.accountId,
    publicNickname: row.displayName,
    identityType: row.identityType,
    bio: row.bio,
    yearsExperience: row.yearsExperience,
    online: row.isOnline,
    rateMinCents: toCents(row.hourlyRate),
    rateMaxCents: toCents(row.hourlyRateMax),
    status: row.status,
    publishedAt: row.publishedAt,
    subjects: row.subjects
      .map(({ subject }) => ({ id: subject.id, name: subject.name }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    primaryRegion: areas.find(({ isPrimary }) => isPrimary) ?? null,
    extraRegions: areas
      .filter(({ isPrimary }) => !isPrimary)
      .map(({ id, name }) => ({ id, name })),
  };
}

async function findOwned(prisma: Prisma.TransactionClient | PrismaClient, accountId: string) {
  return prisma.teacherProfile.findUnique({ where: { accountId }, include: profileInclude });
}

export class PrismaTeacherProfileRepository implements TeacherProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOwned(accountId: string) {
    const row = await findOwned(this.prisma, accountId);
    return row ? toProfile(row) : null;
  }

  async saveOwned(accountId: string, input: SavedTeacherProfile) {
    return this.prisma.$transaction(async (transaction) => {
      const account = await transaction.account.findUnique({
        where: { id: accountId },
        select: { role: true },
      });
      if (!account || account.role !== "TEACHER") {
        throw new TeacherProfileError("FORBIDDEN", "仅教师账号可管理教师资料");
      }

      const subjects = await transaction.subject.findMany({
        where: { id: { in: input.subjectIds }, isActive: true },
        select: { id: true },
      });
      if (subjects.length !== input.subjectIds.length) {
        throw new TeacherProfileError("INVALID_SUBJECT", "授课科目无效或已停用", {
          subjectIds: ["请选择有效且启用的授课科目"],
        });
      }

      const regionIds = [
        ...(input.primaryRegionId ? [input.primaryRegionId] : []),
        ...input.extraRegionIds,
      ];
      if (
        input.extraRegionIds.length > 4 ||
        new Set(regionIds).size !== regionIds.length
      ) {
        throw new TeacherProfileError("INVALID_REGION", "授课地区选择无效", {
          extraRegionIds: ["主地区与额外地区不能重复，额外地区最多 4 个"],
        });
      }
      const regions = await transaction.region.findMany({
        where: { id: { in: regionIds }, isActive: true, level: 3 },
        select: { id: true },
      });
      if (regions.length !== regionIds.length) {
        throw new TeacherProfileError("INVALID_REGION", "授课地区无效或已停用", {
          primaryRegionId: ["请选择有效且启用的区县"],
        });
      }

      const profile = await transaction.teacherProfile.upsert({
        where: { accountId },
        create: {
          accountId,
          displayName: input.publicNickname,
          identityType: input.identityType,
          bio: input.bio,
          yearsExperience: input.yearsExperience,
          isOnline: input.online,
          hourlyRate: fromCents(input.rateMinCents),
          hourlyRateMax: fromCents(input.rateMaxCents),
        },
        update: {
          displayName: input.publicNickname,
          identityType: input.identityType,
          bio: input.bio,
          yearsExperience: input.yearsExperience,
          isOnline: input.online,
          hourlyRate: fromCents(input.rateMinCents),
          hourlyRateMax: fromCents(input.rateMaxCents),
          status: "DRAFT",
          publishedAt: null,
        },
        select: { id: true },
      });

      await transaction.teacherSubject.deleteMany({ where: { teacherProfileId: profile.id } });
      if (input.subjectIds.length) {
        await transaction.teacherSubject.createMany({
          data: input.subjectIds.map((subjectId) => ({ teacherProfileId: profile.id, subjectId })),
        });
      }
      await transaction.teacherServiceArea.deleteMany({ where: { teacherProfileId: profile.id } });
      if (regionIds.length) {
        await transaction.teacherServiceArea.createMany({ data: regionIds.map((regionId) => ({
          teacherProfileId: profile.id,
          regionId,
          isPrimary: regionId === input.primaryRegionId,
        })) });
      }

      const saved = await findOwned(transaction, accountId);
      if (!saved) throw new TeacherProfileError("NOT_FOUND", "教师资料不存在");
      return toProfile(saved);
    });
  }

  async setPublished(accountId: string, published: boolean) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "TeacherProfile"
        WHERE "accountId" = ${accountId}::uuid
        FOR UPDATE
      `;
      let current = await findOwned(transaction, accountId);
      if (!current) throw new TeacherProfileError("NOT_FOUND", "教师资料不存在");
      if (published) {
        const subjectIds = current.subjects.map(({ subjectId }) => subjectId).sort();
        const regionIds = current.serviceAreas.map(({ regionId }) => regionId).sort();
        // Task 12 must lock Subject IDs, then Region IDs in this same sorted order and
        // atomically unpublish affected profiles before an administrator deactivates rows.
        // These locks close only the publish validation/commit window; they do not create
        // a permanent invariant after this transaction commits.
        if (subjectIds.length) {
          await transaction.$queryRaw`
            SELECT "id" FROM "Subject"
            WHERE "id" IN (${Prisma.join(subjectIds)})
            ORDER BY "id" FOR SHARE
          `;
        }
        if (regionIds.length) {
          await transaction.$queryRaw`
            SELECT "id" FROM "Region"
            WHERE "id" IN (${Prisma.join(regionIds)})
            ORDER BY "id" FOR SHARE
          `;
        }
        current = await findOwned(transaction, accountId);
        if (!current) throw new TeacherProfileError("NOT_FOUND", "教师资料不存在");
        const fieldErrors = validatePublishable(toProfile(current));
        if (Object.keys(fieldErrors).length) {
          throw new TeacherProfileError(
            "INCOMPLETE_PROFILE",
            "请先完善教师资料再发布",
            fieldErrors,
          );
        }
        if (!current.subjects.length || current.subjects.some(({ subject }) => !subject.isActive)) {
          throw new TeacherProfileError("INVALID_SUBJECT", "授课科目无效或已停用", {
            subjectIds: ["请选择有效且启用的授课科目"],
          });
        }
        const primaryAreas = current.serviceAreas.filter(({ isPrimary }) => isPrimary);
        if (
          primaryAreas.length !== 1 ||
          current.serviceAreas.some(({ region }) => !region.isActive || region.level !== 3)
        ) {
          throw new TeacherProfileError("INVALID_REGION", "授课地区无效或已停用", {
            primaryRegionId: ["请选择有效且启用的区县"],
          });
        }
      }
      const result = await transaction.teacherProfile.updateMany({
        where: { accountId },
        data: {
          status: published ? "PUBLISHED" : "DRAFT",
          publishedAt: published ? new Date() : null,
        },
      });
      if (!result.count) throw new TeacherProfileError("NOT_FOUND", "教师资料不存在");
      const row = await findOwned(transaction, accountId);
      if (!row) throw new TeacherProfileError("NOT_FOUND", "教师资料不存在");
      return toProfile(row);
    });
  }
}
