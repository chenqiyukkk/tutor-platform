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

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type EnvironmentIssue = {
  path: keyof ServerEnv | "environment";
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
    path: (issue.path[0] as keyof ServerEnv | undefined) ?? "environment",
    code: issue.code,
    message: issue.message,
  }));
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
