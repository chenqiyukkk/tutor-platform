-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_greetingId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_parentId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_teacherId_fkey";

-- DropForeignKey
ALTER TABLE "Greeting" DROP CONSTRAINT "Greeting_recipientAccountId_fkey";

-- DropForeignKey
ALTER TABLE "Greeting" DROP CONSTRAINT "Greeting_senderAccountId_fkey";

-- DropForeignKey
ALTER TABLE "Greeting" DROP CONSTRAINT "Greeting_tutoringRequestId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_senderAccountId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_reporterAccountId_fkey";

-- Add the new target columns as nullable so existing favorites can be backfilled safely.
ALTER TABLE "Favorite"
ADD COLUMN     "ownerAccountId" UUID,
ADD COLUMN     "tutoringRequestId" UUID,
ALTER COLUMN "teacherProfileId" DROP NOT NULL;

-- Preserve legacy ownership through ParentProfile.accountId.
UPDATE "Favorite" AS favorite
SET "ownerAccountId" = parent_profile."accountId"
FROM "ParentProfile" AS parent_profile
WHERE favorite."parentProfileId" = parent_profile."id"
  AND favorite."ownerAccountId" IS NULL;

-- Abort instead of discarding a legacy favorite whose owner could not be resolved.
DO $favorite_owner_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Favorite" AS favorite
    WHERE favorite."ownerAccountId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Favorite ownerAccountId backfill failed for one or more legacy rows';
  END IF;
END
$favorite_owner_backfill$;

ALTER TABLE "Favorite"
ALTER COLUMN "ownerAccountId" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "Favorite" DROP CONSTRAINT "Favorite_parentProfileId_fkey";

-- DropIndex
DROP INDEX "Favorite_parentProfileId_teacherProfileId_key";

-- Remove the legacy owner relation only after the new owner is required.
ALTER TABLE "Favorite" DROP COLUMN "parentProfileId";

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "readAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "Favorite_tutoringRequestId_idx" ON "Favorite"("tutoringRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_ownerAccountId_teacherProfileId_key" ON "Favorite"("ownerAccountId", "teacherProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_ownerAccountId_tutoringRequestId_key" ON "Favorite"("ownerAccountId", "tutoringRequestId");

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_tutoringRequestId_fkey" FOREIGN KEY ("tutoringRequestId") REFERENCES "TutoringRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_recipientAccountId_fkey" FOREIGN KEY ("recipientAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_tutoringRequestId_fkey" FOREIGN KEY ("tutoringRequestId") REFERENCES "TutoringRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_greetingId_fkey" FOREIGN KEY ("greetingId") REFERENCES "Greeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterAccountId_fkey" FOREIGN KEY ("reporterAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A favorite must point to exactly one supported target.
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_exactly_one_target_check"
CHECK (num_nonnulls("teacherProfileId", "tutoringRequestId") = 1);
