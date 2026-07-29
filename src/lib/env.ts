import { z } from "zod";

const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .url("must be a valid URL")
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "must use the PostgreSQL protocol",
    ),
});

const serverEnvSchema = databaseEnvSchema.extend({
  SESSION_SECRET: z.string().min(32, "must contain at least 32 characters"),
});

const consoleEmailEnvSchema = z.object({
  APP_URL: z.url("must be a valid URL").default("http://localhost:3000"),
});

const mailboxAddressSchema = z.string().email();

function isSafeMailbox(value: string) {
  if (/[\r\n,]/.test(value)) return false;
  const namedMailbox = value.match(/^([^<>]+?)\s*<([^<>]+)>$/);
  if (namedMailbox) {
    return Boolean(namedMailbox[1].trim()) && mailboxAddressSchema.safeParse(
      namedMailbox[2].trim(),
    ).success;
  }
  return !/[<>]/.test(value) && mailboxAddressSchema.safeParse(value).success;
}

const smtpEmailEnvSchema = z.object({
  APP_URL: z.url("must be a valid URL").refine(
    (value) => new URL(value).protocol === "https:",
    "must use HTTPS in production",
  ),
  SMTP_HOST: z.string().trim().min(1, "is required"),
  SMTP_PORT: z.enum(["465", "587"]).transform((value) => value === "465" ? 465 as const : 587 as const),
  SMTP_USER: z.string().min(1, "is required"),
  SMTP_PASS: z.string().min(1, "is required"),
  SMTP_FROM: z.string().trim().min(1, "is required").refine(
    isSafeMailbox,
    "must be a single valid mailbox",
  ),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type EmailEnv =
  | ({ mode: "console" } & z.infer<typeof consoleEmailEnvSchema>)
  | ({ mode: "smtp" } & z.infer<typeof smtpEmailEnvSchema>);

type EnvironmentVariable = keyof ServerEnv
  | "APP_URL"
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_USER"
  | "SMTP_PASS"
  | "SMTP_FROM"
  | "environment";

export type EnvironmentIssue = {
  path: EnvironmentVariable;
  code: string;
  message: string;
};

export type EnvironmentValidationResult =
  | { success: true; data: ServerEnv }
  | { success: false; error: { name: "EnvironmentValidationError"; issues: EnvironmentIssue[] } };

export type DatabaseEnvironmentValidationResult =
  | { success: true; data: DatabaseEnv }
  | { success: false; error: { name: "EnvironmentValidationError"; issues: EnvironmentIssue[] } };

function toEnvironmentIssues(error: z.ZodError): EnvironmentIssue[] {
  return error.issues.map((issue) => ({
    path: (issue.path[0] as EnvironmentVariable | undefined) ?? "environment",
    code: issue.code,
    message: issue.message,
  }));
}

export type EmailEnvironmentValidationResult =
  | { success: true; data: EmailEnv }
  | { success: false; error: { name: "EnvironmentValidationError"; issues: EnvironmentIssue[] } };

export function validateEmailEnv(
  input: Record<string, string | undefined>,
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): EmailEnvironmentValidationResult {
  const schema = nodeEnv === "production" ? smtpEmailEnvSchema : consoleEmailEnvSchema;
  const result = schema.safeParse(input);
  if (result.success) {
    return {
      success: true,
      data: nodeEnv === "production"
        ? { mode: "smtp", ...result.data } as EmailEnv
        : { mode: "console", ...result.data } as EmailEnv,
    };
  }
  return {
    success: false,
    error: {
      name: "EnvironmentValidationError",
      issues: toEnvironmentIssues(result.error),
    },
  };
}

export function validateDatabaseEnv(
  input: Record<string, string | undefined>,
): DatabaseEnvironmentValidationResult {
  const result = databaseEnvSchema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: {
      name: "EnvironmentValidationError",
      issues: toEnvironmentIssues(result.error),
    },
  };
}

export function validateServerEnv(
  input: Record<string, string | undefined>,
): EnvironmentValidationResult {
  const result = serverEnvSchema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: {
      name: "EnvironmentValidationError",
      issues: toEnvironmentIssues(result.error),
    },
  };
}

export class EnvironmentValidationError extends Error {
  readonly issues: EnvironmentIssue[];

  constructor(issues: EnvironmentIssue[]) {
    const invalidVariables = [...new Set(issues.map((issue) => issue.path))].join(", ");
    super(`Invalid server environment variables: ${invalidVariables}`);
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

export function getDatabaseEnv(
  input: Record<string, string | undefined> = process.env,
): DatabaseEnv {
  const result = validateDatabaseEnv(input);

  if (!result.success) {
    throw new EnvironmentValidationError(result.error.issues);
  }

  return result.data;
}

export function getServerEnv(
  input: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = validateServerEnv(input);

  if (!result.success) {
    throw new EnvironmentValidationError(result.error.issues);
  }

  return result.data;
}

export function getEmailEnv(
  input: Record<string, string | undefined> = process.env,
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): EmailEnv {
  const result = validateEmailEnv(input, nodeEnv);
  if (!result.success) throw new EnvironmentValidationError(result.error.issues);
  return result.data;
}
