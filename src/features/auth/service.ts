import { hashPassword, verifyPassword } from "./password";
import {
  loginSchema,
  normalizeEmail,
  normalizeUsername,
  registerSchema,
  type AuthRole,
  type LoginInput,
  type RegisterInput,
} from "./schemas";
import {
  digestSessionToken,
  generateSessionToken,
  SESSION_DURATION_MS,
  assertSessionSecret,
} from "./session";

export type AccountStatus = "active" | "suspended" | "disabled";

export type AccountRecord = {
  id: string;
  role: AuthRole;
  status: AccountStatus;
  username: string;
  normalizedUsername: string;
  email: string;
  normalizedEmail: string;
  passwordHash: string;
};

export type NewAccount = Omit<AccountRecord, "id" | "status">;

export type SessionRecord = {
  id: string;
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  account: AccountRecord;
};

export type NewSession = Pick<SessionRecord, "accountId" | "tokenHash" | "expiresAt">;

export interface AuthRepository {
  findAccountByUsername(role: AuthRole, normalizedUsername: string): Promise<AccountRecord | null>;
  findAccountByEmail(role: AuthRole, normalizedEmail: string): Promise<AccountRecord | null>;
  createAccount(input: NewAccount): Promise<AccountRecord>;
  updateLastLogin(accountId: string, at: Date): Promise<void>;
  createSession(input: NewSession): Promise<SessionRecord>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(tokenHash: string, role: AuthRole): Promise<void>;
}

export type AuthenticatedAccount = Omit<
  AccountRecord,
  "passwordHash" | "normalizedEmail" | "normalizedUsername"
>;

export type AuthErrorCode = "ACCOUNT_EXISTS" | "INVALID_CREDENTIALS" | "UNAUTHORIZED";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class DuplicateAccountError extends Error {
  constructor() {
    super("Duplicate account");
    this.name = "DuplicateAccountError";
  }
}

function toAuthenticatedAccount(account: AccountRecord): AuthenticatedAccount {
  return {
    id: account.id,
    role: account.role,
    status: account.status,
    username: account.username,
    email: account.email,
  };
}

function invalidCredentials(): AuthError {
  return new AuthError("INVALID_CREDENTIALS", "账号或密码错误");
}

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService({
  repository,
  sessionSecret,
  now = () => new Date(),
  createToken = generateSessionToken,
  sessionDurationMs = SESSION_DURATION_MS,
}: {
  repository: AuthRepository;
  sessionSecret: string;
  now?: () => Date;
  createToken?: () => string;
  sessionDurationMs?: number;
}) {
  assertSessionSecret(sessionSecret);

  return {
    async register(role: Exclude<AuthRole, "admin">, rawInput: RegisterInput) {
      const input = registerSchema.parse(rawInput);
      const normalizedUsername = normalizeUsername(input.username);
      const normalizedEmail = normalizeEmail(input.email);
      const [usernameAccount, emailAccount] = await Promise.all([
        repository.findAccountByUsername(role, normalizedUsername),
        repository.findAccountByEmail(role, normalizedEmail),
      ]);

      if (usernameAccount || emailAccount) {
        throw new AuthError("ACCOUNT_EXISTS", "该角色下的用户名或邮箱已被使用");
      }

      try {
        const account = await repository.createAccount({
          role,
          username: input.username,
          normalizedUsername,
          email: input.email,
          normalizedEmail,
          passwordHash: await hashPassword(input.password),
        });
        return toAuthenticatedAccount(account);
      } catch (error) {
        if (error instanceof DuplicateAccountError) {
          throw new AuthError("ACCOUNT_EXISTS", "该角色下的用户名或邮箱已被使用");
        }
        throw error;
      }
    },

    async login(role: AuthRole, rawInput: LoginInput) {
      const input = loginSchema.parse(rawInput);
      const identifier = input.identifier.trim();
      const account = identifier.includes("@")
        ? await repository.findAccountByEmail(role, normalizeEmail(identifier))
        : await repository.findAccountByUsername(role, normalizeUsername(identifier));

      if (!account || account.status !== "active") {
        throw invalidCredentials();
      }

      if (!(await verifyPassword(account.passwordHash, input.password))) {
        throw invalidCredentials();
      }

      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + sessionDurationMs);
      const token = createToken();
      await repository.createSession({
        accountId: account.id,
        tokenHash: digestSessionToken(token, sessionSecret),
        expiresAt,
      });
      await repository.updateLastLogin(account.id, issuedAt);

      return { token, expiresAt, account: toAuthenticatedAccount(account) };
    },

    async getSession(role: AuthRole, token: string | undefined | null) {
      if (!token) {
        throw new AuthError("UNAUTHORIZED", "请先登录");
      }

      const session = await repository.findSession(digestSessionToken(token, sessionSecret));
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= now().getTime() ||
        session.account.status !== "active" ||
        session.account.role !== role
      ) {
        throw new AuthError("UNAUTHORIZED", "登录状态无效或已过期");
      }

      return toAuthenticatedAccount(session.account);
    },

    async logout(role: AuthRole, token: string | undefined | null) {
      if (!token) return;
      await repository.revokeSession(digestSessionToken(token, sessionSecret), role);
    },
  };
}
