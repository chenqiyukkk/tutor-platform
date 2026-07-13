-- Keep enum expansion in its own committed migration. PostgreSQL cannot use a
-- newly added enum value safely in dependent DDL until the adding transaction
-- has committed.
BEGIN;

ALTER TYPE "GreetingStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "GreetingStatus" ADD VALUE IF NOT EXISTS 'REPORTED';
ALTER TYPE "GreetingStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';

COMMIT;
