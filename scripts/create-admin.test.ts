import { describe, expect, it, vi } from "vitest";

import {
  AdminBootstrapError,
  bootstrapAdmin,
  prepareAdminBootstrapEnvironment,
  resolveAdminCredentials,
  runCreateAdminCommand,
  type AdminBootstrapRepository,
} from "./create-admin";

const valid = {
  username: "Mai.Admin",
  email: "mai.admin@example.com",
  password: "correct-horse-battery-staple",
};

function repository(overrides: Partial<AdminBootstrapRepository> = {}): AdminBootstrapRepository {
  return {
    findAdminByNormalizedUsername: vi.fn().mockResolvedValue(null),
    findAdminByNormalizedEmail: vi.fn().mockResolvedValue(null),
    createAdmin: vi.fn().mockResolvedValue({ id: "admin-id", username: valid.username }),
    ...overrides,
  };
}

describe("resolveAdminCredentials", () => {
  it("requires all three credentials and never invents defaults", () => {
    expect(() => resolveAdminCredentials([], {})).toThrowError(
      new AdminBootstrapError("INVALID_INPUT", "缺少管理员引导参数：username、email、password"),
    );
  });

  it("accepts ADMIN_BOOTSTRAP environment variables", () => {
    expect(resolveAdminCredentials([], {
      ADMIN_BOOTSTRAP_USERNAME: valid.username,
      ADMIN_BOOTSTRAP_EMAIL: valid.email,
      ADMIN_BOOTSTRAP_PASSWORD: valid.password,
    })).toEqual(valid);
  });

  it("lets explicit CLI options override environment values field by field", () => {
    expect(resolveAdminCredentials(
      ["--username", valid.username, `--email=${valid.email}`, "--password", valid.password],
      {
        ADMIN_BOOTSTRAP_USERNAME: "environment-admin",
        ADMIN_BOOTSTRAP_EMAIL: "environment@example.com",
        ADMIN_BOOTSTRAP_PASSWORD: "environment-password",
      },
    )).toEqual(valid);
  });

  it("accepts an inline password value that begins with dashes", () => {
    expect(resolveAdminCredentials(
      ["--username", valid.username, "--email", valid.email, "--password=--secure-password"],
      {},
    )).toEqual({ ...valid, password: "--secure-password" });
  });

  it("rejects unknown, duplicate, or valueless CLI options without echoing their values", () => {
    expect(() => resolveAdminCredentials(["--unknown", "secret-value"], {}))
      .toThrowError("不支持的管理员引导参数");
    expect(() => resolveAdminCredentials(["--username", "first", "--username", "second"], {}))
      .toThrowError("管理员引导参数重复");
    expect(() => resolveAdminCredentials(["--password"], {}))
      .toThrowError("管理员引导参数缺少值");
  });

  it("reuses the existing username, email, and password validation rules", () => {
    expect(() => resolveAdminCredentials(
      ["--username", "x", "--email", "not-an-email", "--password", "short"],
      {},
    )).toThrowError("管理员引导参数格式无效");
  });
});

describe("prepareAdminBootstrapEnvironment", () => {
  it("turns environment-file parsing failures into a safe error", () => {
    expect(() => prepareAdminBootstrapEnvironment(".env", {}, {
      exists: () => true,
      load: () => {
        throw new Error(`invalid ${valid.password} postgresql://secret`);
      },
    })).toThrowError("无法读取本地环境配置");
  });

  it("ignores bootstrap credentials introduced by .env while retaining runtime database config", async () => {
    const env: Record<string, string | undefined> = {};
    const prepared = prepareAdminBootstrapEnvironment(".env", env, {
      exists: () => true,
      load: () => Object.assign(env, {
        ADMIN_BOOTSTRAP_USERNAME: valid.username,
        ADMIN_BOOTSTRAP_EMAIL: valid.email,
        ADMIN_BOOTSTRAP_PASSWORD: valid.password,
        DATABASE_URL: "postgresql://database-url-loaded-from-env",
      }),
    });
    const repositoryFactory = vi.fn();

    await expect(runCreateAdminCommand({
      argv: [],
      env: prepared,
      repositoryFactory,
      hashPasswordHash: vi.fn(),
      writeOut: vi.fn(),
      writeError: vi.fn(),
    })).resolves.toBe(1);

    expect(prepared.DATABASE_URL).toBe("postgresql://database-url-loaded-from-env");
    expect(prepared.ADMIN_BOOTSTRAP_USERNAME).toBeUndefined();
    expect(prepared.ADMIN_BOOTSTRAP_EMAIL).toBeUndefined();
    expect(prepared.ADMIN_BOOTSTRAP_PASSWORD).toBeUndefined();
    expect(env.ADMIN_BOOTSTRAP_PASSWORD).toBeUndefined();
    expect(repositoryFactory).not.toHaveBeenCalled();
  });

  it("preserves credentials injected before startup while loading DATABASE_URL from .env", async () => {
    const env: Record<string, string | undefined> = {
      ADMIN_BOOTSTRAP_USERNAME: valid.username,
      ADMIN_BOOTSTRAP_EMAIL: valid.email,
      ADMIN_BOOTSTRAP_PASSWORD: valid.password,
    };
    const prepared = prepareAdminBootstrapEnvironment(".env", env, {
      exists: () => true,
      load: () => Object.assign(env, {
        ADMIN_BOOTSTRAP_USERNAME: "file-admin",
        ADMIN_BOOTSTRAP_EMAIL: "file-admin@example.com",
        ADMIN_BOOTSTRAP_PASSWORD: "file-password-value",
        DATABASE_URL: "postgresql://database-url-loaded-from-env",
      }),
    });
    const repo = repository();
    const repositoryFactory = vi.fn().mockImplementation(async (receivedEnv) => {
      expect(receivedEnv.DATABASE_URL).toBe("postgresql://database-url-loaded-from-env");
      return { repository: repo, disconnect: vi.fn().mockResolvedValue(undefined) };
    });

    await expect(runCreateAdminCommand({
      argv: [],
      env: prepared,
      repositoryFactory,
      hashPasswordHash: vi.fn().mockResolvedValue("hash"),
      writeOut: vi.fn(),
      writeError: vi.fn(),
    })).resolves.toBe(0);

    expect(repo.createAdmin).toHaveBeenCalledWith(expect.objectContaining({
      username: valid.username,
      email: valid.email,
    }));
    expect(env.ADMIN_BOOTSTRAP_USERNAME).toBe(valid.username);
    expect(env.ADMIN_BOOTSTRAP_EMAIL).toBe(valid.email);
    expect(env.ADMIN_BOOTSTRAP_PASSWORD).toBe(valid.password);
  });
});

describe("bootstrapAdmin", () => {
  it("normalizes identifiers, hashes with the injected auth helper, and creates an active admin", async () => {
    const repo = repository();
    const hashPasswordHash = vi.fn().mockResolvedValue("argon2-password-hash");

    await expect(bootstrapAdmin(valid, { repository: repo, hashPasswordHash })).resolves.toEqual({
      id: "admin-id",
      username: valid.username,
    });

    expect(repo.findAdminByNormalizedUsername).toHaveBeenCalledWith("mai.admin");
    expect(repo.findAdminByNormalizedEmail).toHaveBeenCalledWith("mai.admin@example.com");
    expect(hashPasswordHash).toHaveBeenCalledWith(valid.password);
    expect(repo.createAdmin).toHaveBeenCalledWith({
      role: "ADMIN",
      status: "ACTIVE",
      username: valid.username,
      normalizedUsername: "mai.admin",
      email: valid.email,
      normalizedEmail: "mai.admin@example.com",
      passwordHash: "argon2-password-hash",
    });
    expect(JSON.stringify(vi.mocked(repo.createAdmin).mock.calls[0]?.[0])).not.toContain(valid.password);
  });

  it.each(["username", "email"] as const)(
    "rejects an existing normalized admin %s before hashing and never updates it",
    async (field) => {
      const hashPasswordHash = vi.fn();
      const repo = repository({
        findAdminByNormalizedUsername: vi.fn().mockResolvedValue(field === "username" ? { id: "existing" } : null),
        findAdminByNormalizedEmail: vi.fn().mockResolvedValue(field === "email" ? { id: "existing" } : null),
      });

      await expect(bootstrapAdmin(valid, { repository: repo, hashPasswordHash }))
        .rejects.toThrowError("同角色的管理员用户名或邮箱已存在；未更改任何凭据");
      expect(hashPasswordHash).not.toHaveBeenCalled();
      expect(repo.createAdmin).not.toHaveBeenCalled();
    },
  );

  it("converts a create-time uniqueness race into the same safe refusal", async () => {
    const repo = repository({
      createAdmin: vi.fn().mockRejectedValue({ code: "P2002", meta: { target: valid.password } }),
    });

    await expect(bootstrapAdmin(valid, {
      repository: repo,
      hashPasswordHash: vi.fn().mockResolvedValue("hash"),
    })).rejects.toThrowError("同角色的管理员用户名或邮箱已存在；未更改任何凭据");
  });
});

describe("runCreateAdminCommand", () => {
  it("does not construct a repository when required input is missing", async () => {
    const repositoryFactory = vi.fn();
    const writeError = vi.fn();

    await expect(runCreateAdminCommand({
      argv: [],
      env: {},
      repositoryFactory,
      hashPasswordHash: vi.fn(),
      writeOut: vi.fn(),
      writeError,
    })).resolves.toBe(1);

    expect(repositoryFactory).not.toHaveBeenCalled();
    expect(writeError).toHaveBeenCalledWith("管理员创建失败：缺少管理员引导参数：username、email、password");
  });

  it("prints only a safe success message and always disconnects", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const writeOut = vi.fn();
    const writeError = vi.fn();

    await expect(runCreateAdminCommand({
      argv: ["--username", valid.username, "--email", valid.email, "--password", valid.password],
      env: { DATABASE_URL: "postgresql://secret:secret@database/prod" },
      repositoryFactory: vi.fn().mockResolvedValue({ repository: repository(), disconnect }),
      hashPasswordHash: vi.fn().mockResolvedValue("top-secret-hash"),
      writeOut,
      writeError,
    })).resolves.toBe(0);

    const output = JSON.stringify([writeOut.mock.calls, writeError.mock.calls]);
    expect(output).toContain(valid.username);
    expect(output).not.toContain(valid.password);
    expect(output).not.toContain("top-secret-hash");
    expect(output).not.toContain("postgresql://");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("sanitizes unexpected repository errors and disconnects", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const writeError = vi.fn();

    await expect(runCreateAdminCommand({
      argv: [],
      env: {
        ADMIN_BOOTSTRAP_USERNAME: valid.username,
        ADMIN_BOOTSTRAP_EMAIL: valid.email,
        ADMIN_BOOTSTRAP_PASSWORD: valid.password,
        DATABASE_URL: "postgresql://secret:secret@database/prod",
      },
      repositoryFactory: vi.fn().mockResolvedValue({
        repository: repository({
          createAdmin: vi.fn().mockRejectedValue(new Error(`leaked ${valid.password} postgresql://secret`)),
        }),
        disconnect,
      }),
      hashPasswordHash: vi.fn().mockResolvedValue("top-secret-hash"),
      writeOut: vi.fn(),
      writeError,
    })).resolves.toBe(1);

    expect(writeError).toHaveBeenCalledWith("管理员创建失败：数据库操作未完成，请查看受限的服务端日志");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("sanitizes disconnect errors without printing a premature success", async () => {
    const writeOut = vi.fn();
    const writeError = vi.fn();

    await expect(runCreateAdminCommand({
      argv: [],
      env: {
        ADMIN_BOOTSTRAP_USERNAME: valid.username,
        ADMIN_BOOTSTRAP_EMAIL: valid.email,
        ADMIN_BOOTSTRAP_PASSWORD: valid.password,
        DATABASE_URL: "postgresql://secret:secret@database/prod",
      },
      repositoryFactory: vi.fn().mockResolvedValue({
        repository: repository(),
        disconnect: vi.fn().mockRejectedValue(new Error("postgresql://secret")),
      }),
      hashPasswordHash: vi.fn().mockResolvedValue("top-secret-hash"),
      writeOut,
      writeError,
    })).resolves.toBe(1);

    expect(writeOut).not.toHaveBeenCalled();
    expect(writeError).toHaveBeenCalledWith("管理员创建失败：数据库操作未完成，请查看受限的服务端日志");
  });
});
