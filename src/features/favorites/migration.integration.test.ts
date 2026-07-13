// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, describe, expect, it } from "vitest";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for favorite integration tests");

describe("favorite list database index", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("matches the owner-scoped stable keyset order", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'Favorite'
    `;

    expect(indexes.some(({ indexdef }) =>
      indexdef.includes('("ownerAccountId", "createdAt" DESC, id)')
      || indexdef.includes('("ownerAccountId", "createdAt" DESC, "id")'),
    )).toBe(true);
  });
});
