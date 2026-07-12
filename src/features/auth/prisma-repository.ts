import type { Account, PrismaClient } from "@prisma/client";

import type { AuthRole } from "./schemas";
import {
  DuplicateAccountError,
  type AccountRecord,
  type AuthRepository,
  type NewAccount,
  type NewSession,
  type SessionRecord,
} from "./service";

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

function toAccountRecord(account: Account): AccountRecord {
  return {
    id: account.id,
    role: domainRole[account.role],
    status: domainStatus[account.status],
    username: account.username,
    normalizedUsername: account.normalizedUsername,
    email: account.email,
    normalizedEmail: account.normalizedEmail,
    passwordHash: account.passwordHash,
  };
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAccountByUsername(role: AuthRole, normalizedUsername: string) {
    const account = await this.prisma.account.findUnique({
      where: {
        role_normalizedUsername: { role: prismaRole[role], normalizedUsername },
      },
    });
    return account ? toAccountRecord(account) : null;
  }

  async findAccountByEmail(role: AuthRole, normalizedEmail: string) {
    const account = await this.prisma.account.findUnique({
      where: {
        role_normalizedEmail: { role: prismaRole[role], normalizedEmail },
      },
    });
    return account ? toAccountRecord(account) : null;
  }

  async createAccount(input: NewAccount) {
    try {
      const account = await this.prisma.account.create({
        data: {
          ...input,
          role: prismaRole[input.role],
        },
      });
      return toAccountRecord(account);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DuplicateAccountError();
      }
      throw error;
    }
  }

  async updateLastLogin(accountId: string, at: Date) {
    await this.prisma.account.update({
      where: { id: accountId },
      data: { lastLoginAt: at },
    });
  }

  async createSession(input: NewSession): Promise<SessionRecord> {
    const session = await this.prisma.session.create({
      data: input,
      include: { account: true },
    });
    return {
      id: session.id,
      accountId: session.accountId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      account: toAccountRecord(session.account),
    };
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { account: true },
    });
    return session
      ? {
          id: session.id,
          accountId: session.accountId,
          tokenHash: session.tokenHash,
          expiresAt: session.expiresAt,
          revokedAt: session.revokedAt,
          account: toAccountRecord(session.account),
        }
      : null;
  }

  async revokeSession(tokenHash: string, role: AuthRole) {
    await this.prisma.session.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        account: { role: prismaRole[role] },
      },
      data: { revokedAt: new Date() },
    });
  }
}
