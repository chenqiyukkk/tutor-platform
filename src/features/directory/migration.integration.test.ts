// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, describe, expect, it } from "vitest";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for directory integration tests");

describe("public directory database indexes", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(["TeacherProfile", "TutoringRequest"])(
    "has a stable published directory sorting index for %s",
    async (tableName) => {
      const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = ${tableName}
      `;

      expect(indexes.some(({ indexdef }) =>
        indexdef.includes('(status, "publishedAt" DESC, id)')
        || indexdef.includes('("status", "publishedAt" DESC, "id")'),
      )).toBe(true);
    },
  );
});
