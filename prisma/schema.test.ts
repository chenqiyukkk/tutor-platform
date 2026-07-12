import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const prismaDirectory = join(process.cwd(), "prisma");
const schema = readFileSync(join(prismaDirectory, "schema.prisma"), "utf8");

describe("database integrity schema", () => {
  it("supports account-owned favorites with exactly one target", () => {
    expect(schema).toMatch(/ownerAccountId\s+String\s+@db\.Uuid/);
    expect(schema).toMatch(/teacherProfileId\s+String\?\s+@db\.Uuid/);
    expect(schema).toMatch(/tutoringRequestId\s+String\?\s+@db\.Uuid/);

    const migrationsDirectory = join(prismaDirectory, "migrations");
    const migrationSql = readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readFileSync(join(migrationsDirectory, entry.name, "migration.sql"), "utf8"),
      )
      .join("\n");

    expect(migrationSql).toContain("Favorite_exactly_one_target_check");
    expect(migrationSql).toMatch(/CHECK[\s\S]*teacherProfileId[\s\S]*tutoringRequestId/);
  });

  it("stores when a message was read", () => {
    expect(schema).toMatch(/readAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
  });
});
