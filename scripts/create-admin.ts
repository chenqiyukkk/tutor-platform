import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/features/auth/password";
import {
  normalizeEmail,
  normalizeUsername,
  registerSchema,
} from "../src/features/auth/schemas";

type AdminCredentials = {
  username: string;
  email: string;
  password: string;
};

type NewAdmin = {
  role: "ADMIN";
  status: "ACTIVE";
  username: string;
  normalizedUsername: string;
  email: string;
  normalizedEmail: string;
  passwordHash: string;
};

export interface AdminBootstrapRepository {
  findAdminByNormalizedUsername(normalizedUsername: string): Promise<{ id: string } | null>;
  findAdminByNormalizedEmail(normalizedEmail: string): Promise<{ id: string } | null>;
  createAdmin(input: NewAdmin): Promise<{ id: string; username: string }>;
}

type BootstrapErrorCode = "INVALID_INPUT" | "ACCOUNT_EXISTS" | "DATABASE_ERROR";

export class AdminBootstrapError extends Error {
  constructor(
    readonly code: BootstrapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdminBootstrapError";
  }
}

const bootstrapEnvironmentKeys = [
  "ADMIN_BOOTSTRAP_USERNAME",
  "ADMIN_BOOTSTRAP_EMAIL",
  "ADMIN_BOOTSTRAP_PASSWORD",
] as const;

export function prepareAdminBootstrapEnvironment(
  envFile: string,
  env: Record<string, string | undefined>,
  {
    exists = existsSync,
    load = loadEnvFile,
  }: {
    exists?: (path: string) => boolean;
    load?: (path: string) => void;
  } = {},
) {
  const injectedBootstrap = Object.fromEntries(
    bootstrapEnvironmentKeys.map((key) => [key, env[key]]),
  ) as Record<(typeof bootstrapEnvironmentKeys)[number], string | undefined>;

  const restoreBootstrap = () => {
    for (const key of bootstrapEnvironmentKeys) {
      const value = injectedBootstrap[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  };

  if (!exists(envFile)) return { ...env };
  try {
    load(envFile);
  } catch {
    restoreBootstrap();
    throw new AdminBootstrapError("INVALID_INPUT", "无法读取本地环境配置");
  }
  restoreBootstrap();
  return { ...env };
}

const cliOptions = ["username", "email", "password"] as const;
type CliOption = (typeof cliOptions)[number];

function isCliOption(value: string): value is CliOption {
  return cliOptions.some((option) => option === value);
}

function parseCliOptions(argv: readonly string[]) {
  const parsed: Partial<Record<CliOption, string>> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new AdminBootstrapError("INVALID_INPUT", "不支持的管理员引导参数");
    }

    const separator = token.indexOf("=");
    const name = token.slice(2, separator === -1 ? undefined : separator);
    if (!isCliOption(name)) {
      throw new AdminBootstrapError("INVALID_INPUT", "不支持的管理员引导参数");
    }
    if (parsed[name] !== undefined) {
      throw new AdminBootstrapError("INVALID_INPUT", "管理员引导参数重复");
    }

    const inlineValue = separator === -1 ? undefined : token.slice(separator + 1);
    const followingValue = separator === -1 ? argv[index + 1] : undefined;
    const value = inlineValue ?? followingValue;
    if (!value || (separator === -1 && value.startsWith("--"))) {
      throw new AdminBootstrapError("INVALID_INPUT", "管理员引导参数缺少值");
    }
    parsed[name] = value;
    if (separator === -1) index += 1;
  }

  return parsed;
}

function validateCredentials(input: AdminCredentials): AdminCredentials {
  const result = registerSchema.safeParse(input);
  if (!result.success) {
    throw new AdminBootstrapError("INVALID_INPUT", "管理员引导参数格式无效");
  }
  return result.data;
}

export function resolveAdminCredentials(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
) {
  const cli = parseCliOptions(argv);
  const input = {
    username: cli.username ?? env.ADMIN_BOOTSTRAP_USERNAME,
    email: cli.email ?? env.ADMIN_BOOTSTRAP_EMAIL,
    password: cli.password ?? env.ADMIN_BOOTSTRAP_PASSWORD,
  };
  const missing = cliOptions.filter((key) => input[key] === undefined || input[key] === "");
  if (missing.length > 0) {
    throw new AdminBootstrapError(
      "INVALID_INPUT",
      `缺少管理员引导参数：${missing.join("、")}`,
    );
  }
  return validateCredentials(input as AdminCredentials);
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function bootstrapAdmin(
  rawInput: AdminCredentials,
  {
    repository,
    hashPasswordHash = hashPassword,
  }: {
    repository: AdminBootstrapRepository;
    hashPasswordHash?: (password: string) => Promise<string>;
  },
) {
  const input = validateCredentials(rawInput);
  const normalizedUsername = normalizeUsername(input.username);
  const normalizedEmail = normalizeEmail(input.email);
  const [usernameAccount, emailAccount] = await Promise.all([
    repository.findAdminByNormalizedUsername(normalizedUsername),
    repository.findAdminByNormalizedEmail(normalizedEmail),
  ]);

  if (usernameAccount || emailAccount) {
    throw new AdminBootstrapError(
      "ACCOUNT_EXISTS",
      "同角色的管理员用户名或邮箱已存在；未更改任何凭据",
    );
  }

  try {
    return await repository.createAdmin({
      role: "ADMIN",
      status: "ACTIVE",
      username: input.username,
      normalizedUsername,
      email: input.email,
      normalizedEmail,
      passwordHash: await hashPasswordHash(input.password),
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AdminBootstrapError(
        "ACCOUNT_EXISTS",
        "同角色的管理员用户名或邮箱已存在；未更改任何凭据",
      );
    }
    throw new AdminBootstrapError("DATABASE_ERROR", "数据库操作未完成，请查看受限的服务端日志");
  }
}

type RepositoryHandle = {
  repository: AdminBootstrapRepository;
  disconnect(): Promise<void>;
};

type CommandDependencies = {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  repositoryFactory(env: Readonly<Record<string, string | undefined>>): Promise<RepositoryHandle>;
  hashPasswordHash?: (password: string) => Promise<string>;
  writeOut(message: string): void;
  writeError(message: string): void;
};

export async function runCreateAdminCommand({
  argv,
  env,
  repositoryFactory,
  hashPasswordHash = hashPassword,
  writeOut,
  writeError,
}: CommandDependencies) {
  let handle: RepositoryHandle | undefined;
  let account: { id: string; username: string } | undefined;
  let failure: unknown;
  try {
    const input = resolveAdminCredentials(argv, env);
    handle = await repositoryFactory(env);
    account = await bootstrapAdmin(input, { repository: handle.repository, hashPasswordHash });
  } catch (error) {
    failure = error;
  }

  if (handle) {
    try {
      await handle.disconnect();
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure || !account) {
    const message = failure instanceof AdminBootstrapError
      ? failure.message
      : "数据库操作未完成，请查看受限的服务端日志";
    writeError(`管理员创建失败：${message}`);
    return 1;
  }

  writeOut(`管理员账号已创建：${account.username}`);
  return 0;
}

async function createPrismaRepository(
  env: Readonly<Record<string, string | undefined>>,
): Promise<RepositoryHandle> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new AdminBootstrapError("INVALID_INPUT", "缺少 DATABASE_URL");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  return {
    repository: {
      findAdminByNormalizedUsername: (normalizedUsername) => prisma.account.findUnique({
        where: { role_normalizedUsername: { role: "ADMIN", normalizedUsername } },
        select: { id: true },
      }),
      findAdminByNormalizedEmail: (normalizedEmail) => prisma.account.findUnique({
        where: { role_normalizedEmail: { role: "ADMIN", normalizedEmail } },
        select: { id: true },
      }),
      createAdmin: (input) => prisma.account.create({
        data: input,
        select: { id: true, username: true },
      }),
    },
    disconnect: () => prisma.$disconnect(),
  };
}

async function main() {
  const envFile = resolve(".env");
  let env: Record<string, string | undefined>;
  try {
    env = prepareAdminBootstrapEnvironment(envFile, process.env);
  } catch {
    console.error("管理员创建失败：无法读取本地环境配置");
    process.exitCode = 1;
    return;
  }
  process.exitCode = await runCreateAdminCommand({
    argv: process.argv.slice(2),
    env,
    repositoryFactory: createPrismaRepository,
    writeOut: (message) => console.log(message),
    writeError: (message) => console.error(message),
  });
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPath === import.meta.url) {
  void main();
}
