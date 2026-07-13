// @vitest-environment node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for migration integration tests");

describe("teacher profile migration compatibility", () => {
  it("preserves legacy profiles while nulling invalid rates before validating the constraint", async () => {
    const databaseName = `teacher_migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const adminUrl = new URL(process.env.DATABASE_URL!);
    adminUrl.pathname = "/postgres";
    adminUrl.search = "";
    const tempUrl = new URL(process.env.DATABASE_URL!);
    tempUrl.pathname = `/${databaseName}`;
    tempUrl.search = "";
    const admin = new Client({ connectionString: adminUrl.toString() });
    let temp: Client | undefined;
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      temp = new Client({ connectionString: tempUrl.toString() });
      await temp.connect();
      const migrationsRoot = join(process.cwd(), "prisma", "migrations");
      const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const teacherProfileMigration = migrations.find((migration) =>
        migration.endsWith("_teacher_profiles"),
      );
      if (!teacherProfileMigration) throw new Error("teacher profile migration is missing");
      const teacherProfileMigrationIndex = migrations.indexOf(teacherProfileMigration);
      for (const migration of migrations.slice(0, teacherProfileMigrationIndex)) {
        await temp.query(readFileSync(join(migrationsRoot, migration, "migration.sql"), "utf8"));
      }
      const accountId = crypto.randomUUID();
      const overLimitAccountId = crypto.randomUUID();
      const account = await temp.query<{ id: string }>(`
        INSERT INTO "Account" (id, role, username, "normalizedUsername", email, "normalizedEmail", "passwordHash", "updatedAt")
        VALUES ($1, 'TEACHER', 'legacy-rate', 'legacy-rate', 'legacy@example.test', 'legacy@example.test', 'hash', now())
        RETURNING id
      `, [accountId]);
      await temp.query(`
        INSERT INTO "Account" (id, role, username, "normalizedUsername", email, "normalizedEmail", "passwordHash", "updatedAt")
        VALUES ($1, 'TEACHER', 'legacy-high-rate', 'legacy-high-rate', 'legacy-high@example.test', 'legacy-high@example.test', 'hash', now())
      `, [overLimitAccountId]);
      await temp.query(`
        INSERT INTO "TeacherProfile" (id, "accountId", "displayName", "hourlyRate", "updatedAt")
        VALUES ($1, $2, '负数旧资料', -1, now()), ($3, $4, '超限旧资料', 1000.01, now())
      `, [crypto.randomUUID(), account.rows[0].id, crypto.randomUUID(), overLimitAccountId]);

      await temp.query(readFileSync(
        join(migrationsRoot, teacherProfileMigration, "migration.sql"),
        "utf8",
      ));

      const profiles = await temp.query<{ displayName: string; hourlyRate: string | null }>(`
        SELECT "displayName", "hourlyRate" FROM "TeacherProfile"
        WHERE "accountId" IN ($1, $2) ORDER BY "displayName"
      `, [account.rows[0].id, overLimitAccountId]);
      expect(profiles.rows).toHaveLength(2);
      expect(profiles.rows).toEqual(expect.arrayContaining([
        { displayName: "负数旧资料", hourlyRate: null },
        { displayName: "超限旧资料", hourlyRate: null },
      ]));
      const constraint = await temp.query<{ convalidated: boolean }>(`
        SELECT convalidated FROM pg_constraint
        WHERE conname = 'TeacherProfile_hourly_rate_range_check'
      `);
      expect(constraint.rows[0]?.convalidated).toBe(true);
      await expect(temp.query(`UPDATE "TeacherProfile" SET "hourlyRate" = 1000.01`))
        .rejects.toThrow();
    } finally {
      await temp?.end().catch(() => undefined);
      await admin.query(`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `, [databaseName]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
      await admin.end();
    }
  }, 15_000);
});
