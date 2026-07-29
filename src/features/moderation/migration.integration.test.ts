// @vitest-environment node

import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for moderation migration tests");

const MODERATION_MIGRATION = "20260714090000_moderation_workflow";
const MIGRATIONS = [
  "20260712114752_init",
  "20260712121439_data_integrity",
  "20260713040153_public_directory_sort_indexes",
  "20260713065000_password_reset_activation",
  "20260713074000_region_adjacency",
  "20260713082000_teacher_profiles",
  "20260713110000_parent_requests",
  "20260713132900_greeting_status",
  "20260713133000_greeting_workflow",
  "20260713133100_greeting_attempt",
  "20260713133200_validate_greeting_context",
  "20260713133300_favorite_list_sort_index",
  "20260713133400_public_content_safety",
  "20260713133500_public_content_safety_version",
  "20260713133600_chat_polling_indexes",
  "20260713133700_chat_message_change_polling",
  "20260713133800_chat_message_change_version",
  MODERATION_MIGRATION,
] as const;
const TEMP_WORKSPACE_PARENT = join(tmpdir(), "tutor-platform-moderation-migrations");
const SUITE_ID = `${process.pid}-${randomUUID().replaceAll("-", "")}`;
const TEMP_WORKSPACE_ROOT = join(TEMP_WORKSPACE_PARENT, `suite-${SUITE_ID}`);
const FOREIGN_WORKSPACE_ROOT = join(TEMP_WORKSPACE_PARENT, `run-foreign-${process.pid}-${randomUUID()}`);
const FOREIGN_WORKSPACE_SENTINEL = join(FOREIGN_WORKSPACE_ROOT, "owner.txt");
mkdirSync(FOREIGN_WORKSPACE_ROOT, { recursive: true });
writeFileSync(FOREIGN_WORKSPACE_SENTINEL, "owned by another suite");
const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const tempRoots: string[] = [];
const fixtureRoots = [FOREIGN_WORKSPACE_ROOT];
const databases: string[] = [];
const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
let invariantDatabase: { name: string; url: string } | undefined;
let invariantRoot: string | undefined;

function migrationExists() {
  return existsSync(join(process.cwd(), "prisma", "migrations", MODERATION_MIGRATION, "migration.sql"));
}

function databaseUrl(name: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function createDatabase() {
  const name = `moderation_migration_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE DATABASE "${name}"`);
  databases.push(name);
  return { name, url: databaseUrl(name) };
}

function createMigrationWorkspace(count: number) {
  mkdirSync(TEMP_WORKSPACE_ROOT, { recursive: true });
  const root = mkdtempSync(join(TEMP_WORKSPACE_ROOT, "run-"));
  tempRoots.push(root);
  mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
  copyFileSync(join(process.cwd(), "prisma", "schema.prisma"), join(root, "prisma", "schema.prisma"));
  writeFileSync(join(root, "prisma.config.mjs"), `export default {
  schema: ${JSON.stringify(join(root, "prisma", "schema.prisma"))},
  migrations: { path: ${JSON.stringify(join(root, "prisma", "migrations"))} },
  datasource: { url: process.env.DATABASE_URL },
};\n`);
  copyMigrations(root, count);
  return root;
}

function copyMigrations(root: string, count: number) {
  for (const migration of MIGRATIONS.slice(0, count)) {
    copyDirectory(
      join(process.cwd(), "prisma", "migrations", migration),
      join(root, "prisma", "migrations", migration),
    );
  }
}

function copyDirectory(source: string, destination: string) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else copyFileSync(from, to);
  }
}

function runPrisma(root: string, url: string, args: string[]) {
  return spawnSync(process.execPath, [prismaCli, ...args, "--config", join(root, "prisma.config.mjs")], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
    timeout: 90_000,
  });
}

function expectPrismaSuccess(result: ReturnType<typeof runPrisma>) {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("All migrations have been successfully applied");
}

function isSafeMigrationWorkspace(root: string) {
  const candidate = resolve(root);
  const relativePath = relative(resolve(TEMP_WORKSPACE_ROOT), candidate);
  return relativePath !== ""
    && !relativePath.startsWith("..")
    && !isAbsolute(relativePath)
    && basename(candidate).startsWith("run-");
}

async function cleanupMigrationWorkspace(root: string) {
  if (!isSafeMigrationWorkspace(root)) return false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    rmSync(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    if (!existsSync(root)) return true;
    await delay(100);
  }
  return false;
}

async function cleanupSuiteWorkspaceRoot() {
  const candidate = resolve(TEMP_WORKSPACE_ROOT);
  if (candidate !== resolve(join(TEMP_WORKSPACE_PARENT, `suite-${SUITE_ID}`))) return false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    rmSync(candidate, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    if (!existsSync(candidate)) return true;
    await delay(100);
  }
  return false;
}

async function insertAccount(client: Client, role: "ADMIN" | "PARENT" | "TEACHER", label: string) {
  const id = randomUUID();
  await client.query(`
    INSERT INTO "Account" ("id","role","username","normalizedUsername","email","normalizedEmail","passwordHash","createdAt","updatedAt")
    VALUES ($1,$2,$3,$3,$4,$4,'hash',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [id, role, `${label}-${id}`, `${label}-${id}@example.test`]);
  return id;
}

async function seedLegacyReports(client: Client) {
  const teacherId = await insertAccount(client, "TEACHER", "legacy-teacher");
  const parentId = await insertAccount(client, "PARENT", "legacy-parent");
  const teacherProfileId = randomUUID(), parentProfileId = randomUUID(), requestId = randomUUID();
  const greetingId = randomUUID(), conversationId = randomUUID(), messageId = randomUUID();
  await client.query(`
    INSERT INTO "TeacherProfile" ("id","accountId","displayName","status","createdAt","updatedAt")
    VALUES ($1,$2,'Legacy teacher','DRAFT',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [teacherProfileId, teacherId]);
  await client.query(`
    INSERT INTO "ParentProfile" ("id","accountId","displayName","status","createdAt","updatedAt")
    VALUES ($1,$2,'Legacy parent','PUBLISHED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [parentProfileId, parentId]);
  await client.query(`
    INSERT INTO "TutoringRequest" ("id","parentProfileId","title","description","status","createdAt","updatedAt")
    VALUES ($1,$2,'Legacy request','Preserve me','DRAFT',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [requestId, parentProfileId]);
  await client.query(`
    INSERT INTO "Greeting" (
      "id","senderAccountId","recipientAccountId","tutoringRequestId","contextKey","cardSnapshot",
      "status","expiresAt","createdAt","updatedAt"
    ) VALUES ($1,$2,$3,$4,$5,'{"legacy":true}'::jsonb,'PENDING',CURRENT_TIMESTAMP + interval '7 days',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [greetingId, teacherId, parentId, requestId, `${teacherId}:${parentId}:${requestId}`]);
  await client.query(`
    INSERT INTO "Conversation" (
      "id","greetingId","teacherId","parentId","tutoringRequestId","createdAt","updatedAt"
    ) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [conversationId, greetingId, teacherId, parentId, requestId]);
  await client.query(`
    INSERT INTO "Message" ("id","conversationId","senderAccountId","clientMessageId","body","sentAt","updatedAt")
    VALUES ($1,$2,$3,$4,'Legacy message',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [messageId, conversationId, teacherId, randomUUID()]);

  const ids = {
    account: randomUUID(),
    conversation: randomUUID(),
    greeting: randomUUID(),
    message: randomUUID(),
    request: randomUUID(),
  };
  await client.query(`
    INSERT INTO "Report" (
      "id","reporterAccountId","reportedAccountId","tutoringRequestId","conversationId","messageId",
      "reason","status","createdAt","updatedAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,'Legacy message report','PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [ids.message, parentId, teacherId, requestId, conversationId, messageId]);
  await client.query(`
    INSERT INTO "Report" (
      "id","reporterAccountId","reportedAccountId","tutoringRequestId","conversationId",
      "reason","status","createdAt","updatedAt"
    ) VALUES ($1,$2,$3,$4,$5,'Legacy conversation report','REVIEWING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [ids.conversation, parentId, teacherId, requestId, conversationId]);
  await client.query(`
    INSERT INTO "Report" (
      "id","reporterAccountId","reportedAccountId","tutoringRequestId","greetingId",
      "reason","status","createdAt","updatedAt"
    ) VALUES ($1,$2,$3,$4,$5,'Legacy greeting report','RESOLVED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [ids.greeting, parentId, teacherId, requestId, greetingId]);
  await client.query(`
    INSERT INTO "Report" (
      "id","reporterAccountId","reportedAccountId","tutoringRequestId",
      "reason","status","createdAt","updatedAt"
    ) VALUES ($1,$2,$3,$4,'Legacy request report','DISMISSED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [ids.request, teacherId, parentId, requestId]);
  await client.query(`
    INSERT INTO "Report" (
      "id","reporterAccountId","reportedAccountId","reason","status","createdAt","updatedAt"
    ) VALUES ($1,$2,$3,'Legacy account report','RESOLVED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, [ids.account, parentId, teacherId]);
  return { ids, teacherId, parentId, teacherProfileId, requestId, greetingId, conversationId, messageId };
}

beforeAll(async () => {
  mkdirSync(TEMP_WORKSPACE_ROOT, { recursive: true });
  if (!migrationExists()) return;
  invariantDatabase = await createDatabase();
  invariantRoot = createMigrationWorkspace(MIGRATIONS.length);
  expectPrismaSuccess(runPrisma(invariantRoot, invariantDatabase.url, ["migrate", "deploy"]));
});

afterAll(async () => {
  for (const name of databases.reverse()) {
    await adminPool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
    await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);
  }
  await adminPool.end();
  for (const root of tempRoots) await cleanupMigrationWorkspace(root);
  await cleanupSuiteWorkspaceRoot();
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

describe("moderation workflow migration", () => {
  it("uses a process-unique suite root and never removes another suite's run directory", () => {
    try {
      expect.soft(existsSync(FOREIGN_WORKSPACE_SENTINEL)).toBe(true);
      expect.soft(basename(TEMP_WORKSPACE_ROOT)).toMatch(new RegExp(`^suite-${process.pid}-[a-f0-9]{32}$`));
      expect.soft(isSafeMigrationWorkspace(FOREIGN_WORKSPACE_ROOT)).toBe(false);
    } finally {
      rmSync(FOREIGN_WORKSPACE_ROOT, { recursive: true, force: true });
    }
  });

  it("deploys all 18 migrations into an empty database with datasource-to-schema parity", async () => {
    expect(migrationExists()).toBe(true);
    if (!invariantDatabase || !invariantRoot) return;
    const client = new Client({ connectionString: invariantDatabase.url });
    try {
      await client.connect();
      const applied = await client.query(`
        SELECT count(*)::int AS count
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `);
      expect(applied.rows[0].count).toBe(18);
      const diff = runPrisma(invariantRoot, invariantDatabase.url, [
        "migrate", "diff", "--from-config-datasource", "--to-schema",
        join(invariantRoot, "prisma", "schema.prisma"), "--exit-code",
      ]);
      expect(diff.error).toBeUndefined();
      expect(diff.status).toBe(0);
      expect(`${diff.stdout}\n${diff.stderr}`).toContain("No difference detected");
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 90_000);

  it("takes the final Report lock up front without deadlocking a concurrent read-then-write transaction", async () => {
    expect(migrationExists()).toBe(true);
    if (!migrationExists()) return;
    const database = await createDatabase();
    const root = createMigrationWorkspace(MIGRATIONS.length - 1);
    const reader = new Client({ connectionString: database.url });
    const migrator = new Client({ connectionString: database.url });
    const observer = new Client({ connectionString: database.url });
    let migration: Promise<unknown> | undefined;
    try {
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      await Promise.all([reader.connect(), migrator.connect(), observer.connect()]);
      await reader.query("BEGIN");
      await reader.query("SET LOCAL lock_timeout = '3s'");
      await reader.query(`SELECT count(*) FROM "Report"`);

      const beforeDeadlocks = Number((await adminPool.query(
        `SELECT deadlocks FROM pg_stat_database WHERE datname = $1`,
        [database.name],
      )).rows[0].deadlocks);
      const migrationSql = readFileSync(
        join(process.cwd(), "prisma", "migrations", MODERATION_MIGRATION, "migration.sql"),
        "utf8",
      );
      const initialLock = migrationSql.match(/LOCK TABLE "Report" IN (.+) MODE;/)?.[1];
      expect(["SHARE ROW EXCLUSIVE", "ACCESS EXCLUSIVE"]).toContain(initialLock);
      const expectedMode = initialLock === "ACCESS EXCLUSIVE" ? "AccessExclusiveLock" : "ShareRowExclusiveLock";
      const expectedGranted = initialLock !== "ACCESS EXCLUSIVE";
      const migratorPid = Number((await migrator.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      migration = migrator.query(migrationSql);

      let observedInitialLock = false;
      const lockDeadline = Date.now() + 5_000;
      while (Date.now() < lockDeadline) {
        const locks = await observer.query<{ granted: boolean }>(`
          SELECT granted FROM pg_locks
          WHERE pid = $1
            AND relation = '"Report"'::regclass
            AND mode = $2
            AND granted = $3
        `, [migratorPid, expectedMode, expectedGranted]);
        if (locks.rowCount) {
          observedInitialLock = true;
          break;
        }
        await delay(10);
      }
      expect(observedInitialLock).toBe(true);

      const write = reader.query(`UPDATE "Report" SET "updatedAt" = "updatedAt"`)
        .then(async () => {
          await reader.query("COMMIT");
          return { status: "completed" as const };
        })
        .catch(async (error: { code?: string }) => {
          await reader.query("ROLLBACK");
          return { status: "failed" as const, code: error.code };
        });
      const migrationOutcome = migration
        .then(() => ({ status: "completed" as const }))
        .catch((error: { code?: string }) => ({ status: "failed" as const, code: error.code }));
      const [migrationResult, writeResult] = await Promise.all([migrationOutcome, write]);
      const afterDeadlocks = Number((await adminPool.query(
        `SELECT deadlocks FROM pg_stat_database WHERE datname = $1`,
        [database.name],
      )).rows[0].deadlocks);

      expect(migrationResult).toEqual({ status: "completed" });
      expect(writeResult).not.toMatchObject({ code: "40P01" });
      expect(writeResult.status === "completed" || writeResult.code === "55P03").toBe(true);
      expect(afterDeadlocks).toBe(beforeDeadlocks);
    } finally {
      await reader.query("ROLLBACK").catch(() => undefined);
      await migration?.catch(() => undefined);
      await Promise.all([
        reader.end().catch(() => undefined),
        migrator.end().catch(() => undefined),
        observer.end().catch(() => undefined),
      ]);
      await cleanupMigrationWorkspace(root);
    }
  }, 30_000);

  it("backfills legacy reports from the most specific canonical target", async () => {
    expect(migrationExists()).toBe(true);
    if (!migrationExists()) return;
    const database = await createDatabase();
    const root = createMigrationWorkspace(MIGRATIONS.length - 1);
    const client = new Client({ connectionString: database.url });
    try {
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      await client.connect();
      const legacy = await seedLegacyReports(client);
      copyMigrations(root, MIGRATIONS.length);
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      const migrated = await client.query<{ id: string; targetType: string; targetId: string }>(`
        SELECT "id","targetType","targetId" FROM "Report" ORDER BY "id"
      `);
      const byId = new Map(migrated.rows.map((row) => [row.id, row]));
      expect(byId.get(legacy.ids.message)).toMatchObject({ targetType: "MESSAGE", targetId: legacy.messageId });
      expect(byId.get(legacy.ids.conversation)).toMatchObject({ targetType: "CONVERSATION", targetId: legacy.conversationId });
      expect(byId.get(legacy.ids.greeting)).toMatchObject({ targetType: "GREETING", targetId: legacy.greetingId });
      expect(byId.get(legacy.ids.request)).toMatchObject({ targetType: "TUTORING_REQUEST", targetId: legacy.requestId });
      expect(byId.get(legacy.ids.account)).toMatchObject({ targetType: "ACCOUNT", targetId: legacy.teacherId });
    } finally {
      await client.end().catch(() => undefined);
      await cleanupMigrationWorkspace(root);
    }
  }, 90_000);

  it("fails before persistent DDL and rolls the migration back for an unresolvable legacy report", async () => {
    expect(migrationExists()).toBe(true);
    if (!migrationExists()) return;
    const database = await createDatabase();
    const root = createMigrationWorkspace(MIGRATIONS.length - 1);
    const client = new Client({ connectionString: database.url });
    try {
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      await client.connect();
      const reporterId = await insertAccount(client, "PARENT", "invalid-reporter");
      await client.query(`
        INSERT INTO "Report" ("id","reporterAccountId","reason","status","createdAt","updatedAt")
        VALUES ($1,$2,'No derivable target','PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [randomUUID(), reporterId]);
      copyMigrations(root, MIGRATIONS.length);
      const failed = runPrisma(root, database.url, ["migrate", "deploy"]);
      expect(failed.status).not.toBe(0);
      const failedRow = await client.query(`
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL
      `, [MODERATION_MIGRATION]);
      expect(failedRow.rowCount).toBe(1);
      const columns = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Report'
          AND column_name IN ('targetType','targetId','clientRequestId')
      `);
      expect(columns.rowCount).toBe(0);
      const enumType = await client.query(`SELECT 1 FROM pg_type WHERE typname = 'ReportTargetType'`);
      expect(enumType.rowCount).toBe(0);
      const moderationColumn = await client.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'TeacherProfile' AND column_name = 'moderationRejectedAt'
      `);
      expect(moderationColumn.rowCount).toBe(0);
    } finally {
      await client.end().catch(() => undefined);
      await cleanupMigrationWorkspace(root);
    }
  }, 90_000);

  it("serializes concurrent open reports for the same reporter and target", async () => {
    expect(migrationExists()).toBe(true);
    if (!invariantDatabase) return;
    const first = new Client({ connectionString: invariantDatabase.url });
    const second = new Client({ connectionString: invariantDatabase.url });
    try {
      await Promise.all([first.connect(), second.connect()]);
      const reporterId = await insertAccount(first, "PARENT", "open-reporter");
      const subjectId = await insertAccount(first, "TEACHER", "open-subject");
      await first.query("BEGIN");
      await second.query("BEGIN");
      await first.query(`
        INSERT INTO "Report" (
          "id","reporterAccountId","reportedAccountId","targetType","targetId","clientRequestId",
          "reason","status","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,'ACCOUNT',$3,$4,'First open report','PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [randomUUID(), reporterId, subjectId, randomUUID()]);
      const rejected = expect(second.query(`
        INSERT INTO "Report" (
          "id","reporterAccountId","reportedAccountId","targetType","targetId","clientRequestId",
          "reason","status","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,'ACCOUNT',$3,$4,'Concurrent open report','REVIEWING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [randomUUID(), reporterId, subjectId, randomUUID()])).rejects.toMatchObject({ code: "23505" });
      await delay(50);
      await first.query("COMMIT");
      await rejected;
      await second.query("ROLLBACK");

      await expect(first.query(`
        INSERT INTO "Report" (
          "id","reporterAccountId","reportedAccountId","targetType","targetId","reason","status","createdAt","updatedAt"
        ) VALUES ($1,$2,$2,'ACCOUNT',$2,'Self report','RESOLVED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [randomUUID(), reporterId])).rejects.toMatchObject({ code: "23514" });
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      await Promise.all([first.end().catch(() => undefined), second.end().catch(() => undefined)]);
    }
  }, 30_000);

  it("allows historical and multi-reporter greeting reports while keeping each reporter's open report unique", async () => {
    expect(migrationExists()).toBe(true);
    if (!invariantDatabase) return;
    const client = new Client({ connectionString: invariantDatabase.url });
    try {
      await client.connect();
      const teacherId = await insertAccount(client, "TEACHER", "greeting-history-subject");
      const parentId = await insertAccount(client, "PARENT", "greeting-history-reporter");
      const parentProfileId = randomUUID(), requestId = randomUUID(), greetingId = randomUUID();
      await client.query(`
        INSERT INTO "ParentProfile" ("id","accountId","displayName","status","createdAt","updatedAt")
        VALUES ($1,$2,'Greeting history parent','PUBLISHED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [parentProfileId, parentId]);
      await client.query(`
        INSERT INTO "TutoringRequest" ("id","parentProfileId","title","description","status","createdAt","updatedAt")
        VALUES ($1,$2,'Greeting history request','Preserve reports','DRAFT',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [requestId, parentProfileId]);
      await client.query(`
        INSERT INTO "Greeting" (
          "id","senderAccountId","recipientAccountId","tutoringRequestId","contextKey","cardSnapshot",
          "status","expiresAt","respondedAt","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,'{"legacy":true}'::jsonb,'REPORTED',CURRENT_TIMESTAMP + interval '7 days',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [greetingId, teacherId, parentId, requestId, `${teacherId}:${parentId}:${requestId}`]);
      await client.query(`
        INSERT INTO "Report" (
          "id","reporterAccountId","reportedAccountId","tutoringRequestId","greetingId",
          "targetType","targetId","reason","status","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,'GREETING',$5,'Resolved greeting report','RESOLVED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [randomUUID(), parentId, teacherId, requestId, greetingId]);
      const legacy = { teacherId, parentId, requestId, greetingId };
      const reopenedId = randomUUID();
      await client.query(`
        INSERT INTO "Report" (
          "id","reporterAccountId","reportedAccountId","tutoringRequestId","greetingId",
          "targetType","targetId","reason","status","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,'GREETING',$5,'Reopened greeting report','PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [reopenedId, legacy.parentId, legacy.teacherId, legacy.requestId, legacy.greetingId]);

      await expect(client.query(`
        INSERT INTO "Report" (
          "id","reporterAccountId","reportedAccountId","tutoringRequestId","greetingId",
          "targetType","targetId","reason","status","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,'GREETING',$5,'Duplicate open greeting report','REVIEWING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [randomUUID(), legacy.parentId, legacy.teacherId, legacy.requestId, legacy.greetingId]))
        .rejects.toMatchObject({
          code: "23505",
          constraint: "Report_reporterAccountId_targetType_targetId_open_key",
        });

      const otherReporterId = await insertAccount(client, "PARENT", "other-greeting-reporter");
      await client.query(`
        INSERT INTO "Report" (
          "id","reporterAccountId","reportedAccountId","tutoringRequestId","greetingId",
          "targetType","targetId","reason","status","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,'GREETING',$5,'Other reporter greeting report','PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `, [randomUUID(), otherReporterId, legacy.teacherId, legacy.requestId, legacy.greetingId]);

      const history = await client.query(`SELECT "reporterAccountId","status" FROM "Report" WHERE "greetingId" = $1`, [legacy.greetingId]);
      expect(history.rows).toEqual(expect.arrayContaining([
        { reporterAccountId: legacy.parentId, status: "RESOLVED" },
        { reporterAccountId: legacy.parentId, status: "PENDING" },
        { reporterAccountId: otherReporterId, status: "PENDING" },
      ]));
      expect(history.rowCount).toBe(3);
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 30_000);

  it("serializes concurrent pending verifications for one account and type", async () => {
    expect(migrationExists()).toBe(true);
    if (!invariantDatabase) return;
    const first = new Client({ connectionString: invariantDatabase.url });
    const second = new Client({ connectionString: invariantDatabase.url });
    try {
      await Promise.all([first.connect(), second.connect()]);
      const accountId = await insertAccount(first, "TEACHER", "verification-teacher");
      await first.query("BEGIN");
      await second.query("BEGIN");
      await first.query(`
        INSERT INTO "Verification" ("id","accountId","type","status","clientRequestId","updatedAt")
        VALUES ($1,$2,'STUDENT_ID','PENDING',$3,CURRENT_TIMESTAMP)
      `, [randomUUID(), accountId, randomUUID()]);
      const rejected = expect(second.query(`
        INSERT INTO "Verification" ("id","accountId","type","status","clientRequestId","updatedAt")
        VALUES ($1,$2,'STUDENT_ID','PENDING',$3,CURRENT_TIMESTAMP)
      `, [randomUUID(), accountId, randomUUID()])).rejects.toMatchObject({ code: "23505" });
      await delay(50);
      await first.query("COMMIT");
      await rejected;
      await second.query("ROLLBACK");
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      await Promise.all([first.end().catch(() => undefined), second.end().catch(() => undefined)]);
    }
  }, 30_000);

  it("allows audit inserts but rejects update and delete with SQLSTATE 55000", async () => {
    expect(migrationExists()).toBe(true);
    if (!invariantDatabase) return;
    const client = new Client({ connectionString: invariantDatabase.url });
    try {
      await client.connect();
      const adminId = await insertAccount(client, "ADMIN", "audit-admin");
      await client.query("BEGIN");
      const firstAuditId = randomUUID();
      const inserted = await client.query(`
        INSERT INTO "AdminAuditLog" ("id","adminAccountId","requestId","action","targetType","createdAt")
        VALUES ($1,$2,$3,'REPORT_REVIEW','REPORT',CURRENT_TIMESTAMP)
        RETURNING "id"
      `, [firstAuditId, adminId, randomUUID()]);
      expect(inserted.rows[0].id).toBe(firstAuditId);
      await expect(client.query(`UPDATE "AdminAuditLog" SET "action" = 'MUTATED' WHERE "id" = $1`, [firstAuditId]))
        .rejects.toMatchObject({ code: "55000" });
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      const secondAuditId = randomUUID();
      await client.query(`
        INSERT INTO "AdminAuditLog" ("id","adminAccountId","requestId","action","targetType","createdAt")
        VALUES ($1,$2,$3,'USER_STATUS','ACCOUNT',CURRENT_TIMESTAMP)
      `, [secondAuditId, adminId, randomUUID()]);
      await expect(client.query(`DELETE FROM "AdminAuditLog" WHERE "id" = $1`, [secondAuditId]))
        .rejects.toMatchObject({ code: "55000" });
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }, 30_000);

  it("rejects audit truncation with SQLSTATE 55000", async () => {
    expect(migrationExists()).toBe(true);
    if (!invariantDatabase) return;
    const client = new Client({ connectionString: invariantDatabase.url });
    try {
      await client.connect();
      await client.query("BEGIN");
      await expect(client.query(`TRUNCATE "AdminAuditLog"`)).rejects.toMatchObject({ code: "55000" });
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }, 30_000);
});
