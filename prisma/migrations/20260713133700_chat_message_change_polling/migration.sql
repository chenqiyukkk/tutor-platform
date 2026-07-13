BEGIN;

ALTER TABLE "Message"
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3);

UPDATE "Message"
SET "updatedAt" = GREATEST(
  "sentAt",
  COALESCE("readAt", "sentAt"),
  COALESCE("editedAt", "sentAt"),
  COALESCE("deletedAt", "sentAt")
);

ALTER TABLE "Message"
  ALTER COLUMN "updatedAt" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Message_conversationId_updatedAt_id_idx"
  ON "Message"("conversationId", "updatedAt", "id");

DROP INDEX IF EXISTS "Conversation_teacherId_lastMessageAt_idx";
DROP INDEX IF EXISTS "Conversation_parentId_lastMessageAt_idx";

COMMIT;
