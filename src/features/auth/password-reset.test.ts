import { describe, expect, it, vi } from "vitest";

import type { EmailAdapter, PasswordResetEmail } from "@/features/email/adapter";

import { verifyPassword } from "./password";
import {
  FORGOT_PASSWORD_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
  createPasswordResetService,
  digestPasswordResetToken,
  generatePasswordResetToken,
  type PasswordResetAccount,
  type PasswordResetRepository,
  type PasswordResetTokenRecord,
} from "./password-reset";

const TOKEN_SECRET = "password-reset-test-secret-with-more-than-32-characters";
const NOW = new Date("2030-01-01T00:00:00.000Z");

class MemoryPasswordResetRepository implements PasswordResetRepository {
  accounts: PasswordResetAccount[] = [];
  tokens: PasswordResetTokenRecord[] = [];
  sessions: Array<{ accountId: string; revokedAt: Date | null }> = [];

  async findAccountByEmail(role: PasswordResetAccount["role"], normalizedEmail: string) {
    return this.accounts.find(
      (account) => account.role === role && account.normalizedEmail === normalizedEmail,
    ) ?? null;
  }

  async preparePasswordResetToken(input: {
    accountId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }) {
    for (const token of this.tokens) {
      if (token.accountId === input.accountId && !token.usedAt) token.usedAt = input.createdAt;
    }
    this.tokens.push({
      ...input,
      activatedAt: null,
      usedAt: null,
    });
  }

  async activatePasswordResetToken(tokenHash: string, activatedAt: Date) {
    const token = this.tokens.find(
      (candidate) => candidate.tokenHash === tokenHash && !candidate.usedAt,
    );
    if (!token) return false;
    token.activatedAt = activatedAt;
    return true;
  }

  async invalidatePasswordResetToken(tokenHash: string, usedAt: Date) {
    const token = this.tokens.find((candidate) => candidate.tokenHash === tokenHash);
    if (token && !token.usedAt) token.usedAt = usedAt;
  }

  async resetPasswordWithToken(input: {
    role: PasswordResetAccount["role"];
    tokenHash: string;
    passwordHash: string;
    usedAt: Date;
  }) {
    const token = this.tokens.find((candidate) => candidate.tokenHash === input.tokenHash);
    const account = token
      ? this.accounts.find((candidate) => candidate.id === token.accountId)
      : undefined;
    if (
      !token ||
      !account ||
      account.role !== input.role ||
      account.status !== "active" ||
      token.usedAt ||
      !token.activatedAt ||
      token.expiresAt.getTime() <= input.usedAt.getTime()
    ) {
      return false;
    }

    token.usedAt = input.usedAt;
    account.passwordHash = input.passwordHash;
    for (const session of this.sessions) {
      if (session.accountId === account.id && !session.revokedAt) {
        session.revokedAt = input.usedAt;
      }
    }
    return true;
  }
}

function account(
  id: string,
  role: PasswordResetAccount["role"],
  email = "Mai@Example.COM",
): PasswordResetAccount {
  return {
    id,
    role,
    status: "active",
    email,
    normalizedEmail: email.toLowerCase(),
    passwordHash: "$argon2id$old-password-hash",
  };
}

function setup(overrides: {
  repository?: MemoryPasswordResetRepository;
  email?: EmailAdapter;
  now?: () => Date;
  createToken?: () => string;
  logger?: { error(message: string): void };
} = {}) {
  const repository = overrides.repository ?? new MemoryPasswordResetRepository();
  const deliveries: PasswordResetEmail[] = [];
  const email = overrides.email ?? {
    async sendPasswordReset(message: PasswordResetEmail) {
      deliveries.push(message);
    },
  };
  const service = createPasswordResetService({
    repository,
    email,
    appUrl: "https://tutor.example.test/base",
    tokenSecret: TOKEN_SECRET,
    now: overrides.now ?? (() => NOW),
    createToken: overrides.createToken,
    logger: overrides.logger,
  });
  return { repository, deliveries, service };
}

describe("password reset token lifecycle", () => {
  it("returns the exact same generic response for known and unknown email addresses", async () => {
    const { repository, service } = setup();
    repository.accounts.push(account("teacher-1", "teacher"));

    const known = await service.requestReset("teacher", { email: "  MAI@example.com " });
    const unknown = await service.requestReset("teacher", { email: "missing@example.com" });

    expect(known).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
    expect(unknown).toEqual(known);
    expect(FORGOT_PASSWORD_MESSAGE).toBe("如果该邮箱存在，我们已发送重置链接");
  });

  it("normalizes email and scopes the link and account lookup to the URL role", async () => {
    const { repository, deliveries, service } = setup();
    repository.accounts.push(
      account("teacher-1", "teacher"),
      account("parent-1", "parent"),
    );

    await service.requestReset("parent", { email: "  MAI@example.COM " });

    expect(repository.tokens).toHaveLength(1);
    expect(repository.tokens[0].accountId).toBe("parent-1");
    expect(deliveries).toHaveLength(1);
    const url = new URL(deliveries[0].resetUrl);
    expect(url.origin).toBe("https://tutor.example.test");
    expect(url.pathname).toBe("/parent/reset-password");
    expect(url.searchParams.get("token")).toBeTruthy();
    expect(deliveries[0]).toMatchObject({ to: "Mai@Example.COM", role: "parent" });
  });

  it("generates at least 32 random bytes and stores only an HMAC-SHA-256 digest", async () => {
    const first = generatePasswordResetToken();
    const second = generatePasswordResetToken();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);

    const { repository, deliveries, service } = setup({ createToken: () => first });
    repository.accounts.push(account("teacher-1", "teacher"));
    await service.requestReset("teacher", { email: "mai@example.com" });

    expect(repository.tokens[0].tokenHash).toBe(digestPasswordResetToken(first, TOKEN_SECRET));
    expect(repository.tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(repository.tokens)).not.toContain(first);
    expect(deliveries[0].resetUrl).toContain(encodeURIComponent(first));
  });

  it("revokes older unused links when a newer link is activated", async () => {
    const tokens = ["a".repeat(43), "b".repeat(43)];
    const { repository, service } = setup({ createToken: () => tokens.shift()! });
    repository.accounts.push(account("teacher-1", "teacher"));

    await service.requestReset("teacher", { email: "mai@example.com" });
    await service.requestReset("teacher", { email: "mai@example.com" });

    expect(repository.tokens).toHaveLength(2);
    expect(repository.tokens[0].usedAt).toEqual(NOW);
    expect(repository.tokens[1]).toMatchObject({ usedAt: null, activatedAt: NOW });
  });

  it("keeps a failed delivery token inactive and hides adapter details", async () => {
    const logger = { error: vi.fn() };
    const { repository, service } = setup({
      email: {
        async sendPasswordReset() {
          throw new Error("SMTP password=super-secret host=internal.example.test");
        },
      },
      logger,
    });
    repository.accounts.push(account("teacher-1", "teacher"));

    await expect(service.requestReset("teacher", { email: "mai@example.com" })).resolves.toEqual({
      message: FORGOT_PASSWORD_MESSAGE,
    });
    expect(repository.tokens[0].activatedAt).toBeNull();
    expect(repository.tokens[0].usedAt).toEqual(NOW);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("super-secret");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("internal.example.test");
  });

  it("keeps an emailed link inactive when the activation commit cannot be confirmed", async () => {
    const rawToken = "activation-failure".padEnd(43, "x");
    const repository = new MemoryPasswordResetRepository();
    vi.spyOn(repository, "activatePasswordResetToken").mockResolvedValue(false);
    const logger = { error: vi.fn() };
    const { deliveries, service } = setup({ repository, logger, createToken: () => rawToken });
    repository.accounts.push(account("teacher-1", "teacher"));

    await service.requestReset("teacher", { email: "mai@example.com" });

    expect(deliveries[0].resetUrl).toContain(rawToken);
    expect(repository.tokens[0].activatedAt).toBeNull();
    await expect(service.resetPassword("teacher", {
      token: rawToken,
      newPassword: "new password long enough",
    })).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect(logger.error).toHaveBeenCalledWith("Password reset token activation failed");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(rawToken);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(repository.tokens[0].tokenHash);
  });

  it.each(["unknown", "expired", "used", "inactive"] as const)(
    "returns the same invalid-token result for a %s token",
    async (state) => {
      const rawToken = `${state}-`.padEnd(43, "x");
      const { repository, service } = setup();
      repository.accounts.push(account("teacher-1", "teacher"));
      if (state !== "unknown") {
        repository.tokens.push({
          accountId: "teacher-1",
          tokenHash: digestPasswordResetToken(rawToken, TOKEN_SECRET),
          createdAt: NOW,
          expiresAt: state === "expired" ? NOW : new Date(NOW.getTime() + 60_000),
          activatedAt: state === "inactive" ? null : NOW,
          usedAt: state === "used" ? NOW : null,
        });
      }

      await expect(service.resetPassword("teacher", {
        token: rawToken,
        newPassword: "a new password with enough length",
      })).rejects.toMatchObject({
        code: "INVALID_TOKEN",
        message: INVALID_RESET_TOKEN_MESSAGE,
      });
    },
  );

  it("updates the Argon2id password, consumes the token, and revokes every account session", async () => {
    const rawToken = "reset-token".padEnd(43, "x");
    const { repository, service } = setup({ createToken: () => rawToken });
    repository.accounts.push(account("teacher-1", "teacher"));
    repository.sessions.push(
      { accountId: "teacher-1", revokedAt: null },
      { accountId: "teacher-1", revokedAt: null },
      { accountId: "other", revokedAt: null },
    );
    await service.requestReset("teacher", { email: "mai@example.com" });

    await expect(service.resetPassword("teacher", {
      token: rawToken,
      newPassword: "a new password with enough length",
    })).resolves.toEqual({ success: true });

    expect(repository.accounts[0].passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword(repository.accounts[0].passwordHash, "a new password with enough length"),
    ).resolves.toBe(true);
    expect(repository.tokens[0].usedAt).toEqual(NOW);
    expect(repository.sessions.slice(0, 2).every((session) => session.revokedAt === NOW)).toBe(true);
    expect(repository.sessions[2].revokedAt).toBeNull();
    await expect(service.resetPassword("teacher", {
      token: rawToken,
      newPassword: "another password with enough length",
    })).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("allows exactly one concurrent reset to consume a token", async () => {
    const rawToken = "concurrent-token".padEnd(43, "x");
    const { repository, service } = setup({ createToken: () => rawToken });
    repository.accounts.push(account("teacher-1", "teacher"));
    await service.requestReset("teacher", { email: "mai@example.com" });

    const results = await Promise.allSettled([
      service.resetPassword("teacher", {
        token: rawToken,
        newPassword: "first concurrent password",
      }),
      service.resetPassword("teacher", {
        token: rawToken,
        newPassword: "second concurrent password",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
