import "server-only";

import { Prisma } from "@prisma/client";

export type ConversationContext = {
  id: string;
  teacherId: string;
  parentId: string;
  tutoringRequestId: string;
  requestTitle: string;
  teacherDisplayName: string;
  parentDisplayName: string;
};

type ConversationContextRow = ConversationContext & {
  contextValid: boolean;
};

type RawClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function queryConversationContext(client: RawClient, conversationId: string) {
  const rows = await client.$queryRaw<ConversationContextRow[]>(Prisma.sql`
    SELECT
      conversation."id",
      conversation."teacherId",
      conversation."parentId",
      conversation."tutoringRequestId",
      request."title" AS "requestTitle",
      teacher_profile."displayName" AS "teacherDisplayName",
      parent_profile."displayName" AS "parentDisplayName",
      (
        greeting."id" IS NOT NULL
        AND greeting."status" = 'ACCEPTED'
        AND request."id" IS NOT NULL
        AND parent_profile."id" IS NOT NULL
        AND teacher_profile."id" IS NOT NULL
        AND teacher."role" = 'TEACHER'
        AND parent."role" = 'PARENT'
        AND greeting."tutoringRequestId" = conversation."tutoringRequestId"
        AND request."id" = conversation."tutoringRequestId"
        AND parent_profile."accountId" = conversation."parentId"
        AND (
          (greeting."senderAccountId" = conversation."teacherId" AND greeting."recipientAccountId" = conversation."parentId")
          OR
          (greeting."senderAccountId" = conversation."parentId" AND greeting."recipientAccountId" = conversation."teacherId")
        )
      ) AS "contextValid"
    FROM "Conversation" AS conversation
    LEFT JOIN "Greeting" AS greeting ON greeting."id" = conversation."greetingId"
    LEFT JOIN "TutoringRequest" AS request ON request."id" = conversation."tutoringRequestId"
    LEFT JOIN "ParentProfile" AS parent_profile ON parent_profile."id" = request."parentProfileId"
    LEFT JOIN "TeacherProfile" AS teacher_profile ON teacher_profile."accountId" = conversation."teacherId"
    LEFT JOIN "Account" AS teacher ON teacher."id" = conversation."teacherId"
    LEFT JOIN "Account" AS parent ON parent."id" = conversation."parentId"
    WHERE conversation."id" = ${conversationId}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export const safeMessageSelect = Prisma.validator<Prisma.MessageSelect>()({
  id: true,
  clientMessageId: true,
  body: true,
  senderAccountId: true,
  sentAt: true,
  readAt: true,
  editedAt: true,
  deletedAt: true,
  updatedAt: true,
});

type SafeMessageRow = Prisma.MessageGetPayload<{ select: typeof safeMessageSelect }>;

export type ChatMessageDto = {
  id: string;
  clientMessageId: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  updatedAt: string;
  mine: boolean;
};

export function toMessageDto(row: SafeMessageRow, actorId: string): ChatMessageDto {
  return {
    id: row.id,
    clientMessageId: row.clientMessageId,
    body: row.deletedAt ? "消息已删除" : row.body,
    sentAt: row.sentAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    mine: row.senderAccountId === actorId,
  };
}
