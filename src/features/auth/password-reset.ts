import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

import type { EmailAdapter } from "@/features/email/adapter";

import { hashPassword } from "./password";
import {
  emailSchema,
  normalizeEmail,
  passwordSchema,
  type AuthRole,
} from "./schemas";
export {
  FORGOT_PASSWORD_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
} from "./password-reset-messages";
import {
  FORGOT_PASSWORD_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
} from "./password-reset-messages";

export const PASSWORD_RESET_DURATION_MS = 30 * 60 * 1_000;

const forgotPasswordSchema = z.object({ email: emailSchema });
const resetPasswordSchema = z.object({
  token: z.string().trim().min(1).max(512),
  newPassword: passwordSchema,
});

export type PasswordResetAccount = {
  id: string;
  role: AuthRole;
  status: "active" | "suspended" | "disabled";
  email: string;
  normalizedEmail: string;
  passwordHash: string;
};

export type PasswordResetTokenRecord = {
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  activatedAt: Date | null;
  usedAt: Date | null;
  createdAt: Date;
};

export interface PasswordResetRepository {
  findAccountByEmail(role: AuthRole, normalizedEmail: string): Promise<PasswordResetAccount | null>;
  preparePasswordResetToken(input: {
    accountId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<void>;
  activatePasswordResetToken(tokenHash: string, activatedAt: Date): Promise<boolean>;
  invalidatePasswordResetToken(tokenHash: string, usedAt: Date): Promise<void>;
  resetPasswordWithToken(input: {
    role: AuthRole;
    tokenHash: string;
    passwordHash: string;
    usedAt: Date;
  }): Promise<boolean>;
}

export class PasswordResetError extends Error {
  readonly code = "INVALID_TOKEN";

  constructor() {
    super(INVALID_RESET_TOKEN_MESSAGE);
    this.name = "PasswordResetError";
  }
}

export function generatePasswordResetToken() {
  return randomBytes(32).toString("base64url");
}

export function digestPasswordResetToken(token: string, secret: string) {
  if (Buffer.byteLength(secret) < 32) {
    throw new Error("Password reset token secret must contain at least 32 bytes");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;

export function createPasswordResetService({
  repository,
  email,
  appUrl,
  tokenSecret,
  now = () => new Date(),
  createToken = generatePasswordResetToken,
  durationMs = PASSWORD_RESET_DURATION_MS,
  hashPasswordHash = hashPassword,
  logger = console,
}: {
  repository: PasswordResetRepository;
  email: EmailAdapter;
  appUrl: string;
  tokenSecret: string;
  now?: () => Date;
  createToken?: () => string;
  durationMs?: number;
  hashPasswordHash?: (password: string) => Promise<string>;
  logger?: Pick<Console, "error">;
}) {
  const applicationUrl = new URL(appUrl);
  digestPasswordResetToken("configuration-check", tokenSecret);

  return {
    async requestReset(role: AuthRole, rawInput: { email: string }) {
      const input = forgotPasswordSchema.parse(rawInput);
      let tokenHash: string | undefined;
      const issuedAt = now();

      try {
        const account = await repository.findAccountByEmail(role, normalizeEmail(input.email));
        if (!account || account.status !== "active") {
          return { message: FORGOT_PASSWORD_MESSAGE };
        }

        const token = createToken();
        tokenHash = digestPasswordResetToken(token, tokenSecret);
        const expiresAt = new Date(issuedAt.getTime() + durationMs);
        await repository.preparePasswordResetToken({
          accountId: account.id,
          tokenHash,
          expiresAt,
          createdAt: issuedAt,
        });

        const resetUrl = new URL(`/${role}/reset-password`, applicationUrl);
        resetUrl.searchParams.set("token", token);
        await email.sendPasswordReset({
          to: account.email,
          role,
          resetUrl: resetUrl.toString(),
          expiresAt,
        });

        const activated = await repository.activatePasswordResetToken(tokenHash, now());
        if (!activated) logger.error("Password reset token activation failed");
      } catch {
        if (tokenHash) {
          try {
            await repository.invalidatePasswordResetToken(tokenHash, now());
          } catch {
            // The token is inactive by default, so cleanup failure remains fail-safe.
          }
        }
        logger.error("Password reset request could not be completed");
      }

      return { message: FORGOT_PASSWORD_MESSAGE };
    },

    async resetPassword(
      role: AuthRole,
      rawInput: { token: string; newPassword: string },
    ) {
      const input = resetPasswordSchema.parse(rawInput);
      const passwordHash = await hashPasswordHash(input.newPassword);
      const reset = await repository.resetPasswordWithToken({
        role,
        tokenHash: digestPasswordResetToken(input.token, tokenSecret),
        passwordHash,
        usedAt: now(),
      });
      if (!reset) throw new PasswordResetError();
      return { success: true as const };
    },
  };
}
