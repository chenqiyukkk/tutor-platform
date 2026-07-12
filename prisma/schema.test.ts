import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const prismaDirectory = join(process.cwd(), "prisma");
const schema = readFileSync(join(prismaDirectory, "schema.prisma"), "utf8");
const migrationsDirectory = join(prismaDirectory, "migrations");
const dataIntegrityMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
  (entry) => entry.isDirectory() && entry.name.endsWith("_data_integrity"),
);

if (!dataIntegrityMigration) {
  throw new Error("The data_integrity migration is missing");
}

const migrationSql = readFileSync(
  join(migrationsDirectory, dataIntegrityMigration.name, "migration.sql"),
  "utf8",
);

const passwordResetMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
  (entry) => entry.isDirectory() && entry.name.endsWith("_password_reset_activation"),
);

describe("database integrity schema", () => {
  it("supports account-owned favorites with exactly one target", () => {
    expect(schema).toMatch(/ownerAccountId\s+String\s+@db\.Uuid/);
    expect(schema).toMatch(/teacherProfileId\s+String\?\s+@db\.Uuid/);
    expect(schema).toMatch(/tutoringRequestId\s+String\?\s+@db\.Uuid/);

    expect(migrationSql).toContain("Favorite_exactly_one_target_check");
    expect(migrationSql).toMatch(/CHECK[\s\S]*teacherProfileId[\s\S]*tutoringRequestId/);
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "Favorite_ownerAccountId_teacherProfileId_key"',
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "Favorite_ownerAccountId_tutoringRequestId_key"',
    );
  });

  it("backfills legacy favorite owners before removing the old relation", () => {
    expect(migrationSql).not.toContain('ADD COLUMN     "ownerAccountId" UUID NOT NULL');
    expect(migrationSql).toContain('UPDATE "Favorite" AS favorite');
    expect(migrationSql).toContain('FROM "ParentProfile" AS parent_profile');
    expect(migrationSql).toContain('favorite."ownerAccountId" IS NULL');
    expect(migrationSql).toContain('ALTER COLUMN "ownerAccountId" SET NOT NULL');

    const migrationSteps = [
      'ADD COLUMN     "ownerAccountId" UUID',
      'UPDATE "Favorite" AS favorite',
      "DO $favorite_owner_backfill$",
      'ALTER COLUMN "ownerAccountId" SET NOT NULL',
      'DROP CONSTRAINT "Favorite_parentProfileId_fkey"',
      'DROP INDEX "Favorite_parentProfileId_teacherProfileId_key"',
      'DROP COLUMN "parentProfileId"',
    ].map((step) => migrationSql.indexOf(step));

    expect(migrationSteps.every((position) => position >= 0)).toBe(true);
    expect(migrationSteps).toEqual([...migrationSteps].sort((left, right) => left - right));
  });

  it("stores when a message was read", () => {
    expect(schema).toMatch(/readAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
  });
});

describe("password reset token schema", () => {
  it("keeps delivered links inactive until delivery is acknowledged", () => {
    expect(schema).toMatch(/activatedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
    expect(passwordResetMigration).toBeDefined();
    const sql = readFileSync(
      join(migrationsDirectory, passwordResetMigration!.name, "migration.sql"),
      "utf8",
    );
    expect(sql).toContain('ADD COLUMN "activatedAt" TIMESTAMPTZ(3)');
  });
});
