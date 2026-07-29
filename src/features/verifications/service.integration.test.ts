// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createLocalPrivateEvidenceStorage } from "./storage";
import {
  createPrismaVerificationRepository,
  createVerificationService,
  type VerificationRepository,
} from "./service";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

describe("teacher verification submissions against PostgreSQL", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const accountIds: string[] = [];
  let teacherId = "";
  let teacherProfileId = "";
  let parentId = "";
  let uploadRoot = "";

  async function makeAccount(role: "TEACHER" | "PARENT", label: string) {
    const name = `${label}-${marker}`;
    const account = await prisma.account.create({ data: {
      role,
      username: name,
      normalizedUsername: name,
      email: `${name}@private.example`,
      normalizedEmail: `${name}@private.example`,
      passwordHash: "synthetic-test-only",
    } });
    accountIds.push(account.id);
    return account;
  }

  async function jpeg(color = { r: 20, g: 50, b: 80 }) {
    return sharp({ create: { width: 20, height: 16, channels: 3, background: color } }).jpeg().toBuffer();
  }

  function service(root = uploadRoot, repository: VerificationRepository = createPrismaVerificationRepository(prisma)) {
    return createVerificationService(repository, createLocalPrivateEvidenceStorage({ rootDir: root, nodeEnv: "test" }));
  }

  beforeAll(async () => {
    uploadRoot = await mkdtemp(join(tmpdir(), "tutor-verification-integration-"));
    const teacher = await makeAccount("TEACHER", "verification-teacher");
    teacherId = teacher.id;
    const profile = await prisma.teacherProfile.create({ data: {
      accountId: teacher.id,
      displayName: "认证测试老师",
      status: "DRAFT",
    } });
    teacherProfileId = profile.id;
    parentId = (await makeAccount("PARENT", "verification-parent")).id;
  });

  beforeEach(async () => {
    await prisma.verification.deleteMany({ where: { accountId: { in: accountIds } } });
    await rm(uploadRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    await prisma.verification.deleteMany({ where: { accountId: { in: accountIds } } });
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await rm(uploadRoot, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("persists private evidence transactionally and provides safe idempotent replay", async () => {
    const verificationService = service();
    const clientRequestId = crypto.randomUUID();
    const bytes = await jpeg();
    const input = { type: "STUDENT_STATUS" as const, clientRequestId, file: { bytes, mimeType: "image/jpeg" } };
    const first = await verificationService.submit({ id: teacherId, role: "teacher" }, input);
    const replay = await verificationService.submit({ id: teacherId, role: "teacher" }, input);

    expect(replay).toEqual(first);
    expect(await prisma.verification.count({ where: { accountId: teacherId } })).toBe(1);
    expect(await readdir(uploadRoot)).toHaveLength(1);
    const persisted = await prisma.verification.findUniqueOrThrow({
      where: { accountId_clientRequestId: { accountId: teacherId, clientRequestId } },
    });
    expect(persisted).toMatchObject({ accountId: teacherId, teacherProfileId, type: "STUDENT_STATUS", status: "PENDING" });
    expect(persisted.evidence).toMatchObject({
      provider: "local-private",
      key: expect.stringMatching(/^[a-f0-9]{64}\.jpg$/),
      mimeType: "image/jpeg",
      byteSize: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const serialized = JSON.stringify([first, replay, await verificationService.list({ id: teacherId, role: "teacher" })]);
    expect(serialized).not.toContain(teacherId);
    expect(serialized).not.toContain(teacherProfileId);
    expect(serialized).not.toContain(clientRequestId);
    expect(serialized).not.toMatch(/evidence|key|path|sha256|byteSize/i);
  });

  it("rejects replay payload changes and another pending request, then allows rejected resubmission", async () => {
    const verificationService = service();
    const firstRequest = crypto.randomUUID();
    await verificationService.submit({ id: teacherId, role: "teacher" }, {
      type: "EDUCATION", clientRequestId: firstRequest,
      file: { bytes: await jpeg(), mimeType: "image/jpeg" },
    });
    await expect(verificationService.submit({ id: teacherId, role: "teacher" }, {
      type: "EDUCATION", clientRequestId: firstRequest,
      file: { bytes: await jpeg({ r: 100, g: 80, b: 60 }), mimeType: "image/jpeg" },
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(verificationService.submit({ id: teacherId, role: "teacher" }, {
      type: "EDUCATION", clientRequestId: crypto.randomUUID(),
      file: { bytes: await jpeg(), mimeType: "image/jpeg" },
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readdir(uploadRoot)).toHaveLength(1);

    await prisma.verification.updateMany({
      where: { accountId: teacherId, type: "EDUCATION" },
      data: { status: "REJECTED", reviewedAt: new Date(), reviewNote: "合成测试拒绝" },
    });
    await expect(verificationService.submit({ id: teacherId, role: "teacher" }, {
      type: "EDUCATION", clientRequestId: crypto.randomUUID(),
      file: { bytes: await jpeg(), mimeType: "image/jpeg" },
    })).resolves.toMatchObject({ type: "EDUCATION", status: "PENDING" });
    expect(await prisma.verification.count({ where: { accountId: teacherId, type: "EDUCATION" } })).toBe(2);
  });

  it("lets the database partial unique constraint choose one concurrent pending submission and cleans losers", async () => {
    const verificationService = service();
    const bytes = await jpeg();
    const settled = await Promise.allSettled(Array.from({ length: 6 }, () => verificationService.submit(
      { id: teacherId, role: "teacher" },
      { type: "TEACHER_QUALIFICATION", clientRequestId: crypto.randomUUID(), file: { bytes, mimeType: "image/jpeg" } },
    )));
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(5);
    for (const outcome of settled.filter((item) => item.status === "rejected")) {
      expect(outcome.reason).toMatchObject({ code: "CONFLICT" });
    }
    expect(await prisma.verification.count({
      where: { accountId: teacherId, type: "TEACHER_QUALIFICATION", status: "PENDING" },
    })).toBe(1);
    expect(await readdir(uploadRoot)).toHaveLength(1);
  });

  it("safely replays concurrent identical client requests without orphaning either key", async () => {
    const verificationService = service();
    const clientRequestId = crypto.randomUUID();
    const bytes = await jpeg();
    const settled = await Promise.allSettled(Array.from({ length: 4 }, () => verificationService.submit(
      { id: teacherId, role: "teacher" },
      { type: "STUDENT_STATUS", clientRequestId, file: { bytes, mimeType: "image/jpeg" } },
    )));
    expect(settled.every(({ status }) => status === "fulfilled")).toBe(true);
    expect(new Set(settled.map((result) => result.status === "fulfilled" && result.value!.id)).size).toBe(1);
    const row = await prisma.verification.findUniqueOrThrow({
      where: { accountId_clientRequestId: { accountId: teacherId, clientRequestId } },
    });
    const files = await readdir(uploadRoot);
    expect(files).toEqual([(row.evidence as { key: string }).key]);
  });

  it("controls concurrent conflicting replays without deleting the winner or leaving an orphan", async () => {
    const verificationService = service();
    const clientRequestId = crypto.randomUUID();
    const settled = await Promise.allSettled([
      verificationService.submit({ id: teacherId, role: "teacher" }, {
        type: "EDUCATION", clientRequestId,
        file: { bytes: await jpeg({ r: 1, g: 2, b: 3 }), mimeType: "image/jpeg" },
      }),
      verificationService.submit({ id: teacherId, role: "teacher" }, {
        type: "EDUCATION", clientRequestId,
        file: { bytes: await jpeg({ r: 200, g: 180, b: 160 }), mimeType: "image/jpeg" },
      }),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(settled.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    const row = await prisma.verification.findUniqueOrThrow({
      where: { accountId_clientRequestId: { accountId: teacherId, clientRequestId } },
    });
    expect(await readdir(uploadRoot)).toEqual([(row.evidence as { key: string }).key]);
  });

  it("revalidates ACTIVE TEACHER ownership and requires a TeacherProfile", async () => {
    const verificationService = service();
    const submission = () => ({
      type: "STUDENT_STATUS" as const,
      clientRequestId: crypto.randomUUID(),
      file: { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: "image/jpeg" },
    });
    await expect(verificationService.submit({ id: parentId, role: "teacher" }, submission()))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await prisma.account.update({ where: { id: teacherId }, data: { status: "SUSPENDED" } });
    await expect(verificationService.submit({ id: teacherId, role: "teacher" }, submission()))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(verificationService.list({ id: teacherId, role: "teacher" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await prisma.account.update({ where: { id: teacherId }, data: { status: "ACTIVE" } });
    await prisma.teacherProfile.delete({ where: { id: teacherProfileId } });
    await expect(verificationService.submit({ id: teacherId, role: "teacher" }, submission()))
      .rejects.toMatchObject({ code: "PROFILE_REQUIRED" });
    teacherProfileId = (await prisma.teacherProfile.create({ data: {
      accountId: teacherId, displayName: "认证测试老师", status: "DRAFT",
    } })).id;
    await expect(readdir(uploadRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back the database row and deletes evidence when persistence fails", async () => {
    const rootRepository = createPrismaVerificationRepository(prisma);
    const failingRepository: VerificationRepository = {
      ...rootRepository,
      transaction(operation) {
        return rootRepository.transaction((transaction) => operation({
          ...transaction,
          async create(input) {
            await transaction.create(input);
            throw new Error("synthetic failure after database insert");
          },
        }));
      },
    };
    await expect(service(uploadRoot, failingRepository).submit({ id: teacherId, role: "teacher" }, {
      type: "STUDENT_STATUS",
      clientRequestId: crypto.randomUUID(),
      file: { bytes: await jpeg(), mimeType: "image/jpeg" },
    })).rejects.toThrow("synthetic failure after database insert");
    expect(await prisma.verification.count({ where: { accountId: teacherId } })).toBe(0);
    await expect(readdir(uploadRoot)).resolves.toHaveLength(0);
  });
});
