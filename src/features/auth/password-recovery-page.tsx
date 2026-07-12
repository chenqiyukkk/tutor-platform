import Link from "next/link";

import { Logo } from "@/components/brand/logo";

import { PasswordRecoveryForm } from "./password-recovery-form";
import { roleLabels, type AuthRole } from "./schemas";

type PasswordRecoveryPageProps =
  | { mode: "forgot"; role: AuthRole }
  | { mode: "reset"; role: AuthRole; token: string };

export function PasswordRecoveryPage(props: PasswordRecoveryPageProps) {
  const { mode, role } = props;
  return (
    <main className={`auth-page auth-page--${role}`} id="main-content">
      <section className="auth-page__panel" aria-labelledby="auth-title">
        <Link className="auth-page__brand" href="/" aria-label="返回家教平台首页">
          <Logo />
        </Link>
        <p className="eyebrow">{roleLabels[role]}专属入口</p>
        <h1 id="auth-title">
          {mode === "forgot" ? `找回${roleLabels[role]}账户` : "设置新密码"}
        </h1>
        <p className="auth-page__intro">
          {mode === "forgot"
            ? "输入账户邮箱；若账户存在，我们会发送一封限时重置邮件。"
            : "新密码设置成功后，请返回对应入口重新登录。"}
        </p>
        {mode === "forgot" ? (
          <PasswordRecoveryForm mode="forgot" role={role} />
        ) : (
          <PasswordRecoveryForm mode="reset" role={role} token={props.token} />
        )}
        <p className="auth-page__switch">
          <Link href={`/${role}/login`}>返回登录</Link>
        </p>
      </section>
      <aside className="auth-page__aside" aria-hidden="true">
        <span>{mode === "forgot" ? "信" : "钥"}</span>
        <p>限时链接 · 一次使用 · 安全重置</p>
      </aside>
    </main>
  );
}
