import { describe, expect, it } from "vitest";

import { getDatabaseEnv, validateServerEnv } from "./env";

describe("validateServerEnv", () => {
  it("returns structured issues when required variables are missing", () => {
    const result = validateServerEnv({});

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "DATABASE_URL" }),
        expect.objectContaining({ path: "SESSION_SECRET" }),
      ]),
    );
  });

  it("rejects invalid values without exposing database credentials or the session secret", () => {
    const databaseUrl =
      "mysql://sensitive-db-user:sensitive-db-password@db.example.test:3306/tutor_platform";
    const secret = "too-short-secret";
    const result = validateServerEnv({
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: secret,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "DATABASE_URL" }),
        expect.objectContaining({ path: "SESSION_SECRET" }),
      ]),
    );
    expect(JSON.stringify(result.error)).not.toContain(databaseUrl);
    expect(JSON.stringify(result.error)).not.toContain("sensitive-db-password");
    expect(JSON.stringify(result.error)).not.toContain(secret);
  });

  it("returns validated server configuration for valid values", () => {
    const input = {
      DATABASE_URL: "postgresql://tutor:tutor@127.0.0.1:5432/tutor_platform",
      SESSION_SECRET: "a-development-secret-with-at-least-32-characters",
    };

    expect(validateServerEnv(input)).toEqual({ success: true, data: input });
  });

  it("loads database configuration without requiring the application session secret", () => {
    const databaseUrl = "postgresql://tutor:tutor@127.0.0.1:5432/tutor_platform";

    expect(getDatabaseEnv({ DATABASE_URL: databaseUrl })).toEqual({
      DATABASE_URL: databaseUrl,
    });
  });
});
