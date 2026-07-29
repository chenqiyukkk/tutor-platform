-- Validation lives in the workflow migration before its first DDL statement.
-- Keep this historical migration directory as an atomic no-op so every
-- environment retains the same ordered migration history.
BEGIN;
SELECT 1;
COMMIT;
