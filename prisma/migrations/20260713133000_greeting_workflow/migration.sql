BEGIN;

-- Freeze every table read or rewritten by this migration before preflight.
-- Keep this order in any repair tooling to avoid lock-order inversions with
-- legacy greeting, conversation and report writers.
LOCK TABLE "Account" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "ParentProfile" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "TutoringRequest" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Greeting" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Conversation" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Report" IN SHARE ROW EXCLUSIVE MODE;

-- Preflight every legacy invariant before the first DDL statement. Any
-- failure leaves the database in the exact pre-migration shape.
DO $greeting_workflow_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Greeting" AS greeting
    WHERE NOT EXISTS (
      SELECT 1
      FROM "Account" AS sender
      JOIN "Account" AS recipient ON recipient.id = greeting."recipientAccountId"
      JOIN "TutoringRequest" AS request ON request.id = greeting."tutoringRequestId"
      JOIN "ParentProfile" AS parent_profile ON parent_profile.id = request."parentProfileId"
      WHERE sender.id = greeting."senderAccountId"
        AND (
          (sender.role = 'TEACHER' AND recipient.role = 'PARENT' AND parent_profile."accountId" = recipient.id)
          OR
          (sender.role = 'PARENT' AND recipient.role = 'TEACHER' AND parent_profile."accountId" = sender.id)
        )
    )
  ) THEN
    RAISE EXCEPTION 'Invalid legacy greeting context: expected one teacher and the request-owning parent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        CASE WHEN sender.role = 'TEACHER' THEN sender.id ELSE recipient.id END AS teacher_id,
        parent_profile."accountId" AS parent_id,
        greeting."tutoringRequestId" AS request_id
      FROM "Greeting" AS greeting
      JOIN "Account" AS sender ON sender.id = greeting."senderAccountId"
      JOIN "Account" AS recipient ON recipient.id = greeting."recipientAccountId"
      JOIN "TutoringRequest" AS request ON request.id = greeting."tutoringRequestId"
      JOIN "ParentProfile" AS parent_profile ON parent_profile.id = request."parentProfileId"
    ) AS contexts
    GROUP BY teacher_id, parent_id, request_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Greeting workflow preflight failed: duplicate reverse-direction contexts require manual merge';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Conversation" AS conversation
    JOIN "Greeting" AS greeting ON greeting.id = conversation."greetingId"
    GROUP BY conversation."teacherId", conversation."parentId", greeting."tutoringRequestId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Greeting workflow preflight failed: duplicate conversation contexts require manual merge';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Conversation" AS conversation
    JOIN "Greeting" AS greeting ON greeting.id = conversation."greetingId"
    JOIN "Account" AS sender ON sender.id = greeting."senderAccountId"
    JOIN "Account" AS recipient ON recipient.id = greeting."recipientAccountId"
    JOIN "TutoringRequest" AS request ON request.id = greeting."tutoringRequestId"
    JOIN "ParentProfile" AS parent_profile ON parent_profile.id = request."parentProfileId"
    WHERE conversation."teacherId" <> CASE WHEN sender.role = 'TEACHER' THEN sender.id ELSE recipient.id END
       OR conversation."parentId" <> parent_profile."accountId"
  ) THEN
    RAISE EXCEPTION 'Greeting workflow preflight failed: conversation participants do not match greeting context';
  END IF;
END
$greeting_workflow_preflight$;

-- Add nullable columns, preserve every legacy row, then make them required.
ALTER TABLE "Greeting"
  ADD COLUMN "contextKey" TEXT,
  ADD COLUMN "cardSnapshot" JSONB,
  ADD COLUMN "expiresAt" TIMESTAMPTZ(3);

UPDATE "Greeting" AS greeting
SET
  "contextKey" = concat_ws(':',
    CASE WHEN sender.role = 'TEACHER' THEN sender.id::text ELSE recipient.id::text END,
    parent_profile."accountId"::text,
    greeting."tutoringRequestId"::text
  ),
  "cardSnapshot" = jsonb_build_object('legacy', true),
  "expiresAt" = greeting."createdAt" + interval '7 days'
FROM "Account" AS sender,
     "Account" AS recipient,
     "TutoringRequest" AS request,
     "ParentProfile" AS parent_profile
WHERE sender.id = greeting."senderAccountId"
  AND recipient.id = greeting."recipientAccountId"
  AND request.id = greeting."tutoringRequestId"
  AND parent_profile.id = request."parentProfileId";

ALTER TABLE "Greeting"
  ALTER COLUMN "contextKey" SET NOT NULL,
  ALTER COLUMN "cardSnapshot" SET NOT NULL,
  ALTER COLUMN "expiresAt" SET NOT NULL;

DROP INDEX "Greeting_senderAccountId_recipientAccountId_tutoringRequest_key";
CREATE UNIQUE INDEX "Greeting_contextKey_key" ON "Greeting"("contextKey");
CREATE INDEX "Greeting_senderAccountId_createdAt_id_idx" ON "Greeting"("senderAccountId", "createdAt" DESC, "id");
CREATE INDEX "Greeting_recipientAccountId_createdAt_id_idx" ON "Greeting"("recipientAccountId", "createdAt" DESC, "id");

ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_distinct_accounts_check"
  CHECK ("senderAccountId" <> "recipientAccountId");
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_expiry_after_creation_check"
  CHECK ("expiresAt" > "createdAt");
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_response_time_check"
  CHECK (
    (status = 'PENDING' AND "respondedAt" IS NULL)
    OR (status IN ('ACCEPTED', 'REJECTED', 'REPORTED', 'BLOCKED') AND "respondedAt" IS NOT NULL)
    OR status IN ('CANCELLED', 'EXPIRED')
  );

ALTER TABLE "Conversation" ADD COLUMN "tutoringRequestId" UUID;
UPDATE "Conversation" AS conversation
SET "tutoringRequestId" = greeting."tutoringRequestId"
FROM "Greeting" AS greeting
WHERE greeting.id = conversation."greetingId";
ALTER TABLE "Conversation" ALTER COLUMN "tutoringRequestId" SET NOT NULL;
CREATE UNIQUE INDEX "Conversation_teacherId_parentId_tutoringRequestId_key"
  ON "Conversation"("teacherId", "parentId", "tutoringRequestId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tutoringRequestId_fkey"
  FOREIGN KEY ("tutoringRequestId") REFERENCES "TutoringRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Report" ADD COLUMN "greetingId" UUID;
CREATE UNIQUE INDEX "Report_greetingId_key" ON "Report"("greetingId");
ALTER TABLE "Report" ADD CONSTRAINT "Report_greetingId_fkey"
  FOREIGN KEY ("greetingId") REFERENCES "Greeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
