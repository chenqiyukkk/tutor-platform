CREATE TABLE "GreetingAttempt" (
  "id" UUID NOT NULL,
  "senderAccountId" UUID NOT NULL,
  "attemptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GreetingAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GreetingAttempt_senderAccountId_attemptedAt_idx"
  ON "GreetingAttempt"("senderAccountId", "attemptedAt");
ALTER TABLE "GreetingAttempt" ADD CONSTRAINT "GreetingAttempt_senderAccountId_fkey"
  FOREIGN KEY ("senderAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
