import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";

import { requireSessionRole } from "./guards";
import { roleLabels, type AuthRole } from "./schemas";
import { authService } from "./server";
import { sessionCookieNames } from "./session";

export async function RoleDashboard({ role }: { role: AuthRole }) {
  const cookieStore = await cookies();
  let account;

  try {
    account = await requireSessionRole(
      authService,
      role,
      cookieStore.get(sessionCookieNames[role])?.value,
    );
  } catch {
    redirect(`/${role}/login`);
  }

  return (
    <main className="dashboard-shell" id="main-content">
      <header className="dashboard-header">
        <Logo />
        <form action={`/api/auth/${role}/logout`} method="post">
          <button className="button button--outline button--small" type="submit">退出登录</button>
        </form>
      </header>
      <section className="dashboard-card">
        <p className="eyebrow">{roleLabels[role]}工作区</p>
        <h1>你好，{account.username}</h1>
        <p>身份验证与角色隔离已生效。后续业务功能会在对应阶段接入。</p>
        <dl>
          <div><dt>当前身份</dt><dd>{roleLabels[account.role]}</dd></div>
          <div><dt>账户邮箱</dt><dd>{account.email}</dd></div>
        </dl>
        <Link className="text-link" href="/">返回平台首页 <span aria-hidden="true">→</span></Link>
      </section>
    </main>
  );
}
