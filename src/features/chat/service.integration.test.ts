// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encodeMessageCursor } from "./schema";
import { createChatService } from "./service";
import { lockAccountPair } from "@/features/interactions/account-pair-lock";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for chat integration tests");

describe("chat service against PostgreSQL", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const fixedNow = new Date("2026-07-13T12:00:00.000Z");
  const service = createChatService(prisma, () => fixedNow);
  const teacher = { id: crypto.randomUUID(), role: "teacher" as const };
  const parent = { id: crypto.randomUUID(), role: "parent" as const };
  const outsider = { id: crypto.randomUUID(), role: "teacher" as const };
  let parentProfileId = "";
  let requestId = "";
  let greetingId = "";
  let conversationId = "";

  async function waitForAdvisoryWaiters(minimum: number) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count
        FROM pg_locks
        WHERE locktype = 'advisory' AND granted = false
      `;
      if (rows[0].count >= minimum) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`expected at least ${minimum} waiting advisory lock(s)`);
  }

  async function createAccount(id: string, role: "TEACHER" | "PARENT", label: string) {
    await prisma.account.create({ data: {
      id,
      role,
      username: `${label}-${marker}`,
      normalizedUsername: `${label}-${marker}`,
      email: `${label}-${marker}@private.example`,
      normalizedEmail: `${label}-${marker}@private.example`,
      passwordHash: `private-hash-${label}`,
    } });
  }

  beforeAll(async () => {
    await createAccount(teacher.id, "TEACHER", "chat-teacher");
    await createAccount(parent.id, "PARENT", "chat-parent");
    await createAccount(outsider.id, "TEACHER", "chat-outsider");
    await prisma.teacherProfile.create({ data: { accountId: teacher.id, displayName: "林老师" } });
    await prisma.teacherProfile.create({ data: { accountId: outsider.id, displayName: "外部老师" } });
    const parentProfile = await prisma.parentProfile.create({ data: { accountId: parent.id, displayName: "陈家长" } });
    parentProfileId = parentProfile.id;
    const request = await prisma.tutoringRequest.create({ data: {
      parentProfileId,
      title: "初二数学巩固",
      description: "站内沟通测试",
    } });
    requestId = request.id;
    const greeting = await prisma.greeting.create({ data: {
      senderAccountId: teacher.id,
      recipientAccountId: parent.id,
      tutoringRequestId: requestId,
      contextKey: `${teacher.id}:${parent.id}:${requestId}`,
      cardSnapshot: { legacy: true },
      status: "ACCEPTED",
      respondedAt: new Date("2026-07-13T09:00:00.000Z"),
      expiresAt: new Date("2026-07-20T09:00:00.000Z"),
      createdAt: new Date("2026-07-13T08:00:00.000Z"),
    } });
    greetingId = greeting.id;
    const conversation = await prisma.conversation.create({ data: {
      greetingId,
      teacherId: teacher.id,
      parentId: parent.id,
      tutoringRequestId: requestId,
      createdAt: new Date("2026-07-13T09:00:00.000Z"),
    } });
    conversationId = conversation.id;
  });

  beforeEach(async () => {
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.block.deleteMany({ where: { OR: [
      { blockerAccountId: teacher.id, blockedAccountId: parent.id },
      { blockerAccountId: parent.id, blockedAccountId: teacher.id },
    ] } });
    await prisma.account.updateMany({ where: { id: { in: [teacher.id, parent.id, outsider.id] } }, data: { status: "ACTIVE" } });
    await prisma.greeting.update({ where: { id: greetingId }, data: { status: "ACCEPTED", respondedAt: new Date("2026-07-13T09:00:00.000Z") } });
    await prisma.conversation.update({ where: { id: conversationId }, data: {
      teacherId: teacher.id,
      parentId: parent.id,
      tutoringRequestId: requestId,
      lastMessageAt: null,
    } });
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { conversation: { OR: [{ teacherId: teacher.id }, { parentId: parent.id }] } } });
    await prisma.conversation.deleteMany({ where: { OR: [{ teacherId: teacher.id }, { parentId: parent.id }] } });
    await prisma.greeting.deleteMany({ where: { OR: [{ senderAccountId: teacher.id }, { recipientAccountId: parent.id }] } });
    await prisma.block.deleteMany({ where: { OR: [
      { blockerAccountId: { in: [teacher.id, parent.id, outsider.id] } },
      { blockedAccountId: { in: [teacher.id, parent.id, outsider.id] } },
    ] } });
    await prisma.tutoringRequest.deleteMany({ where: { parentProfileId } });
    await prisma.parentProfile.deleteMany({ where: { id: parentProfileId } });
    await prisma.teacherProfile.deleteMany({ where: { accountId: { in: [teacher.id, outsider.id] } } });
    await prisma.account.deleteMany({ where: { id: { in: [teacher.id, parent.id, outsider.id] } } });
    await prisma.$disconnect();
  });

  it("lists only valid accepted conversations for active, role-matching members through safe DTOs", async () => {
    const parentPage = await service.listConversations(parent, {});
    const teacherPage = await service.listConversations(teacher, {});

    expect(parentPage.items).toEqual([expect.objectContaining({
      id: conversationId,
      counterpart: { role: "teacher", displayName: "林老师" },
      request: { id: requestId, title: "初二数学巩固" },
      unreadCount: 0,
      blocked: false,
    })]);
    expect(teacherPage.items[0].counterpart).toEqual({ role: "parent", displayName: "陈家长" });
    const payload = JSON.stringify({ parentPage, teacherPage });
    expect(payload).not.toContain("private.example");
    expect(payload).not.toContain("private-hash");
    expect(payload).not.toContain(teacher.id);
    expect(payload).not.toContain(parent.id);

    await expect(service.listMessages(outsider, conversationId, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.listConversations({ id: parent.id, role: "teacher" }, {})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await prisma.account.update({ where: { id: parent.id }, data: { status: "DISABLED" } });
    await expect(service.listConversations(parent, {})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("blocks the counterpart through the conversation entry point idempotently and exposes blocked in the safe DTO", async () => {
    await expect(service.blockConversation(parent, conversationId, { reason: "不希望继续沟通" }))
      .resolves.toEqual({ blocked: true });
    await expect(service.blockConversation(parent, conversationId, { reason: "不希望继续沟通" }))
      .resolves.toEqual({ blocked: true });

    await expect(prisma.block.count({ where: {
      blockerAccountId: parent.id,
      blockedAccountId: teacher.id,
    } })).resolves.toBe(1);
    expect((await service.listConversations(parent, {})).items[0].blocked).toBe(true);
    await expect(service.listMessages(parent, conversationId, {})).resolves.toMatchObject({ items: [] });
  });

  it("sends from the authenticated actor, trims safely, updates activity, and enforces exact idempotency", async () => {
    const clientMessageId = crypto.randomUUID();
    const first = await service.sendMessage(teacher, conversationId, {
      clientMessageId,
      body: "  第一行\n\n第二行  ",
    });
    const repeated = await service.sendMessage(teacher, conversationId, {
      clientMessageId,
      body: "第一行\n\n第二行",
    });

    expect(repeated).toEqual(first);
    expect(first).toMatchObject({ clientMessageId, body: "第一行\n\n第二行", mine: true, sentAt: fixedNow.toISOString() });
    await expect(prisma.message.count({ where: { conversationId } })).resolves.toBe(1);
    await expect(prisma.message.findUniqueOrThrow({ where: { id: first.id } })).resolves.toMatchObject({ senderAccountId: teacher.id });
    await expect(prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).resolves.toMatchObject({ lastMessageAt: fixedNow });

    await expect(service.sendMessage(teacher, conversationId, { clientMessageId, body: "不同正文" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.sendMessage(parent, conversationId, { clientMessageId, body: "第一行\n\n第二行" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("replays an exact committed message after block while rejecting conflicts and new sends", async () => {
    const clientMessageId = crypto.randomUUID();
    const first = await service.sendMessage(teacher, conversationId, {
      clientMessageId,
      body: "  已经提交的消息  ",
    });
    await prisma.block.create({ data: { blockerAccountId: parent.id, blockedAccountId: teacher.id } });

    const replayed = await service.sendMessage(teacher, conversationId, {
      clientMessageId,
      body: "已经提交的消息",
    });

    expect(replayed).toEqual(first);
    await expect(prisma.message.count({ where: { conversationId } })).resolves.toBe(1);
    await expect(service.sendMessage(teacher, conversationId, { clientMessageId, body: "冲突正文" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.sendMessage(parent, conversationId, { clientMessageId, body: "已经提交的消息" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.sendMessage(teacher, conversationId, {
      clientMessageId: crypto.randomUUID(),
      body: "屏蔽后的新消息",
    })).rejects.toMatchObject({ code: "BLOCKED" });
  });

  it.each([
    ["teacher blocks parent", () => ({ blockerAccountId: teacher.id, blockedAccountId: parent.id })],
    ["parent blocks teacher", () => ({ blockerAccountId: parent.id, blockedAccountId: teacher.id })],
  ] as const)("prevents both directions from sending when %s while preserving history", async (_label, blockedPair) => {
    await prisma.message.create({ data: {
      conversationId,
      senderAccountId: teacher.id,
      clientMessageId: crypto.randomUUID(),
      body: "屏蔽前历史",
      sentAt: new Date("2026-07-13T10:00:00.000Z"),
    } });
    await prisma.block.create({ data: blockedPair() });

    await expect(service.sendMessage(teacher, conversationId, { clientMessageId: crypto.randomUUID(), body: "不能发送" }))
      .rejects.toMatchObject({ code: "BLOCKED" });
    await expect(service.sendMessage(parent, conversationId, { clientMessageId: crypto.randomUUID(), body: "也不能发送" }))
      .rejects.toMatchObject({ code: "BLOCKED" });
    await expect(service.listMessages(parent, conversationId, {})).resolves.toMatchObject({
      items: [expect.objectContaining({ body: "屏蔽前历史" })],
    });
  });

  it("serializes product block and send services behind the same canonical pair lock", async () => {
    let announceLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => { announceLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const outerLock = prisma.$transaction(async (transaction) => {
      await lockAccountPair(transaction, teacher.id, parent.id);
      announceLocked();
      await release;
    });
    await locked;
    const block = service.blockConversation(parent, conversationId, { reason: "停止往来" });
    await waitForAdvisoryWaiters(1);
    let settled = false;
    const send = service.sendMessage(teacher, conversationId, {
      clientMessageId: crypto.randomUUID(),
      body: "不能越过并发屏蔽",
    }).finally(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    releaseLock();
    await outerLock;
    await expect(block).resolves.toEqual({ blocked: true });
    await expect(send).rejects.toMatchObject({ code: "BLOCKED" });
    await expect(prisma.message.count({ where: { conversationId } })).resolves.toBe(0);
  });

  it("paginates history before and polling after with chronological tie-stable cursors", async () => {
    const firstAt = new Date("2026-07-13T10:00:00.000Z");
    const secondAt = new Date("2026-07-13T11:00:00.000Z");
    const ids = Array.from({ length: 5 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    await prisma.message.createMany({ data: ids.map((id, index) => ({
      id,
      conversationId,
      senderAccountId: index % 2 === 0 ? teacher.id : parent.id,
      clientMessageId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      body: `消息${index + 1}`,
      sentAt: index < 3 ? firstAt : secondAt,
    })) });

    const latest = await service.listMessages(parent, conversationId, { limit: 2 });
    expect(latest.items.map(({ id }) => id)).toEqual([ids[3], ids[4]]);
    expect(latest.nextBeforeCursor).toEqual(expect.any(String));
    const middle = await service.listMessages(parent, conversationId, { limit: 2, before: latest.nextBeforeCursor! });
    expect(middle.items.map(({ id }) => id)).toEqual([ids[1], ids[2]]);
    const oldest = await service.listMessages(parent, conversationId, { limit: 2, before: middle.nextBeforeCursor! });
    expect(oldest.items.map(({ id }) => id)).toEqual([ids[0]]);
    expect(oldest.nextBeforeCursor).toBeNull();

    const after = encodeMessageCursor({ sentAt: firstAt, id: ids[1] });
    const polled = await service.listMessages(parent, conversationId, { limit: 100, after });
    expect(polled.items.map(({ id }) => id)).toEqual([ids[2], ids[3], ids[4]]);
    expect(polled.nextAfterCursor).toBe(encodeMessageCursor({ sentAt: secondAt, id: ids[4] }));
  });

  it("returns an empty-history sequence watermark without exposing bigint in JSON", async () => {
    const page = await service.listMessages(parent, conversationId, {});
    expect(page.items).toEqual([]);
    expect(page.nextAfterCursor).toBe(encodeMessageCursor({
      sentAt: new Date(0),
      id: "00000000-0000-0000-0000-000000000000",
    }));
    expect(page.nextChangesCursor).toMatch(/^[1-9][0-9]*$/u);
    expect(BigInt(page.nextChangesCursor!)).toBeGreaterThan(BigInt(0));
    expect(() => JSON.stringify(page)).not.toThrow();
    expect(JSON.stringify(page)).not.toContain("changeVersion");
  });

  it("observes a raw mutation from a transaction that began before the initial watermark but writes after it", async () => {
    const delayed = await prisma.message.create({ data: {
      conversationId,
      senderAccountId: teacher.id,
      clientMessageId: crypto.randomUUID(),
      body: "延迟事务原文",
      sentAt: new Date("2026-07-13T10:00:00.000Z"),
    } });
    const writer = new Client({ connectionString: process.env.DATABASE_URL! });
    await writer.connect();
    try {
      await writer.query("BEGIN");
      const initial = await service.listMessages(parent, conversationId, {});
      await writer.query(`
        UPDATE "Message"
        SET "body" = '延迟事务变更', "editedAt" = $1, "updatedAt" = $1
        WHERE "id" = $2
      `, [new Date("2000-01-01T00:00:00.000Z"), delayed.id]);
      await writer.query("COMMIT");

      const polled = await service.listMessages(parent, conversationId, {
        changesAfter: initial.nextChangesCursor!,
      });
      expect(polled.items).toEqual([expect.objectContaining({ id: delayed.id, body: "延迟事务变更" })]);
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      await writer.end().catch(() => undefined);
    }
  });

  it("marks only the presented counterpart ids with server time and leaves a concurrent unseen message unread", async () => {
    const presented = await prisma.message.create({ data: {
        conversationId,
        senderAccountId: teacher.id,
        clientMessageId: crypto.randomUUID(),
        body: "已呈现消息",
        sentAt: new Date("2026-07-13T10:00:00.000Z"),
    } });
    const initial = await service.listMessages(parent, conversationId, {});
    expect(initial.items.map(({ id }) => id)).toEqual([presented.id]);
    const unseen = await prisma.message.create({ data: {
      conversationId,
      senderAccountId: teacher.id,
      clientMessageId: crypto.randomUUID(),
      body: "尚未呈现的并发消息",
      sentAt: new Date("2026-07-13T10:01:00.000Z"),
    } });
    const own = await prisma.message.create({ data: {
      conversationId,
      senderAccountId: parent.id,
      clientMessageId: crypto.randomUUID(),
      body: "自己的消息",
      sentAt: new Date("2026-07-13T10:02:00.000Z"),
    } });

    expect((await service.listConversations(parent, {})).items[0].unreadCount).toBe(2);
    await expect(service.markRead(parent, conversationId, { messageIds: [presented.id, own.id] }))
      .resolves.toEqual({ readCount: 1, readAt: fixedNow.toISOString() });
    await expect(prisma.message.findUniqueOrThrow({ where: { id: presented.id } })).resolves.toMatchObject({ readAt: fixedNow, updatedAt: fixedNow });
    await expect(prisma.message.findUniqueOrThrow({ where: { id: unseen.id } })).resolves.toMatchObject({ readAt: null });
    await expect(prisma.message.findUniqueOrThrow({ where: { id: own.id } })).resolves.toMatchObject({ readAt: null });
    expect((await service.listConversations(parent, {})).items[0].unreadCount).toBe(1);
  });

  it("does not lose a later same-millisecond mutation whose UUID sorts below the prior change", async () => {
    const highId = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    const lowId = "01000000-0000-4000-8000-000000000001";
    await prisma.message.createMany({ data: [highId, lowId].map((id) => ({
      id,
      conversationId,
      senderAccountId: parent.id,
      clientMessageId: crypto.randomUUID(),
      body: id === highId ? "高 UUID" : "低 UUID",
      sentAt: new Date("2026-07-13T10:00:00.000Z"),
    })) });
    const initial = await service.listMessages(teacher, conversationId, {});
    const sameMillisecond = new Date("2026-07-13T12:30:00.000Z");
    await prisma.$executeRaw`UPDATE "Message" SET "editedAt" = ${sameMillisecond}, "updatedAt" = ${sameMillisecond} WHERE "id" = ${highId}::uuid`;
    const first = await service.listMessages(teacher, conversationId, {
      changesAfter: initial.nextChangesCursor!,
      limit: 1,
    });
    expect(first.items.map(({ id }) => id)).toEqual([highId]);

    await prisma.$executeRaw`UPDATE "Message" SET "editedAt" = ${sameMillisecond}, "updatedAt" = ${sameMillisecond} WHERE "id" = ${lowId}::uuid`;
    const second = await service.listMessages(teacher, conversationId, {
      changesAfter: first.nextChangesCursor!,
      limit: 1,
    });
    expect(second.items.map(({ id }) => id)).toEqual([lowId]);
  });

  it("overwrites client-supplied versions on raw inserts and updates", async () => {
    const id = crypto.randomUUID();
    const inserted = await prisma.$queryRaw<Array<{ changeVersion: bigint }>>`
      INSERT INTO "Message" (
        "id", "conversationId", "senderAccountId", "clientMessageId", "body", "changeVersion"
      ) VALUES (
        ${id}::uuid, ${conversationId}::uuid, ${teacher.id}::uuid, ${crypto.randomUUID()}, 'raw insert', 0
      )
      RETURNING "changeVersion"
    `;
    const updated = await prisma.$queryRaw<Array<{ changeVersion: bigint }>>`
      UPDATE "Message"
      SET "body" = 'raw update', "changeVersion" = 0
      WHERE "id" = ${id}::uuid
      RETURNING "changeVersion"
    `;

    expect(inserted[0].changeVersion).toBeGreaterThan(BigInt(0));
    expect(updated[0].changeVersion).toBeGreaterThan(inserted[0].changeVersion);
  });

  it("makes a raw insert wait behind the application canonical pair-lock namespace", async () => {
    let announceLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => { announceLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const outerLock = prisma.$transaction(async (transaction) => {
      await lockAccountPair(transaction, teacher.id, parent.id);
      announceLocked();
      await release;
    });
    await locked;

    const writer = new Client({ connectionString: process.env.DATABASE_URL! });
    let pendingInsert: Promise<{ rows: Array<{ changeVersion: string }> }> | undefined;
    await writer.connect();
    try {
      const writerPid = Number((await writer.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      let insertSettled = false;
      pendingInsert = writer.query<{ changeVersion: string }>(`
        INSERT INTO "Message" (
          "id", "conversationId", "senderAccountId", "clientMessageId", "body", "changeVersion"
        ) VALUES ($1,$2,$3,$4,'raw waiter',0)
        RETURNING "changeVersion"
      `, [crypto.randomUUID(), conversationId, teacher.id, crypto.randomUUID()])
        .finally(() => { insertSettled = true; });

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_locks
          WHERE pid = ${writerPid} AND locktype = 'advisory' AND granted = false
        `;
        if (waiting[0].count > 0) break;
        if (attempt === 99) throw new Error("raw insert trigger did not use the application pair-lock namespace");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      expect(insertSettled).toBe(false);

      releaseLock();
      await outerLock;
      const result = await pendingInsert;
      expect(BigInt(result.rows[0].changeVersion)).toBeGreaterThan(BigInt(0));
    } finally {
      releaseLock();
      await outerLock.catch(() => undefined);
      await pendingInsert?.catch(() => undefined);
      await writer.end().catch(() => undefined);
    }
  });

  it("pages every message from one multi-row read receipt with limit one", async () => {
    const ids = [
      "02000000-0000-4000-8000-000000000001",
      "02000000-0000-4000-8000-000000000002",
    ];
    await prisma.message.createMany({ data: ids.map((id) => ({
      id,
      conversationId,
      senderAccountId: teacher.id,
      clientMessageId: crypto.randomUUID(),
      body: `待读 ${id}`,
      sentAt: new Date("2026-07-13T10:00:00.000Z"),
    })) });
    const initial = await service.listMessages(teacher, conversationId, {});
    await service.markRead(parent, conversationId, { messageIds: ids });

    const first = await service.listMessages(teacher, conversationId, {
      changesAfter: initial.nextChangesCursor!,
      limit: 1,
    });
    expect(first.hasMore).toBe(true);
    const second = await service.listMessages(teacher, conversationId, {
      changesAfter: first.nextChangesCursor!,
      limit: 1,
    });
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map(({ id }) => id))).toEqual(new Set(ids));
  });

  it("polls full message DTO changes by sequence version for new, read and deleted states", async () => {
    let clock = new Date("2099-07-13T12:00:00.000Z");
    const changeService = createChatService(prisma, () => clock);
    const initial = await changeService.listMessages(teacher, conversationId, {});
    expect(initial.nextChangesCursor).toMatch(/^[1-9][0-9]*$/u);

    clock = new Date("2099-07-13T12:00:01.000Z");
    const incoming = await changeService.sendMessage(parent, conversationId, {
      clientMessageId: crypto.randomUUID(),
      body: "状态轮询消息",
    });
    const incomingAt = clock;
    clock = new Date("2099-07-13T12:00:01.500Z");
    const secondIncoming = await changeService.sendMessage(parent, conversationId, {
      clientMessageId: crypto.randomUUID(),
      body: "立即续拉消息",
    });
    const createdChanges = await changeService.listMessages(teacher, conversationId, {
      changesAfter: initial.nextChangesCursor!,
      limit: 1,
    });
    expect(createdChanges.items).toEqual([expect.objectContaining({
      id: incoming.id,
      body: "状态轮询消息",
      readAt: null,
      deletedAt: null,
      updatedAt: incomingAt.toISOString(),
      mine: false,
    })]);
    expect(createdChanges.hasMore).toBe(true);
    expect(BigInt(createdChanges.nextChangesCursor!)).toBeGreaterThan(BigInt(initial.nextChangesCursor!));
    const continuedChanges = await changeService.listMessages(teacher, conversationId, {
      changesAfter: createdChanges.nextChangesCursor!,
      limit: 1,
    });
    expect(continuedChanges.items.map(({ id }) => id)).toEqual([secondIncoming.id]);
    expect(continuedChanges.hasMore).toBe(false);

    clock = new Date("2099-07-13T12:00:02.000Z");
    await changeService.markRead(teacher, conversationId, { messageIds: [incoming.id] });
    const readChanges = await changeService.listMessages(parent, conversationId, {
      changesAfter: continuedChanges.nextChangesCursor!,
    });
    expect(readChanges.items).toEqual([expect.objectContaining({ id: incoming.id, readAt: clock.toISOString(), mine: true })]);

    clock = new Date("2099-07-13T12:00:03.000Z");
    await prisma.$transaction(async (transaction) => {
      // Task 12 的 edit/delete mutation 必须沿用相同 pair lock，并同步写 updatedAt。
      await lockAccountPair(transaction, teacher.id, parent.id);
      await transaction.message.update({ where: { id: incoming.id }, data: { deletedAt: clock, updatedAt: clock } });
    });
    const deletedChanges = await changeService.listMessages(parent, conversationId, {
      changesAfter: readChanges.nextChangesCursor!,
    });
    expect(deletedChanges.items).toEqual([expect.objectContaining({
      id: incoming.id,
      body: "消息已删除",
      deletedAt: clock.toISOString(),
      updatedAt: clock.toISOString(),
    })]);
  });

  it("serializes raw same-pair triggers before allocating the later sequence version", async () => {
    const [firstMessage, secondMessage] = await Promise.all([
      prisma.message.create({ data: {
        conversationId,
        senderAccountId: teacher.id,
        clientMessageId: crypto.randomUUID(),
        body: "事务 A",
      } }),
      prisma.message.create({ data: {
        conversationId,
        senderAccountId: parent.id,
        clientMessageId: crypto.randomUUID(),
        body: "事务 B",
      } }),
    ]);
    const firstWriter = new Client({ connectionString: process.env.DATABASE_URL! });
    const secondWriter = new Client({ connectionString: process.env.DATABASE_URL! });
    await Promise.all([firstWriter.connect(), secondWriter.connect()]);
    try {
      await Promise.all([firstWriter.query("BEGIN"), secondWriter.query("BEGIN")]);
      const firstUpdate = await firstWriter.query<{ changeVersion: string }>(`
        UPDATE "Message" SET "body" = "body" WHERE "id" = $1 RETURNING "changeVersion"
      `, [firstMessage.id]);
      const secondPid = Number((await secondWriter.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      let secondSettled = false;
      const secondUpdate = secondWriter.query<{ changeVersion: string }>(`
        UPDATE "Message" SET "body" = "body" WHERE "id" = $1 RETURNING "changeVersion"
      `, [secondMessage.id]).finally(() => { secondSettled = true; });

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_locks
          WHERE pid = ${secondPid} AND locktype = 'advisory' AND granted = false
        `;
        if (waiting[0].count > 0) break;
        if (attempt === 99) throw new Error("second trigger did not wait for the canonical pair lock");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      expect(secondSettled).toBe(false);

      await firstWriter.query("COMMIT");
      const secondResult = await secondUpdate;
      await secondWriter.query("COMMIT");
      expect(BigInt(secondResult.rows[0].changeVersion)).toBeGreaterThan(
        BigInt(firstUpdate.rows[0].changeVersion),
      );
    } finally {
      await Promise.all([
        firstWriter.query("ROLLBACK").catch(() => undefined),
        secondWriter.query("ROLLBACK").catch(() => undefined),
      ]);
      await Promise.all([
        firstWriter.end().catch(() => undefined),
        secondWriter.end().catch(() => undefined),
      ]);
    }
  });

  it("rejects conversations whose accepted greeting or participant/request context no longer matches", async () => {
    await prisma.greeting.update({ where: { id: greetingId }, data: { status: "REJECTED" } });
    await expect(service.listMessages(parent, conversationId, {})).rejects.toMatchObject({ code: "NOT_FOUND" });

    await prisma.greeting.update({ where: { id: greetingId }, data: { status: "ACCEPTED" } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { teacherId: outsider.id } });
    await expect(service.listMessages(outsider, conversationId, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses stable activity/id keyset pagination for conversation lists", async () => {
    const activityAt = new Date("2026-07-13T11:30:00.000Z");
    const respondedAt = new Date();
    const expiresAt = new Date(respondedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const extraConversationIds = [
      "20000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002",
      "20000000-0000-4000-8000-000000000003",
    ];
    for (const [index, id] of extraConversationIds.entries()) {
      const request = await prisma.tutoringRequest.create({ data: {
        parentProfileId,
        title: `分页需求${index + 1}`,
        description: "分页测试",
      } });
      const greeting = await prisma.greeting.create({ data: {
        senderAccountId: teacher.id,
        recipientAccountId: parent.id,
        tutoringRequestId: request.id,
        contextKey: `${teacher.id}:${parent.id}:${request.id}`,
        cardSnapshot: { legacy: true },
        status: "ACCEPTED",
        respondedAt,
        expiresAt,
      } });
      await prisma.conversation.create({ data: {
        id,
        greetingId: greeting.id,
        teacherId: teacher.id,
        parentId: parent.id,
        tutoringRequestId: request.id,
        lastMessageAt: activityAt,
      } });
    }

    const first = await service.listConversations(parent, { limit: 2 });
    expect(first.items.map(({ id }) => id)).toEqual(extraConversationIds.slice(0, 2));
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await service.listConversations(parent, { limit: 2, cursor: first.nextCursor! });
    expect(second.items[0].id).toBe(extraConversationIds[2]);
    expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(4);
  });
});
