import { describe, expect, it } from "vitest";

import { getDatabaseEnv, validateEmailEnv, validateServerEnv } from "./env";

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

describe("validateEmailEnv", () => {
  it("uses the console adapter only outside production", () => {
    expect(validateEmailEnv({}, "development")).toEqual({
      success: true,
      data: { mode: "console", APP_URL: "http://localhost:3000" },
    });
    expect(validateEmailEnv({}, "test")).toEqual({
      success: true,
      data: { mode: "console", APP_URL: "http://localhost:3000" },
    });
  });

  it("fails closed in production when any SMTP setting or APP_URL is missing", () => {
    const result = validateEmailEnv({
      APP_URL: "https://tutor.example.test",
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "sensitive-user",
      SMTP_PASS: "sensitive-password",
    }, "production");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "SMTP_PORT" }),
      expect.objectContaining({ path: "SMTP_FROM" }),
    ]));
    expect(JSON.stringify(result.error)).not.toContain("sensitive-user");
    expect(JSON.stringify(result.error)).not.toContain("sensitive-password");
  });

  it("returns a complete SMTP configuration in production", () => {
    const input = {
      APP_URL: "https://tutor.example.test",
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_USER: "mailer",
      SMTP_PASS: "smtp-secret",
      SMTP_FROM: "Tutor Platform <no-reply@example.test>",
    };
    expect(validateEmailEnv(input, "production")).toEqual({
      success: true,
      data: {
        mode: "smtp",
        APP_URL: input.APP_URL,
        SMTP_HOST: input.SMTP_HOST,
        SMTP_PORT: 587,
        SMTP_USER: input.SMTP_USER,
        SMTP_PASS: input.SMTP_PASS,
        SMTP_FROM: input.SMTP_FROM,
      },
    });
  });

  it.each([
    { field: "APP_URL", value: "http://tutor.example.test" },
    { field: "SMTP_PORT", value: "25" },
    { field: "SMTP_PORT", value: "2525" },
    { field: "SMTP_FROM", value: "first@example.test, second@example.test" },
    { field: "SMTP_FROM", value: "safe@example.test\r\nBcc: stolen@example.test" },
  ])("rejects unsafe production $field without exposing its value", ({ field, value }) => {
    const input = {
      APP_URL: "https://tutor.example.test",
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_USER: "mailer",
      SMTP_PASS: "smtp-secret",
      SMTP_FROM: "Tutor Platform <no-reply@example.test>",
      [field]: value,
    };
    const result = validateEmailEnv(input, "production");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: field }),
    ]));
    expect(JSON.stringify(result.error)).not.toContain(value);
  });
});
