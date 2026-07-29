import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import type { EmailAdapter, PasswordResetEmail } from "./adapter";

export type SmtpEmailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

type SmtpTransport = Pick<Transporter, "sendMail">;
export type SmtpTransportFactory = (options: SMTPTransport.Options) => SmtpTransport;

type SmtpEmailAdapterOptions = {
  transportFactory?: SmtpTransportFactory;
  now?: () => Date;
};

export class SmtpEmailAdapter implements EmailAdapter {
  private readonly transporter: SmtpTransport;
  private readonly now: () => Date;

  constructor(
    private readonly config: SmtpEmailConfig,
    options: SmtpEmailAdapterOptions = {},
  ) {
    const transportFactory = options.transportFactory
      ?? ((transportOptions: SMTPTransport.Options) => nodemailer.createTransport(transportOptions));
    this.now = options.now ?? (() => new Date());
    this.transporter = transportFactory({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.port === 587,
      auth: { user: config.user, pass: config.pass },
      tls: { minVersion: "TLSv1.2" },
    });
  }

  async sendPasswordReset(message: PasswordResetEmail) {
    const ttlMinutes = Math.max(
      1,
      Math.ceil((message.expiresAt.getTime() - this.now().getTime()) / 60_000),
    );
    await this.transporter.sendMail({
      from: this.config.from,
      to: message.to,
      subject: "重置你的家教平台密码",
      text: [
        "我们收到了重置密码的请求。",
        `请在 ${ttlMinutes} 分钟内打开以下链接：${message.resetUrl}`,
        "如果不是你本人操作，可以忽略这封邮件。",
      ].join("\n\n"),
    });
  }
}
