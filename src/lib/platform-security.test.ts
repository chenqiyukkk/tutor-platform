import { describe, expect, it, vi } from "vitest";

import { createStructuredLogger, redactLogValue } from "./logger";
import { FixedWindowRateLimiter } from "./rate-limit";
import { buildSecurityHeaders } from "./security-headers";

describe("platform security primitives", () => {
  it("emits clickjacking, MIME, referrer, permissions and CSP protections", () => {
    const headers = Object.fromEntries(buildSecurityHeaders("production").map(({ key, value }) => [key, value]));
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("limits each key within a fixed window and reports a bounded retry delay", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({ now: () => now, maxEntries: 10 });
    expect(limiter.consume("login:127.0.0.1", { limit: 2, windowMs: 1_000 })).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("login:127.0.0.1", { limit: 2, windowMs: 1_000 })).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("login:127.0.0.1", { limit: 2, windowMs: 1_000 })).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
    now = 2_001;
    expect(limiter.consume("login:127.0.0.1", { limit: 2, windowMs: 1_000 })).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("redacts nested credentials, cookies, emails, reset tokens and URLs before writing JSON", () => {
    const write = vi.fn();
    const logger = createStructuredLogger({ write, now: () => new Date("2026-07-14T00:00:00.000Z") });
    logger.warn("login failed for mai@example.com", {
      password: "secret-password",
      headers: { cookie: "tutor=secret", authorization: "Bearer secret" },
      resetToken: "reset-secret",
      databaseUrl: "postgresql://user:pass@db/prod",
      safe: "kept",
    });
    const line = write.mock.calls[0]?.[0] as string;
    expect(line).toContain("[REDACTED_EMAIL]");
    expect(line).toContain('"safe":"kept"');
    for (const secret of ["secret-password", "tutor=secret", "Bearer secret", "reset-secret", "postgresql://"]) expect(line).not.toContain(secret);
    expect(redactLogValue({ email: "mai@example.com" })).toEqual({ email: "[REDACTED]" });
  });
});
