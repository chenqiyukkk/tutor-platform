import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { privateEvidenceSchema } from "@/features/verifications/schema";

import { AccountDeletionError, type AccountDeletionRepository, type AnonymizeAccountInput, type DeletionAccount } from "./deletion";

const role = { TEACHER: "teacher", PARENT: "parent", ADMIN: "admin" } as const;
const status = { ACTIVE: "active", SUSPENDED: "suspended", DISABLED: "disabled" } as const;

export class PrismaAccountDeletionRepository implements AccountDeletionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadForDeletion(accountId: string): Promise<DeletionAccount | null> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { id: true, role: true, status: true, passwordHash: true } });
    return account ? { ...account, role: role[account.role], status: status[account.status] } : null;
  }

  async anonymize(input: AnonymizeAccountInput) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${input.accountId}::uuid FOR UPDATE`;
      const account = await transaction.account.findUnique({ where: { id: input.accountId }, select: { role: true, status: true, passwordHash: true } });
      if (!account || account.role === "ADMIN" || account.status === "DISABLED" || account.passwordHash !== input.expectedPasswordHash) {
        throw new AccountDeletionError("CONFLICT", "账号状态已经发生变化");
      }
      const verifications = await transaction.verification.findMany({ where: { accountId: input.accountId }, select: { evidence: true } });
      const evidenceKeys = verifications.flatMap(({ evidence }) => {
        const parsed = privateEvidenceSchema.safeParse(evidence);
        return parsed.success ? [parsed.data.key] : [];
      });

      await transaction.session.updateMany({ where: { accountId: input.accountId, revokedAt: null }, data: { revokedAt: input.at } });
      await transaction.passwordResetToken.deleteMany({ where: { accountId: input.accountId } });
      await transaction.favorite.deleteMany({ where: { ownerAccountId: input.accountId } });
      await transaction.block.deleteMany({ where: { OR: [{ blockerAccountId: input.accountId }, { blockedAccountId: input.accountId }] } });
      await transaction.greetingAttempt.deleteMany({ where: { senderAccountId: input.accountId } });
      await transaction.greeting.updateMany({
        where: { OR: [{ senderAccountId: input.accountId }, { recipientAccountId: input.accountId }] },
        data: { message: null, cardSnapshot: { kind: "redacted", notice: "一方账号已注销" } },
      });
      await transaction.message.updateMany({
        where: { senderAccountId: input.accountId },
        data: { body: "账号已注销，原消息已移除", deletedAt: input.at, updatedAt: input.at },
      });
      await transaction.report.updateMany({
        where: { OR: [{ reporterAccountId: input.accountId }, { reportedAccountId: input.accountId }] },
        data: { details: null, targetSnapshot: Prisma.DbNull },
      });
      await transaction.verification.updateMany({
        where: { accountId: input.accountId },
        data: { evidence: Prisma.DbNull, status: "EXPIRED", expiresAt: input.at, reviewNote: null },
      });

      const teacherProfile = await transaction.teacherProfile.findUnique({ where: { accountId: input.accountId }, select: { id: true } });
      if (teacherProfile) {
        await transaction.teacherSubject.deleteMany({ where: { teacherProfileId: teacherProfile.id } });
        await transaction.teacherServiceArea.deleteMany({ where: { teacherProfileId: teacherProfile.id } });
        await transaction.favorite.deleteMany({ where: { teacherProfileId: teacherProfile.id } });
        await transaction.teacherProfile.update({ where: { id: teacherProfile.id }, data: {
          displayName: "已注销老师", identityType: null, headline: null, bio: null, avatarUrl: null,
          yearsExperience: null, hourlyRate: null, hourlyRateMax: null, isOnline: false, status: "DRAFT",
          publishedAt: null, publicContentSafetyVersion: 0, moderationRejectedAt: null, moderationReason: null,
        } });
      }

      const parentProfile = await transaction.parentProfile.findUnique({ where: { accountId: input.accountId }, select: { id: true } });
      if (parentProfile) {
        await transaction.studentProfile.updateMany({ where: { parentProfileId: parentProfile.id }, data: { displayName: "已注销学生", gradeLevel: null, notes: null, isActive: false } });
        await transaction.favorite.deleteMany({ where: { tutoringRequest: { parentProfileId: parentProfile.id } } });
        await transaction.tutoringRequest.updateMany({ where: { parentProfileId: parentProfile.id }, data: {
          title: "已注销需求", description: "账号已注销", scheduleText: null, budgetMin: null, budgetMax: null,
          teachingMode: null, publicLocationNote: null, status: "DRAFT", publishedAt: null, closedAt: null,
          expiresAt: null, publicContentSafetyVersion: 0, moderationRejectedAt: null, moderationReason: null,
        } });
        await transaction.parentProfile.update({ where: { id: parentProfile.id }, data: { displayName: "已注销家长", avatarUrl: null, status: "DRAFT" } });
      }

      await transaction.account.update({ where: { id: input.accountId }, data: {
        status: "DISABLED", username: input.username, normalizedUsername: input.normalizedUsername,
        email: input.email, normalizedEmail: input.normalizedEmail, passwordHash: input.passwordHash, lastLoginAt: null,
      } });
      return { evidenceKeys };
    }, { isolationLevel: "Serializable" });
  }
}
