import { describe, expect, it } from "vitest";

import { requireSessionRole } from "./guards";
import { verifyPassword } from "./password";
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

    await expect(unknown).rejects.toEqual(
      new AuthError("INVALID_CREDENTIALS", "账号或密码错误"),
    );
    await expect(incorrect).rejects.toEqual(
      new AuthError("INVALID_CREDENTIALS", "账号或密码错误"),
    );
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
});
