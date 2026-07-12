import type { AuthRole } from "@/features/auth/schemas";

export type PasswordResetEmail = {
  to: string;
  role: AuthRole;
  resetUrl: string;
  expiresAt: Date;
};

export interface EmailAdapter {
  sendPasswordReset(message: PasswordResetEmail): Promise<void>;
}
