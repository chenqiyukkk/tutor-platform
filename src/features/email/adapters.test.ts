import { describe, expect, it, vi } from "vitest";

import { ConsoleEmailAdapter } from "./console-adapter";
import { SmtpEmailAdapter } from "./smtp-adapter";

const message = {
  to: "mai@example.test",
  role: "teacher" as const,
  resetUrl: "https://tutor.example.test/teacher/reset-password?token=raw-token",
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

  it("sends the raw reset URL through the configured SMTP transport", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "test" });
    const adapter = new SmtpEmailAdapter({
      host: "smtp.example.test",
      port: 587,
      user: "mailer",
      pass: "smtp-secret",
      from: "Tutor Platform <no-reply@example.test>",
    }, { sendMail } as never);

    await adapter.sendPasswordReset(message);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: message.to,
      from: "Tutor Platform <no-reply@example.test>",
      text: expect.stringContaining(message.resetUrl),
    }));
  });
});
