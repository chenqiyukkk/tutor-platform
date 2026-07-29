-- Parent workflows keep only the three reachable request states. Existing
-- rows are preserved and explicitly mapped before replacing the enum.
CREATE TYPE "TeachingMode" AS ENUM ('OFFLINE', 'ONLINE', 'BOTH');
CREATE TYPE "RequestStatus_new" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

ALTER TABLE "StudentProfile"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "TutoringRequest"
  ADD COLUMN "teachingMode" "TeachingMode",
  ADD COLUMN "publicLocationNote" TEXT,
  ADD COLUMN "closedAt" TIMESTAMPTZ(3);

-- Old request budgets were decimal yuan. Keep valid values and convert them
-- to integer cents; invalid optional legacy values become NULL without
-- discarding the request itself.
UPDATE "TutoringRequest"
SET "budgetMin" = NULL,
    "budgetMax" = NULL
WHERE "budgetMin" < 0
   OR "budgetMin" > 1000
   OR "budgetMax" < 0
   OR "budgetMax" > 1000
   OR ("budgetMin" IS NOT NULL AND "budgetMax" IS NOT NULL AND "budgetMin" > "budgetMax");

ALTER TABLE "TutoringRequest"
  ALTER COLUMN "budgetMin" TYPE INTEGER
    USING CASE WHEN "budgetMin" IS NULL THEN NULL ELSE ROUND("budgetMin" * 100)::INTEGER END,
  ALTER COLUMN "budgetMax" TYPE INTEGER
    USING CASE WHEN "budgetMax" IS NULL THEN NULL ELSE ROUND("budgetMax" * 100)::INTEGER END;

UPDATE "TutoringRequest"
SET "publishedAt" = CASE
      WHEN "status" = 'OPEN' THEN COALESCE("publishedAt", "updatedAt", "createdAt", now())
      ELSE NULL
    END,
    "closedAt" = CASE
      WHEN "status" IN ('FILLED', 'CLOSED') THEN COALESCE("updatedAt", "createdAt", now())
      ELSE NULL
    END;

ALTER TABLE "TutoringRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TutoringRequest"
  ALTER COLUMN "status" TYPE "RequestStatus_new"
  USING (
    CASE "status"::text
      WHEN 'OPEN' THEN 'PUBLISHED'
      WHEN 'FILLED' THEN 'CLOSED'
      WHEN 'CLOSED' THEN 'CLOSED'
      ELSE 'DRAFT'
    END
  )::"RequestStatus_new";

DROP TYPE "RequestStatus";
ALTER TYPE "RequestStatus_new" RENAME TO "RequestStatus";
ALTER TABLE "TutoringRequest" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "TutoringRequest"
  ADD CONSTRAINT "TutoringRequest_budget_range_check"
    CHECK (
      ("budgetMin" IS NULL OR ("budgetMin" >= 0 AND "budgetMin" <= 100000))
      AND ("budgetMax" IS NULL OR ("budgetMax" >= 0 AND "budgetMax" <= 100000))
      AND ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax")
    ),
  ADD CONSTRAINT "TutoringRequest_status_time_check"
    CHECK (
      ("status" = 'DRAFT' AND "publishedAt" IS NULL AND "closedAt" IS NULL)
      OR ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL AND "closedAt" IS NULL)
      OR ("status" = 'CLOSED' AND "publishedAt" IS NULL AND "closedAt" IS NOT NULL)
    );
