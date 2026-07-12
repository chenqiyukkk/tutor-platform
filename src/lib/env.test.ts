import { describe, expect, it } from "vitest";

import { validateServerEnv } from "./env";

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

  it("rejects invalid values without exposing the session secret", () => {
    const secret = "too-short-secret";
    const result = validateServerEnv({
      DATABASE_URL: "not-a-postgres-url",
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
    expect(JSON.stringify(result.error)).not.toContain(secret);
  });

  it("returns validated server configuration for valid values", () => {
    const input = {
      DATABASE_URL: "postgresql://tutor:tutor@127.0.0.1:5432/tutor_platform",
      SESSION_SECRET: "a-development-secret-with-at-least-32-characters",
    };

    expect(validateServerEnv(input)).toEqual({ success: true, data: input });
  });
});
