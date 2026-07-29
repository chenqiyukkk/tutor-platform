-- AlterTable
CREATE TYPE "TeacherIdentityType" AS ENUM (
  'UNIVERSITY_STUDENT',
  'FULL_TIME_TEACHER',
  'OTHER'
);

ALTER TABLE "TeacherProfile"
  ADD COLUMN "identityType" "TeacherIdentityType",
  ADD COLUMN "hourlyRateMax" DECIMAL(10,2),
  ADD COLUMN "isOnline" BOOLEAN NOT NULL DEFAULT false;

-- Legacy hourlyRate was nullable and unconstrained. Preserve the profile while
-- dropping only an invalid optional rate before validating the new invariant.
UPDATE "TeacherProfile"
SET "hourlyRate" = NULL
WHERE "hourlyRate" < 0 OR "hourlyRate" > 1000;

ALTER TABLE "TeacherProfile"
  ADD CONSTRAINT "TeacherProfile_hourly_rate_range_check"
  CHECK (
    ("hourlyRate" IS NULL OR ("hourlyRate" >= 0 AND "hourlyRate" <= 1000))
    AND ("hourlyRateMax" IS NULL OR ("hourlyRateMax" >= 0 AND "hourlyRateMax" <= 1000))
    AND ("hourlyRate" IS NULL OR "hourlyRateMax" IS NULL OR "hourlyRate" <= "hourlyRateMax")
  );
