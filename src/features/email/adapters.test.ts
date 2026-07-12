import { describe, expect, it, vi } from "vitest";

import { ConsoleEmailAdapter } from "./console-adapter";
import { SmtpEmailAdapter } from "./smtp-adapter";

const message = {
  to: "mai@example.test",
  role: "teacher" as const,
  resetUrl: "https://tutor.example.test/teacher/reset-password#token=raw-token",
  expiresAt: new Date("2030-01-01T00:30:00.000Z"),
};

describe("email adapters", () => {
  it("prints only the development reset URL without a password or token digest", async () => {
    const logger = { info: vi.fn() };
    await new ConsoleEmailAdapter(logger).sendPasswordReset(message);

    const output = JSON.stringify(logger.info.mock.calls);
    expect(output).toContain(message.resetUrl);
    expect(output).not.toContain("passwordHash");
    expect(output).not.toContain("tokenHash");
    expect(output).not.toContain("smtp-password");
  });

  it.each([
    { port: 465, secure: true, requireTLS: false },
    { port: 587, secure: false, requireTLS: true },
  ])("creates a secure SMTP transport for port $port", async ({ port, secure, requireTLS }) => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "test" });
    const transportFactory = vi.fn(() => ({ sendMail } as never));
    const adapter = new SmtpEmailAdapter({
      host: "smtp.example.test",
      port,
      user: "mailer",
      pass: "smtp-secret",
      from: "Tutor Platform <no-reply@example.test>",
    }, { transportFactory, now: () => new Date("2030-01-01T00:00:00.000Z") });

    await adapter.sendPasswordReset(message);

    expect(transportFactory).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port,
      secure,
      requireTLS,
      auth: { user: "mailer", pass: "smtp-secret" },
      tls: { minVersion: "TLSv1.2" },
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: message.to,
      from: "Tutor Platform <no-reply@example.test>",
      text: expect.stringContaining(message.resetUrl),
    }));
  });

  it("derives the displayed TTL from expiresAt", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "test" });
    const adapter = new SmtpEmailAdapter({
      host: "smtp.example.test",
      port: 587,
      user: "mailer",
      pass: "smtp-secret",
      from: "no-reply@example.test",
    }, {
      transportFactory: () => ({ sendMail } as never),
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });

    await adapter.sendPasswordReset({
      ...message,
      expiresAt: new Date("2030-01-01T00:47:00.000Z"),
    });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("47 分钟内"),
    }));
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain("30 分钟内");
  });
});
