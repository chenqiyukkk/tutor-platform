import { randomUUID } from "node:crypto";

import { z } from "zod";

import { hashPassword, verifyPassword } from "@/features/auth/password";

export type DeletableRole = "teacher" | "parent";
export type AccountDeletionActor = { id: string; role: DeletableRole | "admin" };
export type DeletionAccount = { id: string; role: DeletableRole | "admin"; status: "active" | "suspended" | "disabled"; passwordHash: string };
export type AnonymizeAccountInput = {
  accountId: string;
  expectedPasswordHash: string;
  at: Date;
  username: string;
  normalizedUsername: string;
  email: string;
  normalizedEmail: string;
  passwordHash: string;
};

export interface AccountDeletionRepository {
  loadForDeletion(accountId: string): Promise<DeletionAccount | null>;
  anonymize(input: AnonymizeAccountInput): Promise<{ evidenceKeys: string[] }>;
}

export type AccountDeletionErrorCode = "FORBIDDEN" | "INVALID_CREDENTIALS" | "CONFLICT";
export class AccountDeletionError extends Error {
  constructor(readonly code: AccountDeletionErrorCode, message: string) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

export const accountDeletionInputSchema = z.object({
  confirmation: z.literal("注销账户"),
  password: z.string().min(1).max(128),
}).strict();

export function createAccountDeletionService({
  repository,
  storage,
  verifyPasswordHash = verifyPassword,
  hashPasswordHash = hashPassword,
  now = () => new Date(),
  randomValue = randomUUID,
  logCleanupFailure = () => undefined,
}: {
  repository: AccountDeletionRepository;
  storage?: { remove(key: string): Promise<void> };
  verifyPasswordHash?: (hash: string, password: string) => Promise<boolean>;
  hashPasswordHash?: (password: string) => Promise<string>;
  now?: () => Date;
  randomValue?: () => string;
  logCleanupFailure?: (key: string) => void;
}) {
  return {
    async delete(actor: AccountDeletionActor, rawInput: unknown) {
      if (actor.role === "admin") throw new AccountDeletionError("FORBIDDEN", "管理员账号不能自助注销");
      const input = accountDeletionInputSchema.parse(rawInput);
      const account = await repository.loadForDeletion(actor.id);
      if (!account || account.role !== actor.role || account.status === "disabled") {
        throw new AccountDeletionError("CONFLICT", "账号状态已经发生变化");
      }
      let matches = false;
      try { matches = await verifyPasswordHash(account.passwordHash, input.password); } catch { matches = false; }
      if (!matches) throw new AccountDeletionError("INVALID_CREDENTIALS", "当前密码不正确");
      const suffix = actor.id;
      const result = await repository.anonymize({
        accountId: actor.id,
        expectedPasswordHash: account.passwordHash,
        at: now(),
        username: "已注销用户",
        normalizedUsername: `deleted:${suffix}`,
        email: `deleted-${suffix}@invalid.local`,
        normalizedEmail: `deleted-${suffix}@invalid.local`,
        passwordHash: await hashPasswordHash(`deleted:${randomValue()}`),
      });
      if (storage) {
        await Promise.all(result.evidenceKeys.map(async (key) => {
          try { await storage.remove(key); } catch { logCleanupFailure(key); }
        }));
      }
      return { deleted: true as const };
    },
  };
}

export type AccountDeletionService = ReturnType<typeof createAccountDeletionService>;
