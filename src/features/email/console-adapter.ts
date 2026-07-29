import type { EmailAdapter, PasswordResetEmail } from "./adapter";

export class ConsoleEmailAdapter implements EmailAdapter {
  constructor(private readonly logger: Pick<Console, "info"> = console) {}

  async sendPasswordReset(message: PasswordResetEmail) {
    this.logger.info(`[password-reset:${message.role}] ${message.resetUrl}`);
  }
}
