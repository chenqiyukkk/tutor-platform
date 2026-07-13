import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import type { AuthenticatedAccount } from "@/features/auth/service";
import { lockAccountPair } from "@/features/interactions/account-pair-lock";

import {
  blockConversationSchema,
  conversationListQuerySchema,
  decodeConversationCursor,
  decodeMessageChangeCursor,
  decodeMessageCursor,
  encodeConversationCursor,
  encodeMessageChangeCursor,
  encodeMessageCursor,
  markReadSchema,
  messageListQuerySchema,
  sendMessageSchema,
  type BlockConversationInput,
  type ConversationListQuery,
  type MarkReadInput,
  type MessageListQuery,
  type SendMessageInput,
} from "./schema";
import {
  queryConversationContext,
  safeMessageSelect,
  toMessageDto,
  type ConversationContext,
} from "./data";

export type { ChatMessageDto } from "./data";

type Actor = Pick<AuthenticatedAccount, "id" | "role">;
type Db = PrismaClient | Prisma.TransactionClient;

export type ChatErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "BLOCKED" | "CONFLICT";

export class ChatWorkflowError extends Error {
  constructor(readonly code: ChatErrorCode, message: string) {
    super(message);
    this.name = "ChatWorkflowError";
  }
}

export type ConversationListItemDto = {
  id: string;
  counterpart: { role: "teacher" | "parent"; displayName: string };
  request: { id: string; title: string };
  activityAt: string;
  lastMessageAt: string | null;
  unreadCount: number;
  blocked: boolean;
};

const uuidSchema = z.string().uuid();
const nilUuid = "00000000-0000-0000-0000-000000000000";
const epochMessageCursor = encodeMessageCursor({ sentAt: new Date(0), id: nilUuid });

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

async function loadConversation(client: Db, actor: Actor, conversationId: string): Promise<ConversationContext> {
  const conversation = await queryConversationContext(client, conversationId);
  if (!conversation) throw new ChatWorkflowError("NOT_FOUND", "会话不存在");
  if (conversation.teacherId !== actor.id && conversation.parentId !== actor.id) {
    throw new ChatWorkflowError("FORBIDDEN", "你不是该会话成员");
  }
  if (!conversation.contextValid) throw new ChatWorkflowError("NOT_FOUND", "会话关系无效");
  return conversation;
}

async function hasBlock(client: Db, teacherId: string, parentId: string) {
  return (await client.block.count({ where: { OR: [
    { blockerAccountId: teacherId, blockedAccountId: parentId },
    { blockerAccountId: parentId, blockedAccountId: teacherId },
  ] } })) > 0;
}

function assertUnchangedPair(
  conversation: ConversationContext,
  preliminary: { teacherId: string; parentId: string },
) {
  if (conversation.teacherId !== preliminary.teacherId || conversation.parentId !== preliminary.parentId) {
    throw new ChatWorkflowError("CONFLICT", "会话成员已发生变化，请重试");
  }
}

type ConversationListRow = {
  id: string;
  requestId: string;
  requestTitle: string;
  counterpartName: string;
  activityAt: Date;
  lastMessageAt: Date | null;
  unreadCount: number;
  blocked: boolean;
};

async function queryMessagePage(
  client: Db,
  actor: Actor,
  conversationId: string,
  query: MessageListQuery,
  initialChangesCursor: string | null = null,
) {
  if (query.changesAfter) {
    const cursor = decodeMessageChangeCursor(query.changesAfter);
    const rows = await client.message.findMany({
      where: {
        conversationId,
        changeVersion: { gt: cursor.changeVersion },
      },
      select: safeMessageSelect,
      orderBy: { changeVersion: "asc" },
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const selected = hasMore ? rows.slice(0, query.limit) : rows;
    const last = selected.at(-1);
    return {
      items: selected.map((row) => toMessageDto(row, actor.id)),
      limit: query.limit,
      nextBeforeCursor: null,
      nextAfterCursor: null,
      nextChangesCursor: last
        ? encodeMessageChangeCursor({ changeVersion: last.changeVersion })
        : query.changesAfter,
      hasMore,
    };
  }

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
  const rows = await client.message.findMany({
    where: { conversationId, ...cursorWhere },
    select: safeMessageSelect,
    orderBy: [{ sentAt: ascending ? "asc" : "desc" }, { id: ascending ? "asc" : "desc" }],
    take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  const selected = hasMore ? rows.slice(0, query.limit) : rows;
  const chronological = ascending ? selected : selected.toReversed();
  const first = chronological[0];
  const last = chronological.at(-1);
  const emptyAfterCursor = query.after ?? (!query.before ? epochMessageCursor : null);
  return {
    items: chronological.map((row) => toMessageDto(row, actor.id)),
    limit: query.limit,
    nextBeforeCursor: !ascending && hasMore && first
      ? encodeMessageCursor({ sentAt: first.sentAt, id: first.id })
      : null,
    nextAfterCursor: last
      ? encodeMessageCursor({ sentAt: last.sentAt, id: last.id })
      : emptyAfterCursor,
    nextChangesCursor: initialChangesCursor,
    hasMore,
  };
}

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
          ) AS "unreadCount",
          EXISTS (
            SELECT 1
            FROM "Block" AS block
            WHERE (block."blockerAccountId" = conversation."teacherId" AND block."blockedAccountId" = conversation."parentId")
               OR (block."blockerAccountId" = conversation."parentId" AND block."blockedAccountId" = conversation."teacherId")
          ) AS "blocked"
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
          blocked: row.blocked,
        })),
        limit: query.limit,
        nextCursor: boundary ? encodeConversationCursor({ activityAt: boundary.activityAt, id: boundary.id }) : null,
      };
    },

    async listMessages(actor: Actor, conversationIdValue: string, rawQuery: MessageListQuery | unknown) {
      const conversationId = uuidSchema.parse(conversationIdValue);
      const query = messageListQuerySchema.parse(rawQuery);
      expectedDatabaseRole(actor.role);
      const initialHistory = !query.before && !query.after && !query.changesAfter;
      if (!initialHistory) {
        await assertActiveActor(prisma, actor);
        await loadConversation(prisma, actor, conversationId);
        return queryMessagePage(prisma, actor, conversationId, query);
      }

      const preliminary = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { teacherId: true, parentId: true },
      });
      if (!preliminary) throw new ChatWorkflowError("NOT_FOUND", "会话不存在");
      return prisma.$transaction(async (transaction) => {
        await lockAccountPair(transaction, preliminary.teacherId, preliminary.parentId);
        await assertActiveActor(transaction, actor);
        const conversation = await loadConversation(transaction, actor, conversationId);
        assertUnchangedPair(conversation, preliminary);
        const [watermark] = await transaction.$queryRaw<Array<{ changeVersion: bigint }>>`
          SELECT nextval('"Message_changeVersion_seq"')::bigint AS "changeVersion"
        `;
        const nextChangesCursor = encodeMessageChangeCursor({ changeVersion: watermark.changeVersion });
        return queryMessagePage(transaction, actor, conversationId, query, nextChangesCursor);
      }, { isolationLevel: "ReadCommitted" });
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
        assertUnchangedPair(conversation, preliminary);
        const existing = await transaction.message.findUnique({
          where: { conversationId_clientMessageId: { conversationId, clientMessageId: input.clientMessageId } },
          select: safeMessageSelect,
        });
        if (existing) {
          if (existing.senderAccountId !== actor.id || existing.body !== input.body) {
            throw new ChatWorkflowError("CONFLICT", "clientMessageId 已用于另一条消息");
          }
          return toMessageDto(existing, actor.id);
        }
        if (await hasBlock(transaction, conversation.teacherId, conversation.parentId)) {
          throw new ChatWorkflowError("BLOCKED", "双方当前不能互相发送消息");
        }
        const at = now();
        const created = await transaction.message.create({
          data: {
            conversationId,
            senderAccountId: actor.id,
            clientMessageId: input.clientMessageId,
            body: input.body,
            sentAt: at,
            updatedAt: at,
          },
          select: safeMessageSelect,
        });
        await transaction.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: at } });
        return toMessageDto(created, actor.id);
      }, { isolationLevel: "ReadCommitted" });
    },

    async markRead(actor: Actor, conversationIdValue: string, rawInput: MarkReadInput | unknown) {
      const conversationId = uuidSchema.parse(conversationIdValue);
      const input = markReadSchema.parse(rawInput);
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
        assertUnchangedPair(conversation, preliminary);
        const at = now();
        const result = await transaction.message.updateMany({
          where: {
            id: { in: input.messageIds },
            conversationId,
            senderAccountId: { not: actor.id },
            readAt: null,
          },
          // Task 12 的 edit/delete 必须沿用同一 pair lock，并同样显式更新 updatedAt。
          data: { readAt: at, updatedAt: at },
        });
        return { readCount: result.count, readAt: at.toISOString() };
      }, { isolationLevel: "ReadCommitted" });
    },

    async blockConversation(actor: Actor, conversationIdValue: string, rawInput: BlockConversationInput | unknown) {
      const conversationId = uuidSchema.parse(conversationIdValue);
      const input = blockConversationSchema.parse(rawInput);
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
        assertUnchangedPair(conversation, preliminary);
        const counterpartId = actor.id === conversation.teacherId ? conversation.parentId : conversation.teacherId;
        await transaction.block.upsert({
          where: { blockerAccountId_blockedAccountId: { blockerAccountId: actor.id, blockedAccountId: counterpartId } },
          create: { blockerAccountId: actor.id, blockedAccountId: counterpartId, reason: input.reason },
          update: {},
        });
        return { blocked: true as const };
      }, { isolationLevel: "ReadCommitted" });
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
