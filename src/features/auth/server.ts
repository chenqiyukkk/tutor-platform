import "server-only";

import { db } from "@/lib/db";
import { ConsoleEmailAdapter } from "@/features/email/console-adapter";
import { SmtpEmailAdapter } from "@/features/email/smtp-adapter";
import { getEmailEnv, getServerEnv } from "@/lib/env";

import { PrismaAuthRepository } from "./prisma-repository";
import { PrismaPasswordResetRepository } from "./password-reset-prisma-repository";
import { createPasswordResetService } from "./password-reset";
import { createAuthService, type AuthService } from "./service";

let cachedAuthService: AuthService | undefined;
let cachedPasswordResetService: ReturnType<typeof createPasswordResetService> | undefined;

export function getAuthService() {
  if (!cachedAuthService) {
    const serverEnv = getServerEnv();
    cachedAuthService = createAuthService({
      repository: new PrismaAuthRepository(db),
      sessionSecret: serverEnv.SESSION_SECRET,
    });
  }
  return cachedAuthService;
}

export function getPasswordResetService() {
  if (cachedPasswordResetService) return cachedPasswordResetService;
  const serverEnv = getServerEnv();
  const emailEnv = getEmailEnv();
  const emailAdapter = emailEnv.mode === "smtp"
    ? new SmtpEmailAdapter({
        host: emailEnv.SMTP_HOST,
        port: emailEnv.SMTP_PORT,
        user: emailEnv.SMTP_USER,
        pass: emailEnv.SMTP_PASS,
        from: emailEnv.SMTP_FROM,
      })
    : new ConsoleEmailAdapter();

  cachedPasswordResetService = createPasswordResetService({
    repository: new PrismaPasswordResetRepository(db),
    email: emailAdapter,
    appUrl: emailEnv.APP_URL,
    tokenSecret: serverEnv.SESSION_SECRET,
  });
  return cachedPasswordResetService;
}
