BEGIN;

DROP INDEX "Message_conversationId_sentAt_idx";

CREATE INDEX "Message_conversationId_sentAt_id_idx"
  ON "Message"("conversationId", "sentAt", "id");

CREATE INDEX "Message_conversationId_unread_sender_idx"
  ON "Message"("conversationId", "senderAccountId", "sentAt", "id")
  WHERE "readAt" IS NULL;

CREATE INDEX "Conversation_teacherId_activityAt_id_idx"
  ON "Conversation"("teacherId", (COALESCE("lastMessageAt", "createdAt")) DESC, "id");

CREATE INDEX "Conversation_parentId_activityAt_id_idx"
  ON "Conversation"("parentId", (COALESCE("lastMessageAt", "createdAt")) DESC, "id");

COMMIT;
