import Link from "next/link";

import { Logo } from "@/components/brand/logo";

import { AuthForm } from "./auth-form";
import { roleLabels, type AuthRole, type PublicAuthRole } from "./schemas";

type AuthPageProps =
  | { mode: "login"; role: AuthRole }
  | { mode: "register"; role: PublicAuthRole };

export function AuthPage(props: AuthPageProps) {
  const { mode, role } = props;
  const registering = mode === "register";

  return (
    <main className={`auth-page auth-page--${role}`} id="main-content">
      <section className="auth-page__panel" aria-labelledby="auth-title">
        <Logo className="auth-page__brand" />
        <p className="eyebrow">{roleLabels[role]}专属入口</p>
        <h1 id="auth-title">{registering ? "建立你的平台账户" : "欢迎回来"}</h1>
        <p className="auth-page__intro">
          {role === "teacher" && "展示你的教学经验，与真正需要你的家庭相遇。"}
          {role === "parent" && "把需求说明白，在生活圈里找到合适的老师。"}
          {role === "admin" && "仅限平台预置的管理账户访问。"}
        </p>
        {mode === "login" ? (
          <AuthForm mode="login" role={role} />
        ) : (
          <AuthForm mode="register" role={role} />
        )}
        {mode === "login" ? (
          <p className="auth-page__recovery">
            <Link href={`/${role}/forgot-password`}>忘记密码？</Link>
          </p>
        ) : null}
        {role !== "admin" ? (
          <p className="auth-page__switch">
            {registering ? "已有账户？" : "还没有账户？"}
            <Link href={`/${role}/${registering ? "login" : "register"}`}>
              {registering ? "直接登录" : "现在注册"}
            </Link>
          </p>
        ) : null}
      </section>
      <aside className="auth-page__aside" aria-hidden="true">
        <span>{role === "teacher" ? "授" : role === "parent" ? "寻" : "管"}</span>
        <p>真实资料 · 独立身份 · 安心连接</p>
      </aside>
    </main>
  );
}
