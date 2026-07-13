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

import { violatesContactPolicy } from "@/features/safety/contact-policy";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for greeting migration upgrade tests");

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
] as const;
const WORKFLOW_MIGRATION = "20260713133000_greeting_workflow";
const PUBLIC_SAFETY_MIGRATION = "20260713133400_public_content_safety";
const TEMP_WORKSPACE_ROOT = join(tmpdir(), "tutor-platform-greeting-migrations");
const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const tempRoots: string[] = [];
const databases: string[] = [];
const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

type Seed = { teacherId: string; parentId: string; requestId: string; greetingId: string; conversationId: string };

function databaseUrl(name: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function createDatabase() {
  const name = `greeting_migration_${randomUUID().replaceAll("-", "")}`;
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
    timeout: 60_000,
  });
}

function expectPrismaSuccess(result: ReturnType<typeof runPrisma>) {
  expect(result.error).toBeUndefined();
  expect(`${result.stdout}\n${result.stderr}`).toContain("All migrations have been successfully applied");
  expect(result.status).toBe(0);
}

async function seedLegacy(client: Client, withConversation = true): Promise<Seed> {
  const teacherId = randomUUID(), parentId = randomUUID(), parentProfileId = randomUUID();
  const requestId = randomUUID(), greetingId = randomUUID(), conversationId = randomUUID();
  const stamp = new Date("2026-07-01T12:00:00.000Z");
  for (const [id, role, label] of [[teacherId, "TEACHER", "teacher"], [parentId, "PARENT", "parent"]] as const) {
    await client.query(`
      INSERT INTO "Account" ("id","role","username","normalizedUsername","email","normalizedEmail","passwordHash","createdAt","updatedAt")
      VALUES ($1,$2,$3,$3,$4,$4,'hash',$5,$5)
    `, [id, role, `${label}-${id}`, `${label}-${id}@example.test`, stamp]);
  }
  await client.query(`
    INSERT INTO "ParentProfile" ("id","accountId","displayName","status","createdAt","updatedAt")
    VALUES ($1,$2,'Legacy parent','PUBLISHED',$3,$3)
  `, [parentProfileId, parentId, stamp]);
  await client.query(`
    INSERT INTO "TutoringRequest" ("id","parentProfileId","title","description","status","createdAt","updatedAt")
    VALUES ($1,$2,'Legacy request','Preserve me','DRAFT',$3,$3)
  `, [requestId, parentProfileId, stamp]);
  await client.query(`
    INSERT INTO "Greeting" ("id","senderAccountId","recipientAccountId","tutoringRequestId","message","status","createdAt","updatedAt")
    VALUES ($1,$2,$3,$4,'Legacy hello','PENDING',$5,$5)
  `, [greetingId, teacherId, parentId, requestId, stamp]);
  if (withConversation) {
    await client.query(`
      INSERT INTO "Conversation" ("id","greetingId","teacherId","parentId","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$5)
    `, [conversationId, greetingId, teacherId, parentId, stamp]);
  }
  return { teacherId, parentId, requestId, greetingId, conversationId };
}

beforeAll(async () => {
  mkdirSync(TEMP_WORKSPACE_ROOT, { recursive: true });
  const unreclaimed: string[] = [];
  for (const entry of readdirSync(TEMP_WORKSPACE_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const root = join(TEMP_WORKSPACE_ROOT, entry.name);
      if (!await cleanupMigrationWorkspace(root)) unreclaimed.push(root);
    }
  }
  if (unreclaimed.length > 0) {
    process.stderr.write(`Could not reclaim ${unreclaimed.length} prior temporary migration workspace(s); cleanup will be retried after the suite.\n`);
  }
});

afterAll(async () => {
  for (const name of databases.reverse()) {
    await adminPool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
    await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);
  }
  await adminPool.end();
  const leftovers: string[] = [];
  for (const root of tempRoots) {
    if (!await cleanupMigrationWorkspace(root)) leftovers.push(root);
  }
  if (leftovers.length > 0) {
    process.stderr.write(`Prisma still holds ${leftovers.length} temporary migration workspace(s); the next suite run will reclaim them.\n`);
  }
});

describe("greeting workflow migration upgrades", () => {
  it("limits temporary cleanup to random workspaces beneath the dedicated OS temp root", () => {
    expect(isSafeMigrationWorkspace(join(TEMP_WORKSPACE_ROOT, "run-example"))).toBe(true);
    expect(isSafeMigrationWorkspace(TEMP_WORKSPACE_ROOT)).toBe(false);
    expect(isSafeMigrationWorkspace(join(tmpdir(), "another-project", "run-example"))).toBe(false);
  });

  it("deploys all 14 migrations into an empty database", async () => {
    const database = await createDatabase();
    const root = createMigrationWorkspace(MIGRATIONS.length);
    const client = new Client({ connectionString: database.url });
    try {
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      await client.connect();
      const applied = await client.query(`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
      expect(applied.rows[0].count).toBe(14);
    } finally {
      await client.end().catch(() => undefined);
      await cleanupMigrationWorkspace(root);
    }
  }, 60_000);

  it.each([
    { migrationCount: 12, path: "133400 followed by 133500" },
    { migrationCount: 13, path: "133500 backfill" },
  ])("keeps $path equivalent to runtime public-text policy and completeness", async ({ migrationCount }) => {
    const database = await createDatabase();
    const root = createMigrationWorkspace(migrationCount);
    const client = new Client({ connectionString: database.url });
    const stamp = new Date("2026-07-01T12:00:00.000Z");
    const unsafeTeacherTexts = [
      "手机号 13800138000",
      "座机 010-88886666",
      "ＷｈａｔｓＡｐｐ tutor88",
      "We\u200BChat tutor88",
      "WX号 tutor88",
      "VX: tutor88",
      "QQ 123456",
      "扣 扣 123456",
      "TG: tutor88",
      "W h a t s A p p tutor88",
      "Tele gram tutor88",
      "RED ID: tutor88",
      "LINE ID: tutor88",
      "Signal ID: tutor88",
      "请付信息费后联系",
      "需要支付中介费",
      "私聊发资料",
      "联系方式见简介",
    ];
    const unsafeTeachers = unsafeTeacherTexts.map((headline, index) => ({
      key: `unsafe-${index}`,
      displayName: "Legacy unsafe teacher",
      headline,
      bio: "Technical tutoring profile",
      accountId: randomUUID(),
      profileId: randomUUID(),
      expectedStatus: "DRAFT",
      expectedVersion: 0,
    }));
    const safeTeachers = [
      {
        key: "technical",
        displayName: "Node.js teacher",
        headline: "Vue.js and signal processing",
        bio: "Technical tutoring profile",
      },
      {
        key: "zero-width-math",
        displayName: "数学老师",
        headline: "数学\u200B辅导",
        bio: "专注数学思维与解题方法的系统辅导",
      },
    ].map((fixture) => ({
      ...fixture,
      accountId: randomUUID(),
      profileId: randomUUID(),
      expectedStatus: "PUBLISHED",
      expectedVersion: 1,
    }));
    const incompleteTeachers = [
      { key: "blank-name", displayName: "   ", headline: "Safe headline", bio: "Technical tutoring profile" },
      { key: "blank-headline", displayName: "Legacy teacher", headline: "   ", bio: "Technical tutoring profile" },
      { key: "blank-bio", displayName: "Legacy teacher", headline: "Safe headline", bio: "   " },
    ].map((fixture) => ({
      ...fixture,
      accountId: randomUUID(),
      profileId: randomUUID(),
      expectedStatus: "DRAFT",
      expectedVersion: 0,
    }));
    const teacherFixtures = [...unsafeTeachers, ...safeTeachers, ...incompleteTeachers];
    const parentId = randomUUID(), parentProfileId = randomUUID();
    const students = {
      unsafe: { id: randomUUID(), displayName: "LINE ID tutor88", isActive: true },
      safe: { id: randomUUID(), displayName: "Node.js learner", isActive: true },
      blank: { id: randomUUID(), displayName: "   ", isActive: true },
      inactive: { id: randomUUID(), displayName: "Inactive learner", isActive: false },
    };
    const requestFixtures = [
      { key: "unsafe-student", title: "Legacy request", description: "Preserve me", studentId: students.unsafe.id, expectedStatus: "DRAFT", expectedVersion: 0 },
      { key: "safe", title: "Vue.js tutoring", description: "Learn signal processing", studentId: students.safe.id, expectedStatus: "PUBLISHED", expectedVersion: 1 },
      { key: "blank-title", title: "   ", description: "Preserve me", studentId: students.safe.id, expectedStatus: "DRAFT", expectedVersion: 0 },
      { key: "blank-description", title: "Legacy request", description: "   ", studentId: students.safe.id, expectedStatus: "DRAFT", expectedVersion: 0 },
      { key: "blank-student", title: "Legacy request", description: "Preserve me", studentId: students.blank.id, expectedStatus: "DRAFT", expectedVersion: 0 },
      { key: "inactive-student", title: "Legacy request", description: "Preserve me", studentId: students.inactive.id, expectedStatus: "DRAFT", expectedVersion: 0 },
      { key: "missing-student", title: "Legacy request", description: "Preserve me", studentId: null, expectedStatus: "DRAFT", expectedVersion: 0 },
    ].map((fixture) => ({ ...fixture, id: randomUUID() }));
    try {
      for (const text of unsafeTeacherTexts) expect(violatesContactPolicy(text)).toBe(true);
      for (const teacher of safeTeachers) expect(violatesContactPolicy(teacher.headline)).toBe(false);
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      await client.connect();
      for (const [id, role, label] of [
        ...teacherFixtures.map(({ accountId, key }) => [accountId, "TEACHER", `teacher-${key}`] as const),
        [parentId, "PARENT", "parent"],
      ] as const) {
        await client.query(`
          INSERT INTO "Account" ("id","role","username","normalizedUsername","email","normalizedEmail","passwordHash","createdAt","updatedAt")
          VALUES ($1,$2,$3,$3,$4,$4,'hash',$5,$5)
        `, [id, role, `${label}-${id}`, `${label}-${id}@example.test`, stamp]);
      }
      for (const teacher of teacherFixtures) {
        await client.query(`
          INSERT INTO "TeacherProfile" ("id","accountId","displayName","headline","bio","status","publishedAt","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,'PUBLISHED',$6,$6,$6)
        `, [teacher.profileId, teacher.accountId, teacher.displayName, teacher.headline, teacher.bio, stamp]);
      }
      await client.query(`
        INSERT INTO "ParentProfile" ("id","accountId","displayName","status","createdAt","updatedAt")
        VALUES ($1,$2,'Legacy parent','PUBLISHED',$3,$3)
      `, [parentProfileId, parentId, stamp]);
      for (const student of Object.values(students)) {
        await client.query(`
          INSERT INTO "StudentProfile" ("id","parentProfileId","displayName","gradeLevel","isActive","createdAt","updatedAt")
          VALUES ($1,$2,$3,'GRADE_8',$4,$5,$5)
        `, [student.id, parentProfileId, student.displayName, student.isActive, stamp]);
      }
      for (const request of requestFixtures) {
        await client.query(`
          INSERT INTO "TutoringRequest" ("id","parentProfileId","studentProfileId","title","description","status","publishedAt","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,'PUBLISHED',$6,$6,$6)
        `, [request.id, parentProfileId, request.studentId, request.title, request.description, stamp]);
      }

      copyMigrations(root, MIGRATIONS.length);
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      const teachers = await client.query(`SELECT "id","status","publishedAt","publicContentSafetyVersion" FROM "TeacherProfile" ORDER BY "id"`);
      const teacherById = new Map(teachers.rows.map((row) => [row.id, row]));
      for (const teacher of teacherFixtures) {
        expect(teacherById.get(teacher.profileId), teacher.key).toMatchObject({
          status: teacher.expectedStatus,
          publishedAt: teacher.expectedStatus === "PUBLISHED" ? stamp : null,
          publicContentSafetyVersion: teacher.expectedVersion,
        });
      }
      const requests = await client.query(`SELECT "id","status","publishedAt","publicContentSafetyVersion" FROM "TutoringRequest" ORDER BY "id"`);
      const requestById = new Map(requests.rows.map((row) => [row.id, row]));
      for (const request of requestFixtures) {
        expect(requestById.get(request.id), request.key).toMatchObject({
          status: request.expectedStatus,
          publishedAt: request.expectedStatus === "PUBLISHED" ? stamp : null,
          publicContentSafetyVersion: request.expectedVersion,
        });
      }
    } finally {
      await client.end().catch(() => undefined);
      await cleanupMigrationWorkspace(root);
    }
  }, 90_000);

  it("upgrades valid legacy greetings and conversations without deleting data", async () => {
    const database = await createDatabase();
    const root = createMigrationWorkspace(7);
    const client = new Client({ connectionString: database.url });
    try {
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      await client.connect();
      const seed = await seedLegacy(client);
      copyMigrations(root, MIGRATIONS.length);
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));

      const greeting = await client.query(`SELECT "contextKey","cardSnapshot","expiresAt","message" FROM "Greeting" WHERE id = $1`, [seed.greetingId]);
      expect(greeting.rowCount).toBe(1);
      expect(greeting.rows[0]).toMatchObject({
        contextKey: `${seed.teacherId}:${seed.parentId}:${seed.requestId}`,
        cardSnapshot: { legacy: true },
        message: "Legacy hello",
        expiresAt: new Date("2026-07-08T12:00:00.000Z"),
      });
      const conversation = await client.query(`SELECT "tutoringRequestId" FROM "Conversation" WHERE id = $1`, [seed.conversationId]);
      expect(conversation.rows[0].tutoringRequestId).toBe(seed.requestId);
    } finally {
      await client.end().catch(() => undefined);
      await cleanupMigrationWorkspace(root);
    }
  }, 60_000);

  it.each(["reverse-duplicate", "invalid-participants"] as const)(
    "rolls back %s before DDL and succeeds after legacy repair",
    async (failure) => {
      const database = await createDatabase();
      const root = createMigrationWorkspace(7);
      const client = new Client({ connectionString: database.url });
      try {
        expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
        await client.connect();
        const seed = await seedLegacy(client, false);
        let badGreetingId: string;
        if (failure === "reverse-duplicate") {
          badGreetingId = randomUUID();
          await client.query(`
            INSERT INTO "Greeting" ("id","senderAccountId","recipientAccountId","tutoringRequestId","status","createdAt","updatedAt")
            VALUES ($1,$2,$3,$4,'PENDING',$5,$5)
          `, [badGreetingId, seed.parentId, seed.teacherId, seed.requestId, new Date("2026-07-02T12:00:00.000Z")]);
        } else {
          const secondTeacherId = randomUUID();
          await client.query(`
            INSERT INTO "Account" ("id","role","username","normalizedUsername","email","normalizedEmail","passwordHash","createdAt","updatedAt")
            VALUES ($1,'TEACHER',$2,$2,$3,$3,'hash',$4,$4)
          `, [secondTeacherId, `teacher-${secondTeacherId}`, `teacher-${secondTeacherId}@example.test`, new Date("2026-07-01T12:00:00.000Z")]);
          await client.query(`UPDATE "Greeting" SET "recipientAccountId" = $1 WHERE id = $2`, [secondTeacherId, seed.greetingId]);
          badGreetingId = seed.greetingId;
        }
        copyMigrations(root, MIGRATIONS.length);
        const failed = runPrisma(root, database.url, ["migrate", "deploy"]);
        expect(failed.status).not.toBe(0);
        const failedRow = await client.query(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL`, [WORKFLOW_MIGRATION]);
        expect(failedRow.rowCount).toBe(1);
        const column = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Greeting' AND column_name = 'contextKey'`);
        expect(column.rowCount).toBe(0);

        if (failure === "reverse-duplicate") {
          await client.query(`DELETE FROM "Greeting" WHERE id = $1`, [badGreetingId]);
        } else {
          await client.query(`UPDATE "Greeting" SET "recipientAccountId" = $1 WHERE id = $2`, [seed.parentId, badGreetingId]);
        }
        const resolved = runPrisma(root, database.url, ["migrate", "resolve", "--rolled-back", WORKFLOW_MIGRATION]);
        expect(resolved.error).toBeUndefined();
        expect(resolved.status).toBe(0);
        expect(`${resolved.stdout}\n${resolved.stderr}`).toContain("marked as rolled back");
        expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
        const migrated = await client.query(`SELECT "contextKey" FROM "Greeting" WHERE id = $1`, [seed.greetingId]);
        expect(migrated.rows[0].contextKey).toBe(`${seed.teacherId}:${seed.parentId}:${seed.requestId}`);
      } finally {
        await client.end().catch(() => undefined);
        await cleanupMigrationWorkspace(root);
      }
    },
    90_000,
  );

  it("locks public writers before the 133400 scan and demotes an in-flight unsafe commit", async () => {
    const database = await createDatabase();
    const root = createMigrationWorkspace(12);
    const writer = new Client({ connectionString: database.url });
    const migrator = new Client({ connectionString: database.url });
    const observer = new Client({ connectionString: database.url });
    const accountId = randomUUID(), profileId = randomUUID();
    const stamp = new Date("2026-07-01T12:00:00.000Z");
    let migration: Promise<unknown> | undefined;
    try {
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      await Promise.all([writer.connect(), migrator.connect(), observer.connect()]);
      await writer.query(`
        INSERT INTO "Account" ("id","role","username","normalizedUsername","email","normalizedEmail","passwordHash","createdAt","updatedAt")
        VALUES ($1,'TEACHER',$2,$2,$3,$3,'hash',$4,$4)
      `, [accountId, `lock-teacher-${accountId}`, `lock-teacher-${accountId}@example.test`, stamp]);
      await writer.query(`
        INSERT INTO "TeacherProfile" ("id","accountId","displayName","headline","bio","status","publishedAt","createdAt","updatedAt")
        VALUES ($1,$2,'Lock teacher','Safe headline','Technical tutoring','PUBLISHED',$3,$3,$3)
      `, [profileId, accountId, stamp]);
      await writer.query("BEGIN");
      await writer.query(`UPDATE "TeacherProfile" SET "headline" = $1 WHERE "id" = $2`, ["We\u200BChat tutor88", profileId]);

      const migratorPid = Number((await migrator.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      const sql = readFileSync(join(process.cwd(), "prisma", "migrations", PUBLIC_SAFETY_MIGRATION, "migration.sql"), "utf8");
      migration = migrator.query(sql);
      let waitingModes: string[] = [];
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const locks = await observer.query<{ mode: string }>(`
          SELECT mode FROM pg_locks
          WHERE pid = $1
            AND relation = '"TeacherProfile"'::regclass
            AND NOT granted
        `, [migratorPid]);
        waitingModes = locks.rows.map(({ mode }) => mode);
        if (waitingModes.length) break;
        await delay(25);
      }
      expect(waitingModes).toContain("ShareRowExclusiveLock");

      await writer.query("COMMIT");
      await migration;
      const migrated = await observer.query(`SELECT "status","publishedAt" FROM "TeacherProfile" WHERE "id" = $1`, [profileId]);
      expect(migrated.rows[0]).toMatchObject({ status: "DRAFT", publishedAt: null });
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      await migration?.catch(() => undefined);
      await Promise.all([
        writer.end().catch(() => undefined),
        migrator.end().catch(() => undefined),
        observer.end().catch(() => undefined),
      ]);
      await cleanupMigrationWorkspace(root);
    }
  }, 60_000);

  it("locks legacy write tables before preflight and migrates a transaction that was already in flight", async () => {
    const database = await createDatabase();
    const root = createMigrationWorkspace(8);
    const writer = new Client({ connectionString: database.url });
    const migrator = new Client({ connectionString: database.url });
    const observer = new Client({ connectionString: database.url });
    let migration: Promise<unknown> | undefined;
    try {
      expectPrismaSuccess(runPrisma(root, database.url, ["migrate", "deploy"]));
      await Promise.all([writer.connect(), migrator.connect(), observer.connect()]);
      const seed = await seedLegacy(writer);
      await writer.query("BEGIN");
      await writer.query(`UPDATE "Greeting" SET message = 'Committed legacy write' WHERE id = $1`, [seed.greetingId]);
      const migratorPid = Number((await migrator.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      const sql = readFileSync(join(process.cwd(), "prisma", "migrations", WORKFLOW_MIGRATION, "migration.sql"), "utf8");
      migration = migrator.query(sql);

      let waitingModes: string[] = [];
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const locks = await observer.query<{ mode: string }>(`
          SELECT mode
          FROM pg_locks
          WHERE pid = $1
            AND relation = '"Greeting"'::regclass
            AND NOT granted
        `, [migratorPid]);
        waitingModes = locks.rows.map(({ mode }) => mode);
        if (waitingModes.length) break;
        await delay(25);
      }
      expect(waitingModes).toContain("ShareRowExclusiveLock");

      await writer.query("COMMIT");
      await migration;
      const migrated = await observer.query(`SELECT message, "contextKey" FROM "Greeting" WHERE id = $1`, [seed.greetingId]);
      expect(migrated.rows[0]).toMatchObject({
        message: "Committed legacy write",
        contextKey: `${seed.teacherId}:${seed.parentId}:${seed.requestId}`,
      });
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      await migration?.catch(() => undefined);
      await Promise.all([
        writer.end().catch(() => undefined),
        migrator.end().catch(() => undefined),
        observer.end().catch(() => undefined),
      ]);
      await cleanupMigrationWorkspace(root);
    }
  }, 60_000);
});
