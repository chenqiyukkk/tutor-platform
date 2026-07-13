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

describe("region adjacency schema", () => {
  it("stores each canonical undirected district pair once and rejects self adjacency", () => {
    expect(schema).toContain("model RegionAdjacency");
    expect(schema).toMatch(/regionAId\s+String\s+@db\.Uuid/);
    expect(schema).toMatch(/regionBId\s+String\s+@db\.Uuid/);

    const regionMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name.endsWith("_region_adjacency"),
    );
    expect(regionMigration).toBeDefined();
    const sql = readFileSync(
      join(migrationsDirectory, regionMigration!.name, "migration.sql"),
      "utf8",
    );
    expect(sql).toContain('CREATE UNIQUE INDEX "RegionAdjacency_regionAId_regionBId_key"');
    expect(sql).toContain('CONSTRAINT "RegionAdjacency_canonical_pair_check"');
    expect(sql).toContain('CHECK ("regionAId" < "regionBId")');
  });
});

describe("teacher profile schema", () => {
  it("stores identity, online availability and a bounded hourly rate range", () => {
    expect(schema).toContain("enum TeacherIdentityType");
    expect(schema).toMatch(/identityType\s+TeacherIdentityType\?/);
    expect(schema).toMatch(/isOnline\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/hourlyRateMax\s+Decimal\?\s+@db\.Decimal\(10, 2\)/);

    const teacherMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name.endsWith("_teacher_profiles"),
    );
    expect(teacherMigration).toBeDefined();
  });
});

describe("favorite list sorting index", () => {
  it("supports owner-scoped keyset pagination in stable display order", () => {
    expect(schema).toMatch(/@@index\(\[ownerAccountId, createdAt\(sort: Desc\), id\]\)/);

    const favoriteMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name.endsWith("_favorite_list_sort_index"),
    );
    expect(favoriteMigration).toBeDefined();
    const sql = readFileSync(
      join(migrationsDirectory, favoriteMigration!.name, "migration.sql"),
      "utf8",
    );
    expect(sql).toContain(
      'CREATE INDEX "Favorite_ownerAccountId_createdAt_id_idx" ON "Favorite"("ownerAccountId", "createdAt" DESC, "id")',
    );
  });
});

describe("public content safety migration", () => {
  it("demotes legacy unsafe public records in a new forward-only migration", () => {
    const safetyMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name === "20260713133400_public_content_safety",
    );
    expect(safetyMigration).toBeDefined();
    if (!safetyMigration) return;
    const sql = readFileSync(join(migrationsDirectory, safetyMigration.name, "migration.sql"), "utf8");
    expect(sql).toContain('UPDATE "TeacherProfile"');
    expect(sql).toContain('UPDATE "TutoringRequest"');
    expect(sql).toContain('"status" = \'DRAFT\'');
    expect(sql).toContain('"publishedAt" = NULL');
    expect(sql).toContain('btrim("headline") = \'\'');
    expect(sql).toContain('"StudentProfile"');
    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    const lockSteps = [
      'LOCK TABLE "TeacherProfile"',
      'LOCK TABLE "TutoringRequest"',
      'LOCK TABLE "StudentProfile"',
    ].map((step) => sql.indexOf(step));
    expect(lockSteps.every((position) => position >= 0)).toBe(true);
    expect(lockSteps).toEqual([...lockSteps].sort((left, right) => left - right));
    expect(sql).toContain("regexp_replace");
    expect(sql).toContain("13800138000");
    expect(sql).toMatch(/FF01|fullwidth|Ｗ/u);
    expect(sql).toMatch(/200B|zero.width|8203/iu);
  });

  it("persists a current safety version for database-first public pagination", () => {
    expect(schema).toMatch(/publicContentSafetyVersion\s+Int\s+@default\(0\)/g);
    const versionMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name === "20260713133500_public_content_safety_version",
    );
    expect(versionMigration).toBeDefined();
    if (!versionMigration) return;
    const sql = readFileSync(join(migrationsDirectory, versionMigration.name, "migration.sql"), "utf8");
    expect(sql).toContain('ADD COLUMN "publicContentSafetyVersion" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('UPDATE "TeacherProfile"');
    expect(sql).toContain('UPDATE "TutoringRequest"');
    expect(sql).toContain('"publicContentSafetyVersion" = 1');
  });
});
