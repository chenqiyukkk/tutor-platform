-- Password reset links remain unusable until email delivery has completed.
ALTER TABLE "PasswordResetToken"
ADD COLUMN "activatedAt" TIMESTAMPTZ(3);
