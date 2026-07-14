BEGIN;

-- Block report writers before validating legacy rows so no invalid target can race the preflight.
LOCK TABLE "Report" IN SHARE ROW EXCLUSIVE MODE;

DO $moderation_report_target_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Report"
    WHERE "messageId" IS NULL
      AND "conversationId" IS NULL
      AND "greetingId" IS NULL
      AND "tutoringRequestId" IS NULL
      AND "reportedAccountId" IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot derive canonical target for one or more legacy reports'
      USING ERRCODE = '23514';
  END IF;
END;
$moderation_report_target_preflight$;

CREATE TYPE "ReportTargetType" AS ENUM (
  'ACCOUNT',
  'TEACHER_PROFILE',
  'TUTORING_REQUEST',
  'GREETING',
  'CONVERSATION',
  'MESSAGE'
);

CREATE TYPE "ReportResolutionAction" AS ENUM (
  'NONE',
  'CONTENT_TAKEDOWN',
  'ACCOUNT_SUSPENSION'
);

ALTER TABLE "Report"
  ADD COLUMN "teacherProfileId" UUID,
  ADD COLUMN "targetType" "ReportTargetType",
  ADD COLUMN "targetId" UUID,
  ADD COLUMN "clientRequestId" UUID,
  ADD COLUMN "targetSnapshot" JSONB,
  ADD COLUMN "resolutionAction" "ReportResolutionAction";

ALTER TABLE "Verification"
  ADD COLUMN "clientRequestId" UUID;

ALTER TABLE "AdminAuditLog"
  ADD COLUMN "requestId" UUID;

ALTER TABLE "TeacherProfile"
  ADD COLUMN "moderationRejectedAt" TIMESTAMPTZ(3),
  ADD COLUMN "moderationReason" TEXT;

ALTER TABLE "TutoringRequest"
  ADD COLUMN "moderationRejectedAt" TIMESTAMPTZ(3),
  ADD COLUMN "moderationReason" TEXT;

-- Canonicalize optional context from the most specific legacy relation without writing target tables.
UPDATE "Report" AS report
SET "conversationId" = message."conversationId"
FROM "Message" AS message
WHERE report."messageId" = message."id";

UPDATE "Report" AS report
SET "tutoringRequestId" = conversation."tutoringRequestId"
FROM "Conversation" AS conversation
WHERE report."conversationId" = conversation."id";

UPDATE "Report" AS report
SET "tutoringRequestId" = greeting."tutoringRequestId"
FROM "Greeting" AS greeting
WHERE report."messageId" IS NULL
  AND report."conversationId" IS NULL
  AND report."greetingId" = greeting."id";

UPDATE "Report"
SET
  "targetType" = CASE
    WHEN "messageId" IS NOT NULL THEN 'MESSAGE'::"ReportTargetType"
    WHEN "conversationId" IS NOT NULL THEN 'CONVERSATION'::"ReportTargetType"
    WHEN "greetingId" IS NOT NULL THEN 'GREETING'::"ReportTargetType"
    WHEN "tutoringRequestId" IS NOT NULL THEN 'TUTORING_REQUEST'::"ReportTargetType"
    ELSE 'ACCOUNT'::"ReportTargetType"
  END,
  "targetId" = COALESCE(
    "messageId",
    "conversationId",
    "greetingId",
    "tutoringRequestId",
    "reportedAccountId"
  );

ALTER TABLE "Report"
  ALTER COLUMN "targetType" SET NOT NULL,
  ALTER COLUMN "targetId" SET NOT NULL;

ALTER TABLE "Report" ADD CONSTRAINT "Report_teacherProfileId_fkey"
  FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Report" ADD CONSTRAINT "Report_no_self_report_check"
  CHECK ("reportedAccountId" IS NULL OR "reporterAccountId" <> "reportedAccountId");

ALTER TABLE "Report" ADD CONSTRAINT "Report_target_shape_check"
  CHECK (
    CASE "targetType"
      WHEN 'ACCOUNT' THEN
        "reportedAccountId" IS NOT NULL
        AND "targetId" = "reportedAccountId"
        AND num_nonnulls("teacherProfileId", "tutoringRequestId", "greetingId", "conversationId", "messageId") = 0
      WHEN 'TEACHER_PROFILE' THEN
        "teacherProfileId" IS NOT NULL
        AND "targetId" = "teacherProfileId"
        AND num_nonnulls("tutoringRequestId", "greetingId", "conversationId", "messageId") = 0
      WHEN 'TUTORING_REQUEST' THEN
        "tutoringRequestId" IS NOT NULL
        AND "targetId" = "tutoringRequestId"
        AND num_nonnulls("teacherProfileId", "greetingId", "conversationId", "messageId") = 0
      WHEN 'GREETING' THEN
        "greetingId" IS NOT NULL
        AND "targetId" = "greetingId"
        AND num_nonnulls("teacherProfileId", "conversationId", "messageId") = 0
      WHEN 'CONVERSATION' THEN
        "conversationId" IS NOT NULL
        AND "targetId" = "conversationId"
        AND num_nonnulls("teacherProfileId", "greetingId", "messageId") = 0
      WHEN 'MESSAGE' THEN
        "messageId" IS NOT NULL
        AND "targetId" = "messageId"
        AND num_nonnulls("teacherProfileId", "greetingId") = 0
    END
  );

DROP INDEX "Report_reporterAccountId_idx";
DROP INDEX "Report_greetingId_key";

CREATE INDEX "Report_greetingId_idx"
  ON "Report"("greetingId");

CREATE UNIQUE INDEX "Report_reporterAccountId_clientRequestId_key"
  ON "Report"("reporterAccountId", "clientRequestId");

CREATE INDEX "Report_targetType_targetId_idx"
  ON "Report"("targetType", "targetId");

CREATE UNIQUE INDEX "Report_reporterAccountId_targetType_targetId_open_key"
  ON "Report"("reporterAccountId", "targetType", "targetId")
  WHERE "status" IN ('PENDING', 'REVIEWING');

CREATE UNIQUE INDEX "Verification_accountId_clientRequestId_key"
  ON "Verification"("accountId", "clientRequestId");

CREATE UNIQUE INDEX "Verification_accountId_type_pending_key"
  ON "Verification"("accountId", "type")
  WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "AdminAuditLog_requestId_key"
  ON "AdminAuditLog"("requestId");

CREATE FUNCTION "reject_admin_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $audit_append_only$
BEGIN
  RAISE EXCEPTION 'AdminAuditLog is append-only'
    USING ERRCODE = '55000';
END;
$audit_append_only$;

CREATE TRIGGER "AdminAuditLog_append_only"
BEFORE UPDATE OR DELETE ON "AdminAuditLog"
FOR EACH ROW
EXECUTE FUNCTION "reject_admin_audit_log_mutation"();

COMMIT;
