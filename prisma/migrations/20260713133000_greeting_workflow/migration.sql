-- Add nullable columns first so legacy rows can be backfilled without data loss.
ALTER TABLE "Greeting"
  ADD COLUMN "contextKey" TEXT,
  ADD COLUMN "cardSnapshot" JSONB,
  ADD COLUMN "expiresAt" TIMESTAMPTZ(3);

UPDATE "Greeting" AS greeting
SET
  "contextKey" = concat_ws(':',
    CASE WHEN sender.role = 'TEACHER' THEN sender.id::text ELSE recipient.id::text END,
    parent_account.id::text,
    greeting."tutoringRequestId"::text
  ),
  "cardSnapshot" = jsonb_build_object('legacy', true),
  "expiresAt" = greeting."createdAt" + interval '7 days'
FROM "Account" AS sender,
     "Account" AS recipient,
     "TutoringRequest" AS request,
     "ParentProfile" AS parent_profile,
     "Account" AS parent_account
WHERE sender.id = greeting."senderAccountId"
  AND recipient.id = greeting."recipientAccountId"
  AND request.id = greeting."tutoringRequestId"
  AND parent_profile.id = request."parentProfileId"
  AND parent_account.id = parent_profile."accountId";

DO $greeting_backfill$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Greeting"
    WHERE "contextKey" IS NULL OR "cardSnapshot" IS NULL OR "expiresAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Greeting workflow backfill failed: unresolved legacy relationship';
  END IF;
  IF EXISTS (
    SELECT "contextKey" FROM "Greeting" GROUP BY "contextKey" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Greeting workflow backfill failed: duplicate reverse-direction contexts require manual merge';
  END IF;
END
$greeting_backfill$;

ALTER TABLE "Greeting"
  ALTER COLUMN "contextKey" SET NOT NULL,
  ALTER COLUMN "cardSnapshot" SET NOT NULL,
  ALTER COLUMN "expiresAt" SET NOT NULL;

DROP INDEX "Greeting_senderAccountId_recipientAccountId_tutoringRequest_key";
CREATE UNIQUE INDEX "Greeting_contextKey_key" ON "Greeting"("contextKey");
CREATE INDEX "Greeting_senderAccountId_createdAt_idx" ON "Greeting"("senderAccountId", "createdAt");
CREATE INDEX "Greeting_recipientAccountId_createdAt_id_idx" ON "Greeting"("recipientAccountId", "createdAt" DESC, "id");
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_distinct_accounts_check"
  CHECK ("senderAccountId" <> "recipientAccountId");
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_expiry_after_creation_check"
  CHECK ("expiresAt" > "createdAt");
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_response_time_check"
  CHECK (
    (status = 'PENDING' AND "respondedAt" IS NULL)
    OR (status IN ('ACCEPTED', 'REJECTED', 'REPORTED', 'BLOCKED') AND "respondedAt" IS NOT NULL)
    OR (status IN ('CANCELLED', 'EXPIRED'))
  );

ALTER TABLE "Conversation" ADD COLUMN "tutoringRequestId" UUID;
UPDATE "Conversation" AS conversation
SET "tutoringRequestId" = greeting."tutoringRequestId"
FROM "Greeting" AS greeting
WHERE greeting.id = conversation."greetingId";
DO $conversation_backfill$
BEGIN
  IF EXISTS (SELECT 1 FROM "Conversation" WHERE "tutoringRequestId" IS NULL) THEN
    RAISE EXCEPTION 'Conversation tutoringRequestId backfill failed';
  END IF;
  IF EXISTS (
    SELECT "teacherId", "parentId", "tutoringRequestId"
    FROM "Conversation"
    GROUP BY "teacherId", "parentId", "tutoringRequestId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate conversation contexts require manual merge';
  END IF;
END
$conversation_backfill$;
ALTER TABLE "Conversation" ALTER COLUMN "tutoringRequestId" SET NOT NULL;
CREATE UNIQUE INDEX "Conversation_teacherId_parentId_tutoringRequestId_key"
  ON "Conversation"("teacherId", "parentId", "tutoringRequestId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tutoringRequestId_fkey"
  FOREIGN KEY ("tutoringRequestId") REFERENCES "TutoringRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Report" ADD COLUMN "greetingId" UUID;
CREATE UNIQUE INDEX "Report_greetingId_key" ON "Report"("greetingId");
ALTER TABLE "Report" ADD CONSTRAINT "Report_greetingId_fkey"
  FOREIGN KEY ("greetingId") REFERENCES "Greeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
