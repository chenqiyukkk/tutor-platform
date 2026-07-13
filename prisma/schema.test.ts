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
const moderationMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
  (entry) => entry.isDirectory() && entry.name === "20260714090000_moderation_workflow",
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
    expect(sql.indexOf("regexp_replace")).toBeLessThan(sql.indexOf("normalize("));
    for (const fragment of ["w[[:space:]]*x", "q[[:space:]]*q", "扣[[:space:]]*扣", "t[[:space:]]*g", "付[[:space:]]*(信息|中介)", "私聊发"]) {
      expect(sql).toContain(fragment);
    }
    expect(sql).toContain('btrim("displayName") = \'\'');
    expect(sql).toContain('btrim("bio") = \'\'');
    expect(sql).toContain('NOT EXISTS (');
    expect(sql).toContain('"StudentProfile"."isActive" = true');
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
    expect(sql.indexOf("regexp_replace")).toBeLessThan(sql.indexOf("normalize("));
    expect(sql).toContain('btrim("displayName") <> \'\'');
    expect(sql).toContain('btrim("bio") <> \'\'');
    expect(sql).toContain('btrim(request."title") <> \'\'');
    expect(sql).toContain('btrim(request."description") <> \'\'');
    expect(sql).toContain('"StudentProfile"."isActive" = true');

    const safetySql = readFileSync(
      join(migrationsDirectory, "20260713133400_public_content_safety", "migration.sql"),
      "utf8",
    );
    const extractFunction = (migration: string) => migration.match(
      /CREATE FUNCTION "public_content_unsafe_v1"[\s\S]*?\$function\$;/,
    )?.[0];
    expect(extractFunction(sql)).toBe(extractFunction(safetySql));
  });
});

describe("chat polling indexes", () => {
  it("adds chronological message keysets and participant activity/unread indexes forward-only", () => {
    expect(schema).toMatch(/@@index\(\[conversationId, sentAt, id\]\)/);
    const chatMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name === "20260713133600_chat_polling_indexes",
    );
    expect(chatMigration).toBeDefined();
    if (!chatMigration) return;
    const sql = readFileSync(join(migrationsDirectory, chatMigration.name, "migration.sql"), "utf8");
    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain('"Message_conversationId_sentAt_id_idx"');
    expect(sql).toContain('"Message_conversationId_unread_sender_idx"');
    expect(sql).toContain('"Conversation_teacherId_activityAt_id_idx"');
    expect(sql).toContain('"Conversation_parentId_activityAt_id_idx"');
  });

  it("adds a forward-only message change watermark and removes superseded conversation indexes", () => {
    expect(schema).toMatch(/updatedAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/);
    expect(schema).not.toMatch(/@@index\(\[conversationId, updatedAt, id\]\)/);
    expect(schema).not.toMatch(/@@index\(\[teacherId, lastMessageAt\]\)/);
    expect(schema).not.toMatch(/@@index\(\[parentId, lastMessageAt\]\)/);

    const changeMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name === "20260713133700_chat_message_change_polling",
    );
    expect(changeMigration).toBeDefined();
    if (!changeMigration) return;
    const sql = readFileSync(join(migrationsDirectory, changeMigration.name, "migration.sql"), "utf8");
    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain('ADD COLUMN "updatedAt" TIMESTAMPTZ(3)');
    expect(sql).toMatch(/GREATEST\(\s*"sentAt"/u);
    for (const column of ['"readAt"', '"editedAt"', '"deletedAt"']) expect(sql).toContain(column);
    expect(sql).toContain('ALTER COLUMN "updatedAt" SET NOT NULL');
    expect(sql).toContain('ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP');
    expect(sql).toContain('"Message_conversationId_updatedAt_id_idx"');
    expect(sql).toContain('DROP INDEX IF EXISTS "Conversation_teacherId_lastMessageAt_idx"');
    expect(sql).toContain('DROP INDEX IF EXISTS "Conversation_parentId_lastMessageAt_idx"');
  });

  it("versions every message mutation with the canonical pair lock before sequence allocation", () => {
    expect(schema).toMatch(/changeVersion\s+BigInt\s+@default\(0\)/);
    expect(schema).toMatch(/@@index\(\[conversationId, changeVersion\]\)/);
    expect(schema).not.toMatch(/@@index\(\[conversationId, updatedAt, id\]\)/);

    const versionMigration = readdirSync(migrationsDirectory, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name === "20260713133800_chat_message_change_version",
    );
    expect(versionMigration).toBeDefined();
    if (!versionMigration) return;
    const sql = readFileSync(join(migrationsDirectory, versionMigration.name, "migration.sql"), "utf8");
    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).not.toContain('LOCK TABLE "Conversation"');
    expect(sql).toContain('CREATE SEQUENCE "Message_changeVersion_seq"');
    expect(sql).toContain('ADD COLUMN "changeVersion" BIGINT');
    expect(sql).toContain('CREATE TRIGGER "Message_assign_change_version"');
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON "Message"');
    expect(sql).toContain("greeting-pair:");
    expect(sql).toContain("LEAST(conversation_record.\"teacherId\"::text, conversation_record.\"parentId\"::text)");
    expect(sql).toContain("GREATEST(conversation_record.\"teacherId\"::text, conversation_record.\"parentId\"::text)");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(pair_key, 0))");
    const triggerNextval = 'NEW."changeVersion" := nextval(\'"Message_changeVersion_seq"\')';
    expect(sql).toContain(triggerNextval);
    expect(sql.indexOf("pg_advisory_xact_lock")).toBeLessThan(sql.indexOf(triggerNextval));
    const backfill = 'SET "changeVersion" = nextval(\'"Message_changeVersion_seq"\')';
    expect(sql).toContain(backfill);
    expect(sql.indexOf(backfill)).toBeLessThan(sql.indexOf('CREATE TRIGGER "Message_assign_change_version"'));
    expect(sql).not.toContain('SET "changeVersion" = 0');
    expect(sql).toContain('CREATE INDEX "Message_conversationId_changeVersion_idx"');
    expect(sql).toContain('DROP INDEX "Message_conversationId_updatedAt_id_idx"');
  });
});

describe("moderation workflow schema", () => {
  it("stores canonical report targets, idempotency keys, decisions, and moderation holds", () => {
    expect(schema).toContain("enum ReportTargetType");
    for (const value of ["ACCOUNT", "TEACHER_PROFILE", "TUTORING_REQUEST", "GREETING", "CONVERSATION", "MESSAGE"]) {
      expect(schema).toMatch(new RegExp(`enum ReportTargetType[\\s\\S]*\\b${value}\\b`));
    }
    expect(schema).toMatch(/enum ReportResolutionAction[\s\S]*\bNONE\b[\s\S]*\bCONTENT_TAKEDOWN\b[\s\S]*\bACCOUNT_SUSPENSION\b/);
    expect(schema).toMatch(/targetType\s+ReportTargetType\b/);
    expect(schema).toMatch(/targetId\s+String\s+@db\.Uuid/);
    expect(schema).toMatch(/clientRequestId\s+String\?\s+@db\.Uuid/);
    expect(schema).toMatch(/targetSnapshot\s+Json\?/);
    expect(schema).toMatch(/resolutionAction\s+ReportResolutionAction\?/);
    expect(schema).toMatch(/teacherProfileId\s+String\?\s+@db\.Uuid/);
    expect(schema).toContain("@@unique([reporterAccountId, clientRequestId])");
    expect(schema).toContain("@@index([targetType, targetId])");
    expect(schema).toContain("@@unique([accountId, clientRequestId])");
    expect(schema).toMatch(/requestId\s+String\?\s+@unique\s+@db\.Uuid/);
    expect(schema.match(/moderationRejectedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/g)).toHaveLength(2);
    expect(schema.match(/moderationReason\s+String\?/g)).toHaveLength(2);
  });

  it("adds forward-only database checks, partial uniqueness, and append-only audit enforcement", () => {
    expect(moderationMigration).toBeDefined();
    if (!moderationMigration) return;
    const sql = readFileSync(join(migrationsDirectory, moderationMigration.name, "migration.sql"), "utf8");
    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain('LOCK TABLE "Report" IN SHARE ROW EXCLUSIVE MODE');
    const preflight = sql.indexOf("moderation_report_target_preflight");
    const firstPersistentDdl = Math.min(
      ...[sql.indexOf('CREATE TYPE "ReportTargetType"'), sql.indexOf('ALTER TABLE "Report"')]
        .filter((position) => position >= 0),
    );
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeLessThan(firstPersistentDdl);
    expect(sql).toContain("cannot derive canonical target for one or more legacy reports");
    expect(sql).toContain('ALTER COLUMN "targetType" SET NOT NULL');
    expect(sql).toContain('ALTER COLUMN "targetId" SET NOT NULL');
    expect(sql).toContain('"Report_reporterAccountId_clientRequestId_key"');
    expect(sql).toContain('"Report_reporterAccountId_targetType_targetId_open_key"');
    expect(sql).toMatch(/WHERE "status" IN \('PENDING', 'REVIEWING'\)/);
    expect(sql).toContain('"Verification_accountId_clientRequestId_key"');
    expect(sql).toContain('"Verification_accountId_type_pending_key"');
    expect(sql).toMatch(/WHERE "status" = 'PENDING'/);
    expect(sql).toContain('CONSTRAINT "Report_no_self_report_check"');
    expect(sql).toContain('CONSTRAINT "Report_target_shape_check"');
    expect(sql).toContain('CREATE TRIGGER "AdminAuditLog_append_only"');
    expect(sql).toContain("ERRCODE = '55000'");
  });
});
