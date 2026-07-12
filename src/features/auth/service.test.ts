import { describe, expect, it, vi } from "vitest";

import { requireSessionRole } from "./guards";
import { getDummyPasswordHash, verifyPassword } from "./password";
import {
  AuthError,
  createAuthService,
  type AccountRecord,
  type AuthRepository,
  type NewAccount,
  type NewSession,
  type SessionRecord,
} from "./service";
import { digestSessionToken } from "./session";

const SESSION_SECRET = "test-session-secret-that-is-longer-than-32-bytes";

class MemoryAuthRepository implements AuthRepository {
  accounts: AccountRecord[] = [];
  sessions: SessionRecord[] = [];

  async findAccountByUsername(role: AccountRecord["role"], normalizedUsername: string) {
    return this.accounts.find(
      (account) =>
        account.role === role && account.normalizedUsername === normalizedUsername,
    ) ?? null;
  }

  async findAccountByEmail(role: AccountRecord["role"], normalizedEmail: string) {
    return this.accounts.find(
      (account) => account.role === role && account.normalizedEmail === normalizedEmail,
    ) ?? null;
  }

  async createAccount(input: NewAccount) {
    const account: AccountRecord = {
      ...input,
      id: `account-${this.accounts.length + 1}`,
      status: "active",
    };
    this.accounts.push(account);
    return account;
  }

  async updateLastLogin() {}

  async createSession(input: NewSession) {
    const session: SessionRecord = {
      ...input,
      id: `session-${this.sessions.length + 1}`,
      revokedAt: null,
      account: this.accounts.find((account) => account.id === input.accountId)!,
    };
    this.sessions.push(session);
    return session;
  }

  async findSession(tokenHash: string) {
    return this.sessions.find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async revokeSession(tokenHash: string, role: AccountRecord["role"]) {
    const session = this.sessions.find(
      (candidate) => candidate.tokenHash === tokenHash && candidate.account.role === role,
    );
    if (session) session.revokedAt = new Date();
  }
}

function registration(overrides: Partial<{ username: string; email: string; password: string }> = {}) {
  return {
    username: "Mai.Sakurajima",
    email: "Mai@Example.COM",
    password: "correct horse battery staple",
    ...overrides,
  };
}

describe("auth service", () => {
  it("normalizes username and email before persisting", async () => {
    const repository = new MemoryAuthRepository();
    const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });

    await service.register("teacher", registration({
      username: "  Mai.Sakurajima  ",
      email: "  Mai@Example.COM  ",
    }));

    expect(repository.accounts[0]).toMatchObject({
      normalizedUsername: "mai.sakurajima",
      normalizedEmail: "mai@example.com",
      username: "Mai.Sakurajima",
      email: "Mai@Example.COM",
    });
  });

  it.each(["username", "email"] as const)(
    "rejects a duplicate %s inside the same role",
    async (field) => {
      const repository = new MemoryAuthRepository();
      const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });
      await service.register("teacher", registration());

      await expect(
        service.register("teacher", registration({
          username: field === "username" ? " MAI.SAKURAJIMA " : "another-user",
          email: field === "email" ? " MAI@example.com " : "another@example.com",
        })),
      ).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
    },
  );

  it("allows the same username and email in teacher and parent roles", async () => {
    const repository = new MemoryAuthRepository();
    const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });

    await service.register("teacher", registration());
    await service.register("parent", registration());

    expect(repository.accounts.map((account) => account.role)).toEqual(["teacher", "parent"]);
  });

  it("stores an Argon2id hash instead of the plaintext password", async () => {
    const repository = new MemoryAuthRepository();
    const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });
    const password = "correct horse battery staple";

    await service.register("teacher", registration({ password }));

    const stored = repository.accounts[0].passwordHash;
    expect(stored).not.toContain(password);
    expect(stored).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(stored, password)).resolves.toBe(true);
  });

  it("uses a valid cached Argon2id dummy hash that never matches login input", async () => {
    const first = getDummyPasswordHash();
    const second = getDummyPasswordHash();

    expect(second).toBe(first);
    await expect(first).resolves.toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(await first, "wrong password")).resolves.toBe(false);
  });

  it("returns the same generic error for an unknown user and a wrong password", async () => {
    const repository = new MemoryAuthRepository();
    const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });
    await service.register("teacher", registration());

    const unknown = service.login("teacher", {
      identifier: "unknown@example.com",
      password: "wrong password",
    });
    const incorrect = service.login("teacher", {
      identifier: "mai@example.com",
      password: "wrong password",
    });

    await Promise.all([
      expect(unknown).rejects.toEqual(
        new AuthError("INVALID_CREDENTIALS", "账号或密码错误"),
      ),
      expect(incorrect).rejects.toEqual(
        new AuthError("INVALID_CREDENTIALS", "账号或密码错误"),
      ),
    ]);
  });

  it("performs exactly one dummy password verification for an unknown account", async () => {
    const repository = new MemoryAuthRepository();
    const verifyPasswordHash = vi.fn().mockResolvedValue(false);
    const service = createAuthService({
      repository,
      sessionSecret: SESSION_SECRET,
      verifyPasswordHash,
      getDummyPasswordHash: async () => "dummy-argon2id-hash",
    });

    await expect(service.login("teacher", {
      identifier: "missing@example.com",
      password: "wrong password",
    })).rejects.toEqual(new AuthError("INVALID_CREDENTIALS", "账号或密码错误"));

    expect(verifyPasswordHash).toHaveBeenCalledExactlyOnceWith(
      "dummy-argon2id-hash",
      "wrong password",
    );
  });

  it.each(["suspended", "disabled"] as const)(
    "performs exactly one password verification for a %s account",
    async (status) => {
      const repository = new MemoryAuthRepository();
      const verifyPasswordHash = vi.fn().mockResolvedValue(true);
      const service = createAuthService({
        repository,
        sessionSecret: SESSION_SECRET,
        verifyPasswordHash,
        getDummyPasswordHash: async () => "dummy-argon2id-hash",
      });
      await service.register("teacher", registration());
      repository.accounts[0].status = status;

      await expect(service.login("teacher", {
        identifier: "mai@example.com",
        password: registration().password,
      })).rejects.toEqual(new AuthError("INVALID_CREDENTIALS", "账号或密码错误"));

      expect(verifyPasswordHash).toHaveBeenCalledExactlyOnceWith(
        repository.accounts[0].passwordHash,
        registration().password,
      );
    },
  );

  it("performs exactly one verification for an active account with a wrong password", async () => {
    const repository = new MemoryAuthRepository();
    const verifyPasswordHash = vi.fn().mockResolvedValue(false);
    const service = createAuthService({
      repository,
      sessionSecret: SESSION_SECRET,
      verifyPasswordHash,
      getDummyPasswordHash: async () => "dummy-argon2id-hash",
    });
    await service.register("teacher", registration());

    await expect(service.login("teacher", {
      identifier: "mai@example.com",
      password: "wrong password",
    })).rejects.toEqual(new AuthError("INVALID_CREDENTIALS", "账号或密码错误"));

    expect(verifyPasswordHash).toHaveBeenCalledExactlyOnceWith(
      repository.accounts[0].passwordHash,
      "wrong password",
    );
  });

  it("converts a damaged password hash verification error to generic credentials failure", async () => {
    const repository = new MemoryAuthRepository();
    const verifyPasswordHash = vi.fn().mockRejectedValue(new Error("invalid hash encoding"));
    const service = createAuthService({
      repository,
      sessionSecret: SESSION_SECRET,
      verifyPasswordHash,
      getDummyPasswordHash: async () => "dummy-argon2id-hash",
    });
    await service.register("teacher", registration());

    await expect(service.login("teacher", {
      identifier: "mai@example.com",
      password: "wrong password",
    })).rejects.toEqual(new AuthError("INVALID_CREDENTIALS", "账号或密码错误"));
    expect(verifyPasswordHash).toHaveBeenCalledTimes(1);
  });

  it("returns an opaque random token while persisting only its keyed digest", async () => {
    const repository = new MemoryAuthRepository();
    const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });
    await service.register("teacher", registration());

    const first = await service.login("teacher", {
      identifier: "MAI.SAKURAJIMA",
      password: registration().password,
    });
    const second = await service.login("teacher", {
      identifier: "mai@example.com",
      password: registration().password,
    });

    expect(first.token).not.toBe(second.token);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(repository.sessions[0].tokenHash).toBe(
      digestSessionToken(first.token, SESSION_SECRET),
    );
    expect(repository.sessions[0].tokenHash).not.toContain(first.token);
    expect(JSON.stringify(repository.sessions)).not.toContain(first.token);
  });

  it.each(["suspended", "disabled"] as const)(
    "does not allow a %s account to log in",
    async (status) => {
      const repository = new MemoryAuthRepository();
      const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });
      await service.register("teacher", registration());
      repository.accounts[0].status = status;

      await expect(service.login("teacher", {
        identifier: "mai@example.com",
        password: registration().password,
      })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    },
  );

  it("rejects a teacher session from parent and admin role guards", async () => {
    const repository = new MemoryAuthRepository();
    const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });
    await service.register("teacher", registration());
    const { token } = await service.login("teacher", {
      identifier: "mai@example.com",
      password: registration().password,
    });

    await expect(requireSessionRole(service, "teacher", token)).resolves.toMatchObject({
      role: "teacher",
    });
    await expect(requireSessionRole(service, "parent", token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(requireSessionRole(service, "admin", token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects an expired session", async () => {
    const repository = new MemoryAuthRepository();
    let currentTime = new Date("2030-01-01T00:00:00Z");
    const service = createAuthService({
      repository,
      sessionSecret: SESSION_SECRET,
      now: () => currentTime,
      createToken: () => "fixed-expiring-session-token-that-is-long-enough",
      sessionDurationMs: 1_000,
    });
    await service.register("teacher", registration());
    const { token } = await service.login("teacher", {
      identifier: "mai@example.com",
      password: registration().password,
    });
    currentTime = new Date("2030-01-01T00:00:01Z");

    await expect(service.getSession("teacher", token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a session marked as revoked", async () => {
    const repository = new MemoryAuthRepository();
    const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });
    await service.register("teacher", registration());
    const { token } = await service.login("teacher", {
      identifier: "mai@example.com",
      password: registration().password,
    });
    repository.sessions[0].revokedAt = new Date();

    await expect(service.getSession("teacher", token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it.each(["suspended", "disabled"] as const)(
    "rejects an existing session after its account becomes %s",
    async (status) => {
      const repository = new MemoryAuthRepository();
      const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });
      await service.register("teacher", registration());
      const { token } = await service.login("teacher", {
        identifier: "mai@example.com",
        password: registration().password,
      });
      repository.accounts[0].status = status;

      await expect(service.getSession("teacher", token)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    },
  );

  it("invalidates a token after logout revokes its session", async () => {
    const repository = new MemoryAuthRepository();
    const service = createAuthService({ repository, sessionSecret: SESSION_SECRET });
    await service.register("teacher", registration());
    const { token } = await service.login("teacher", {
      identifier: "mai@example.com",
      password: registration().password,
    });

    await service.logout("teacher", token);

    await expect(service.getSession("teacher", token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
