// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
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

  it("serializes send behind the canonical pair lock and observes a concurrently committed block", async () => {
    let announceBlocked!: () => void;
    let releaseBlock!: () => void;
    const blocked = new Promise<void>((resolve) => { announceBlocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseBlock = resolve; });
    const blocker = prisma.$transaction(async (transaction) => {
      await lockAccountPair(transaction, teacher.id, parent.id);
      await transaction.block.create({ data: { blockerAccountId: parent.id, blockedAccountId: teacher.id } });
      announceBlocked();
      await release;
    });
    await blocked;
    let settled = false;
    const send = service.sendMessage(teacher, conversationId, {
      clientMessageId: crypto.randomUUID(),
      body: "不能越过并发屏蔽",
    }).finally(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    releaseBlock();
    await blocker;
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

  it("returns an empty-history polling watermark so subsequent reads can use after", async () => {
    const page = await service.listMessages(parent, conversationId, {});
    expect(page.items).toEqual([]);
    expect(page.nextAfterCursor).toBe(encodeMessageCursor({
      sentAt: fixedNow,
      id: "00000000-0000-0000-0000-000000000000",
    }));
  });

  it("does not lose a message committed after the empty history query", async () => {
    const watermarkAt = new Date("2026-07-13T12:00:00.000Z");
    const tooEarlyAt = new Date("2026-07-13T11:59:59.000Z");
    let capturedWatermark: Date | null = null;
    let insertedId = "";
    const queryHookPrisma = {
      account: prisma.account,
      conversation: prisma.conversation,
      greeting: prisma.greeting,
      tutoringRequest: prisma.tutoringRequest,
      parentProfile: prisma.parentProfile,
      teacherProfile: prisma.teacherProfile,
      message: {
        findMany: async (args: Parameters<typeof prisma.message.findMany>[0]) => {
          const rows = await prisma.message.findMany(args);
          const inserted = await prisma.message.create({ data: {
            conversationId,
            senderAccountId: teacher.id,
            clientMessageId: crypto.randomUUID(),
            body: "查询后提交的消息",
            sentAt: capturedWatermark ?? tooEarlyAt,
          } });
          insertedId = inserted.id;
          return rows;
        },
      },
    } as unknown as PrismaClient;
    const hookedService = createChatService(queryHookPrisma, () => {
      capturedWatermark = watermarkAt;
      return watermarkAt;
    });

    const initial = await hookedService.listMessages(parent, conversationId, {});
    expect(initial.items).toEqual([]);
    const polled = await service.listMessages(parent, conversationId, { after: initial.nextAfterCursor! });

    expect(polled.items.map(({ id }) => id)).toContain(insertedId);
  });

  it("counts only unread messages from the counterpart and marks only those with server time", async () => {
    const teacherMessages = [];
    for (const [index, body] of ["未读一", "未读二"].entries()) {
      teacherMessages.push(await prisma.message.create({ data: {
        conversationId,
        senderAccountId: teacher.id,
        clientMessageId: crypto.randomUUID(),
        body,
        sentAt: new Date(`2026-07-13T10:0${index}:00.000Z`),
      } }));
    }
    const own = await prisma.message.create({ data: {
      conversationId,
      senderAccountId: parent.id,
      clientMessageId: crypto.randomUUID(),
      body: "自己的消息",
      sentAt: new Date("2026-07-13T10:02:00.000Z"),
    } });

    expect((await service.listConversations(parent, {})).items[0].unreadCount).toBe(2);
    await expect(service.markRead(parent, conversationId)).resolves.toEqual({ readCount: 2, readAt: fixedNow.toISOString() });
    for (const message of teacherMessages) {
      await expect(prisma.message.findUniqueOrThrow({ where: { id: message.id } })).resolves.toMatchObject({ readAt: fixedNow });
    }
    await expect(prisma.message.findUniqueOrThrow({ where: { id: own.id } })).resolves.toMatchObject({ readAt: null });
    expect((await service.listConversations(parent, {})).items[0].unreadCount).toBe(0);
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
        respondedAt: new Date("2026-07-13T09:00:00.000Z"),
        expiresAt: new Date("2026-07-20T09:00:00.000Z"),
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
