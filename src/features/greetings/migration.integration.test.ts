// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, describe, expect, it } from "vitest";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

describe("greeting workflow database constraints", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  afterAll(() => prisma.$disconnect());

  it("enforces context, conversation and report uniqueness in PostgreSQL", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'Greeting_contextKey_key',
          'Greeting_senderAccountId_createdAt_id_idx',
          'Greeting_recipientAccountId_createdAt_id_idx',
          'Conversation_teacherId_parentId_tutoringRequestId_key',
          'Report_greetingId_key',
          'Favorite_ownerAccountId_teacherProfileId_key',
          'Favorite_ownerAccountId_tutoringRequestId_key'
        )
    `;
    expect(indexes.map(({ indexname }) => indexname).sort()).toEqual([
      "Conversation_teacherId_parentId_tutoringRequestId_key",
      "Favorite_ownerAccountId_teacherProfileId_key",
      "Favorite_ownerAccountId_tutoringRequestId_key",
      "Greeting_contextKey_key",
      "Greeting_recipientAccountId_createdAt_id_idx",
      "Greeting_senderAccountId_createdAt_id_idx",
      "Report_greetingId_key",
    ]);
  });

  it("keeps state/time and exactly-one favorite checks in the database", async () => {
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conname IN (
        'Greeting_distinct_accounts_check',
        'Greeting_expiry_after_creation_check',
        'Greeting_response_time_check',
        'Favorite_exactly_one_target_check'
      )
    `;
    expect(constraints.map(({ conname }) => conname).sort()).toEqual([
      "Favorite_exactly_one_target_check",
      "Greeting_distinct_accounts_check",
      "Greeting_expiry_after_creation_check",
      "Greeting_response_time_check",
    ]);
  });
});
