import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import type { AuthenticatedAccount } from "@/features/auth/service";
import { lockAccountPair } from "@/features/interactions/account-pair-lock";

import {
  conversationListQuerySchema,
  decodeConversationCursor,
  decodeMessageCursor,
  encodeConversationCursor,
  encodeMessageCursor,
  messageListQuerySchema,
  sendMessageSchema,
  type ConversationListQuery,
  type MessageListQuery,
  type SendMessageInput,
} from "./schema";

type Actor = Pick<AuthenticatedAccount, "id" | "role">;
type Db = PrismaClient | Prisma.TransactionClient;

export type ChatErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "BLOCKED" | "CONFLICT";

export class ChatWorkflowError extends Error {
  constructor(readonly code: ChatErrorCode, message: string) {
    super(message);
    this.name = "ChatWorkflowError";
  }
}

export type ChatMessageDto = {
  id: string;
  clientMessageId: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  mine: boolean;
};

export type ConversationListItemDto = {
  id: string;
  counterpart: { role: "teacher" | "parent"; displayName: string };
  request: { id: string; title: string };
  activityAt: string;
  lastMessageAt: string | null;
  unreadCount: number;
};

const uuidSchema = z.string().uuid();

function expectedDatabaseRole(role: Actor["role"]) {
  if (role === "teacher") return "TEACHER" as const;
  if (role === "parent") return "PARENT" as const;
  throw new ChatWorkflowError("FORBIDDEN", "仅老师或家长可以使用站内消息");
}

async function assertActiveActor(client: Db, actor: Actor) {
  const role = expectedDatabaseRole(actor.role);
  const account = await client.account.findFirst({
    where: { id: actor.id, role, status: "ACTIVE" },
    select: { id: true },
  });
  if (!account) throw new ChatWorkflowError("UNAUTHORIZED", "登录状态无效");
}

async function loadConversation(client: Db, actor: Actor, conversationId: string) {
  const conversation = await client.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new ChatWorkflowError("NOT_FOUND", "会话不存在");
  if (conversation.teacherId !== actor.id && conversation.parentId !== actor.id) {
    throw new ChatWorkflowError("FORBIDDEN", "你不是该会话成员");
  }
  const greeting = await client.greeting.findUnique({
    where: { id: conversation.greetingId },
    select: { status: true, senderAccountId: true, recipientAccountId: true, tutoringRequestId: true },
  });
  const request = await client.tutoringRequest.findUnique({
    where: { id: conversation.tutoringRequestId },
    select: { id: true, title: true, parentProfileId: true },
  });
  const parentProfile = request
    ? await client.parentProfile.findUnique({ where: { id: request.parentProfileId }, select: { accountId: true, displayName: true } })
    : null;
  const teacher = await client.account.findUnique({ where: { id: conversation.teacherId }, select: { id: true, role: true } });
  const parent = await client.account.findUnique({ where: { id: conversation.parentId }, select: { id: true, role: true } });
  const teacherProfile = await client.teacherProfile.findUnique({ where: { accountId: conversation.teacherId }, select: { displayName: true } });
  if (!greeting || !request || !parentProfile || !teacher || !parent || !teacherProfile) {
    throw new ChatWorkflowError("NOT_FOUND", "会话关系无效");
  }
  const greetingPair = [greeting.senderAccountId, greeting.recipientAccountId].sort();
  const conversationPair = [conversation.teacherId, conversation.parentId].sort();
  const valid = greeting.status === "ACCEPTED"
    && teacher.role === "TEACHER"
    && parent.role === "PARENT"
    && greeting.tutoringRequestId === conversation.tutoringRequestId
    && request.id === conversation.tutoringRequestId
    && parentProfile.accountId === conversation.parentId
    && greetingPair[0] === conversationPair[0]
    && greetingPair[1] === conversationPair[1];
  if (!valid) throw new ChatWorkflowError("NOT_FOUND", "会话关系无效");
  return {
    ...conversation,
    greeting,
    tutoringRequest: { ...request, parentProfile },
    teacher: { ...teacher, teacherProfile },
    parent: { ...parent, parentProfile },
  };
}

async function hasBlock(client: Db, teacherId: string, parentId: string) {
  return (await client.block.count({ where: { OR: [
    { blockerAccountId: teacherId, blockedAccountId: parentId },
    { blockerAccountId: parentId, blockedAccountId: teacherId },
  ] } })) > 0;
}

function toMessageDto(row: {
  id: string;
  clientMessageId: string;
  body: string;
  senderAccountId: string;
  sentAt: Date;
  readAt: Date | null;
  deletedAt: Date | null;
}, actorId: string): ChatMessageDto {
  return {
    id: row.id,
    clientMessageId: row.clientMessageId,
    body: row.deletedAt ? "消息已删除" : row.body,
    sentAt: row.sentAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    mine: row.senderAccountId === actorId,
  };
}

type ConversationListRow = {
  id: string;
  requestId: string;
  requestTitle: string;
  counterpartName: string;
  activityAt: Date;
  lastMessageAt: Date | null;
  unreadCount: number;
};

export function createChatService(prisma: PrismaClient, now: () => Date = () => new Date()) {
  return {
    async listConversations(actor: Actor, rawQuery: ConversationListQuery | unknown) {
      const query = conversationListQuerySchema.parse(rawQuery);
      const role = expectedDatabaseRole(actor.role);
      await assertActiveActor(prisma, actor);
      const cursor = query.cursor ? decodeConversationCursor(query.cursor) : null;
      const memberPredicate = role === "TEACHER"
        ? Prisma.sql`conversation."teacherId" = ${actor.id}::uuid`
        : Prisma.sql`conversation."parentId" = ${actor.id}::uuid`;
      const counterpartName = role === "TEACHER"
        ? Prisma.sql`parent_profile."displayName"`
        : Prisma.sql`teacher_profile."displayName"`;
      const cursorPredicate = cursor
        ? Prisma.sql`AND (
            COALESCE(conversation."lastMessageAt", conversation."createdAt") < ${cursor.activityAt}
            OR (
              COALESCE(conversation."lastMessageAt", conversation."createdAt") = ${cursor.activityAt}
              AND conversation."id" > ${cursor.id}::uuid
            )
          )`
        : Prisma.empty;
      const rows = await prisma.$queryRaw<ConversationListRow[]>(Prisma.sql`
        SELECT
          conversation."id",
          request."id" AS "requestId",
          request."title" AS "requestTitle",
          ${counterpartName} AS "counterpartName",
          COALESCE(conversation."lastMessageAt", conversation."createdAt") AS "activityAt",
          conversation."lastMessageAt",
          (
            SELECT count(*)::int
            FROM "Message" AS message
            WHERE message."conversationId" = conversation."id"
              AND message."senderAccountId" <> ${actor.id}::uuid
              AND message."readAt" IS NULL
          ) AS "unreadCount"
        FROM "Conversation" AS conversation
        JOIN "Greeting" AS greeting ON greeting."id" = conversation."greetingId"
        JOIN "TutoringRequest" AS request
          ON request."id" = conversation."tutoringRequestId"
          AND request."id" = greeting."tutoringRequestId"
        JOIN "ParentProfile" AS parent_profile
          ON parent_profile."id" = request."parentProfileId"
          AND parent_profile."accountId" = conversation."parentId"
        JOIN "TeacherProfile" AS teacher_profile ON teacher_profile."accountId" = conversation."teacherId"
        JOIN "Account" AS teacher ON teacher."id" = conversation."teacherId" AND teacher."role" = 'TEACHER'
        JOIN "Account" AS parent ON parent."id" = conversation."parentId" AND parent."role" = 'PARENT'
        WHERE ${memberPredicate}
          AND greeting."status" = 'ACCEPTED'
          AND (
            (greeting."senderAccountId" = conversation."teacherId" AND greeting."recipientAccountId" = conversation."parentId")
            OR
            (greeting."senderAccountId" = conversation."parentId" AND greeting."recipientAccountId" = conversation."teacherId")
          )
          ${cursorPredicate}
        ORDER BY COALESCE(conversation."lastMessageAt", conversation."createdAt") DESC, conversation."id" ASC
        LIMIT ${query.limit + 1}
      `);
      const hasMore = rows.length > query.limit;
      const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
      const boundary = hasMore ? pageRows.at(-1) : undefined;
      return {
        items: pageRows.map((row): ConversationListItemDto => ({
          id: row.id,
          counterpart: {
            role: role === "TEACHER" ? "parent" : "teacher",
            displayName: row.counterpartName,
          },
          request: { id: row.requestId, title: row.requestTitle },
          activityAt: row.activityAt.toISOString(),
          lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
          unreadCount: Number(row.unreadCount),
        })),
        limit: query.limit,
        nextCursor: boundary ? encodeConversationCursor({ activityAt: boundary.activityAt, id: boundary.id }) : null,
      };
    },

    async listMessages(actor: Actor, conversationIdValue: string, rawQuery: MessageListQuery | unknown) {
      const conversationId = uuidSchema.parse(conversationIdValue);
      const query = messageListQuerySchema.parse(rawQuery);
      await assertActiveActor(prisma, actor);
      await loadConversation(prisma, actor, conversationId);
      const cursorValue = query.before ?? query.after;
      const cursor = cursorValue ? decodeMessageCursor(cursorValue) : null;
      const cursorWhere: Prisma.MessageWhereInput = !cursor ? {} : query.after ? { OR: [
        { sentAt: { gt: cursor.sentAt } },
        { sentAt: cursor.sentAt, id: { gt: cursor.id } },
      ] } : { OR: [
        { sentAt: { lt: cursor.sentAt } },
        { sentAt: cursor.sentAt, id: { lt: cursor.id } },
      ] };
      const ascending = Boolean(query.after);
      const rows = await prisma.message.findMany({
        where: { conversationId, ...cursorWhere },
        select: {
          id: true,
          clientMessageId: true,
          body: true,
          senderAccountId: true,
          sentAt: true,
          readAt: true,
          deletedAt: true,
        },
        orderBy: [{ sentAt: ascending ? "asc" : "desc" }, { id: ascending ? "asc" : "desc" }],
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const selected = hasMore ? rows.slice(0, query.limit) : rows;
      const chronological = ascending ? selected : selected.toReversed();
      const first = chronological[0];
      const last = chronological.at(-1);
      const emptyAfterCursor = query.after
        ?? (!query.before
          ? encodeMessageCursor({ sentAt: now(), id: "00000000-0000-0000-0000-000000000000" })
          : null);
      return {
        items: chronological.map((row) => toMessageDto(row, actor.id)),
        limit: query.limit,
        nextBeforeCursor: !ascending && hasMore && first
          ? encodeMessageCursor({ sentAt: first.sentAt, id: first.id })
          : null,
        nextAfterCursor: last
          ? encodeMessageCursor({ sentAt: last.sentAt, id: last.id })
          : emptyAfterCursor,
        hasMore,
      };
    },

    async sendMessage(actor: Actor, conversationIdValue: string, rawInput: SendMessageInput | unknown) {
      const conversationId = uuidSchema.parse(conversationIdValue);
      const input = sendMessageSchema.parse(rawInput);
      expectedDatabaseRole(actor.role);
      const preliminary = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { teacherId: true, parentId: true },
      });
      if (!preliminary) throw new ChatWorkflowError("NOT_FOUND", "会话不存在");
      return prisma.$transaction(async (transaction) => {
        await lockAccountPair(transaction, preliminary.teacherId, preliminary.parentId);
        await assertActiveActor(transaction, actor);
        const conversation = await loadConversation(transaction, actor, conversationId);
        if (conversation.teacherId !== preliminary.teacherId || conversation.parentId !== preliminary.parentId) {
          throw new ChatWorkflowError("CONFLICT", "会话成员已发生变化，请重试");
        }
        if (await hasBlock(transaction, conversation.teacherId, conversation.parentId)) {
          throw new ChatWorkflowError("BLOCKED", "双方当前不能互相发送消息");
        }
        const existing = await transaction.message.findUnique({
          where: { conversationId_clientMessageId: { conversationId, clientMessageId: input.clientMessageId } },
          select: {
            id: true,
            clientMessageId: true,
            body: true,
            senderAccountId: true,
            sentAt: true,
            readAt: true,
            deletedAt: true,
          },
        });
        if (existing) {
          if (existing.senderAccountId !== actor.id || existing.body !== input.body) {
            throw new ChatWorkflowError("CONFLICT", "clientMessageId 已用于另一条消息");
          }
          return toMessageDto(existing, actor.id);
        }
        const at = now();
        const created = await transaction.message.create({
          data: {
            conversationId,
            senderAccountId: actor.id,
            clientMessageId: input.clientMessageId,
            body: input.body,
            sentAt: at,
          },
          select: {
            id: true,
            clientMessageId: true,
            body: true,
            senderAccountId: true,
            sentAt: true,
            readAt: true,
            deletedAt: true,
          },
        });
        await transaction.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: at } });
        return toMessageDto(created, actor.id);
      }, { isolationLevel: "ReadCommitted" });
    },

    async markRead(actor: Actor, conversationIdValue: string) {
      const conversationId = uuidSchema.parse(conversationIdValue);
      await assertActiveActor(prisma, actor);
      await loadConversation(prisma, actor, conversationId);
      const at = now();
      const result = await prisma.message.updateMany({
        where: {
          conversationId,
          senderAccountId: { not: actor.id },
          readAt: null,
        },
        data: { readAt: at },
      });
      return { readCount: result.count, readAt: at.toISOString() };
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
