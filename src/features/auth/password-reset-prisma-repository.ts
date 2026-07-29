import type { Account, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { AuthRole } from "./schemas";
import type {
  PasswordResetAccount,
  PasswordResetRepository,
} from "./password-reset";

const prismaRole: Record<AuthRole, "TEACHER" | "PARENT" | "ADMIN"> = {
  teacher: "TEACHER",
  parent: "PARENT",
  admin: "ADMIN",
};

const domainRole = {
  TEACHER: "teacher",
  PARENT: "parent",
  ADMIN: "admin",
} as const;

const domainStatus = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DISABLED: "disabled",
} as const;

function toPasswordResetAccount(account: Account): PasswordResetAccount {
  return {
    id: account.id,
    role: domainRole[account.role],
    status: domainStatus[account.status],
    email: account.email,
    normalizedEmail: account.normalizedEmail,
    passwordHash: account.passwordHash,
  };
}

export class PrismaPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAccountByEmail(role: AuthRole, normalizedEmail: string) {
    const account = await this.prisma.account.findUnique({
      where: {
        role_normalizedEmail: { role: prismaRole[role], normalizedEmail },
      },
    });
    return account ? toPasswordResetAccount(account) : null;
  }

  async preparePasswordResetToken(input: {
    accountId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = CAST(${input.accountId} AS UUID) FOR UPDATE`,
      );
      await transaction.passwordResetToken.updateMany({
        where: { accountId: input.accountId, usedAt: null },
        data: { usedAt: input.createdAt },
      });
      await transaction.passwordResetToken.create({
        data: {
          accountId: input.accountId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          activatedAt: null,
          createdAt: input.createdAt,
        },
      });
    });
  }

  async activatePasswordResetToken(tokenHash: string, activatedAt: Date) {
    const result = await this.prisma.passwordResetToken.updateMany({
      where: {
        tokenHash,
        usedAt: null,
        activatedAt: null,
        expiresAt: { gt: activatedAt },
      },
      data: { activatedAt },
    });
    return result.count === 1;
  }

  async invalidatePasswordResetToken(tokenHash: string, usedAt: Date) {
    await this.prisma.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt },
    });
  }

  async resetPasswordWithToken(input: {
    role: AuthRole;
    tokenHash: string;
    passwordHash: string;
    usedAt: Date;
  }) {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.passwordResetToken.updateMany({
        where: {
          tokenHash: input.tokenHash,
          activatedAt: { not: null },
          usedAt: null,
          expiresAt: { gt: input.usedAt },
          account: {
            role: prismaRole[input.role],
            status: "ACTIVE",
          },
        },
        data: { usedAt: input.usedAt },
      });
      if (claimed.count !== 1) return false;

      const token = await transaction.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash: input.tokenHash },
        select: { accountId: true },
      });
      await transaction.account.update({
        where: { id: token.accountId },
        data: { passwordHash: input.passwordHash },
      });
      await transaction.session.updateMany({
        where: { accountId: token.accountId, revokedAt: null },
        data: { revokedAt: input.usedAt },
      });
      return true;
    });
  }
}
