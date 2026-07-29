// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaAuthRepository } from "./prisma-repository";
import { DuplicateAccountError } from "./service";
import { digestSessionToken } from "./session";

if (!process.env.DATABASE_URL && existsSync(".env")) {
  loadEnvFile(".env");
}

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Prisma auth repository", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaAuthRepository(prisma);
  const marker = `auth-smoke-${crypto.randomUUID()}`;
  const normalizedUsername = marker.toLowerCase();
  const normalizedEmail = `${marker}@example.test`;
  const accountIds: string[] = [];

  afterAll(async () => {
    if (accountIds.length) {
      await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    }
    await prisma.$disconnect();
  });

  it("enforces role-scoped uniqueness and stores only the session digest", async () => {
    const base = {
      username: marker,
      normalizedUsername,
      passwordHash: "$argon2id$not-a-real-test-hash",
    };
    const teacher = await repository.createAccount({
      ...base,
      role: "teacher",
      email: normalizedEmail,
      normalizedEmail,
    });
    accountIds.push(teacher.id);

    const parent = await repository.createAccount({
      ...base,
      role: "parent",
      email: `parent-${normalizedEmail}`,
      normalizedEmail: `parent-${normalizedEmail}`,
    });
    accountIds.push(parent.id);

    await expect(repository.createAccount({
      ...base,
      role: "teacher",
      email: `duplicate-${normalizedEmail}`,
      normalizedEmail: `duplicate-${normalizedEmail}`,
    })).rejects.toBeInstanceOf(DuplicateAccountError);

    const rawToken = `raw-${crypto.randomUUID()}`;
    const tokenHash = digestSessionToken(
      rawToken,
      "integration-session-secret-longer-than-32-characters",
    );
    await repository.createSession({
      accountId: teacher.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const stored = await prisma.session.findFirstOrThrow({
      where: { accountId: teacher.id },
      select: { tokenHash: true },
    });
    expect(stored.tokenHash).toBe(tokenHash);
    expect(stored.tokenHash).not.toContain(rawToken);
  });
});
