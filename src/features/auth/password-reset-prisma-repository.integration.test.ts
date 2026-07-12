// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";
import { digestPasswordResetToken } from "./password-reset";
import { PrismaPasswordResetRepository } from "./password-reset-prisma-repository";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for password reset integration tests");

describe("Prisma password reset repository", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaPasswordResetRepository(prisma);
  const accountIds: string[] = [];
  const now = new Date("2030-01-01T00:00:00.000Z");
  const secret = "integration-reset-secret-with-at-least-32-characters";

  afterAll(async () => {
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it("rejects inactive tokens, then atomically resets once and revokes every session", async () => {
    const marker = `reset-${crypto.randomUUID()}`;
    const oldPassword = "old integration password";
    const account = await prisma.account.create({
      data: {
        role: "TEACHER",
        username: marker,
        normalizedUsername: marker,
        email: `${marker}@example.test`,
        normalizedEmail: `${marker}@example.test`,
        passwordHash: await hashPassword(oldPassword),
      },
    });
    accountIds.push(account.id);
    await prisma.session.createMany({
      data: ["one", "two"].map((suffix) => ({
        accountId: account.id,
        tokenHash: `${marker}-${suffix}`,
        expiresAt: new Date(now.getTime() + 60_000),
      })),
    });
    const rawToken = `raw-${crypto.randomUUID()}`;
    const tokenHash = digestPasswordResetToken(rawToken, secret);
    await repository.preparePasswordResetToken({
      accountId: account.id,
      tokenHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60_000),
    });
    const nextHash = await hashPassword("new integration password");

    await expect(repository.resetPasswordWithToken({
      role: "teacher",
      tokenHash,
      passwordHash: nextHash,
      usedAt: now,
    })).resolves.toBe(false);
    await expect(repository.activatePasswordResetToken(tokenHash, now)).resolves.toBe(true);

    const results = await Promise.all([
      repository.resetPasswordWithToken({
        role: "teacher",
        tokenHash,
        passwordHash: nextHash,
        usedAt: now,
      }),
      repository.resetPasswordWithToken({
        role: "teacher",
        tokenHash,
        passwordHash: await hashPassword("racing integration password"),
        usedAt: now,
      }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const storedAccount = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(storedAccount.passwordHash).toMatch(/^\$argon2id\$/);
    expect(
      await Promise.all([
        verifyPassword(storedAccount.passwordHash, "new integration password"),
        verifyPassword(storedAccount.passwordHash, "racing integration password"),
      ]),
    ).toContain(true);
    const storedToken = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash },
    });
    expect(storedToken.usedAt).toEqual(now);
    expect(storedToken.tokenHash).not.toContain(rawToken);
    expect(await prisma.session.count({
      where: { accountId: account.id, revokedAt: null },
    })).toBe(0);
    await expect(repository.resetPasswordWithToken({
      role: "teacher",
      tokenHash,
      passwordHash: await hashPassword("third integration password"),
      usedAt: now,
    })).resolves.toBe(false);
  });
});
