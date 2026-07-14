// @vitest-environment node

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaAccountDeletionRepository } from "./deletion-prisma";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeDatabase("Prisma account deletion", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const accountId = randomUUID();
  const passwordHash = "synthetic-deletion-hash";

  afterAll(async () => {
    await db.verification.deleteMany({ where: { accountId } });
    await db.teacherProfile.deleteMany({ where: { accountId } });
    await db.session.deleteMany({ where: { accountId } });
    await db.account.deleteMany({ where: { id: accountId } });
    await db.$disconnect();
  });

  it("revokes sessions, hides profile, clears evidence and pseudonymizes the retained account", async () => {
    const account = await db.account.create({ data: {
      id: accountId, role: "TEACHER", username: `delete-${accountId}`, normalizedUsername: `delete-${accountId}`,
      email: `${accountId}@example.test`, normalizedEmail: `${accountId}@example.test`, passwordHash,
    } });
    const profile = await db.teacherProfile.create({ data: { accountId, displayName: "合成老师", headline: "应被清除", bio: "应被清除", status: "PUBLISHED", publishedAt: new Date(), publicContentSafetyVersion: 1 } });
    await db.session.create({ data: { accountId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    await db.verification.create({ data: { accountId, teacherProfileId: profile.id, type: "EDUCATION", evidence: { provider: "local-private", key: `${"a".repeat(64)}.jpg`, mimeType: "image/jpeg", byteSize: 10, sha256: "b".repeat(64) } } });

    const result = await new PrismaAccountDeletionRepository(db).anonymize({
      accountId, expectedPasswordHash: account.passwordHash, at: new Date("2026-07-14T00:00:00.000Z"),
      username: "已注销用户", normalizedUsername: `deleted:${accountId}`,
      email: `deleted-${accountId}@invalid.local`, normalizedEmail: `deleted-${accountId}@invalid.local`, passwordHash: "unusable-hash",
    });
    expect(result.evidenceKeys).toEqual([`${"a".repeat(64)}.jpg`]);
    await expect(db.account.findUniqueOrThrow({ where: { id: accountId }, select: { status: true, username: true, email: true } })).resolves.toEqual({ status: "DISABLED", username: "已注销用户", email: `deleted-${accountId}@invalid.local` });
    await expect(db.session.findFirstOrThrow({ where: { accountId }, select: { revokedAt: true } })).resolves.toEqual({ revokedAt: new Date("2026-07-14T00:00:00.000Z") });
    await expect(db.teacherProfile.findUniqueOrThrow({ where: { accountId }, select: { status: true, headline: true, bio: true } })).resolves.toEqual({ status: "DRAFT", headline: null, bio: null });
    const verification = await db.verification.findFirstOrThrow({ where: { accountId }, select: { status: true, evidence: true } });
    expect(verification.status).toBe("EXPIRED");
    expect(verification.evidence).toBeNull();
  });
});
