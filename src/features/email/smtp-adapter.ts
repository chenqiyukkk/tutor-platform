import nodemailer, { type Transporter } from "nodemailer";

import type { EmailAdapter, PasswordResetEmail } from "./adapter";

export type SmtpEmailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

export class SmtpEmailAdapter implements EmailAdapter {
  private readonly transporter: Transporter;

  constructor(
    private readonly config: SmtpEmailConfig,
    transporter?: Transporter,
  ) {
    this.transporter = transporter ?? nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });
  }

  async sendPasswordReset(message: PasswordResetEmail) {
    await this.transporter.sendMail({
      from: this.config.from,
      to: message.to,
      subject: "重置你的家教平台密码",
      text: [
        "我们收到了重置密码的请求。",
        `请在 30 分钟内打开以下链接：${message.resetUrl}`,
        "如果不是你本人操作，可以忽略这封邮件。",
      ].join("\n\n"),
    });
  }
}
