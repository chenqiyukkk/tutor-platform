import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { getAuthenticatedAdmin } from "@/features/moderation/admin-page-auth";

import "./admin.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const nav = [
  ["总览", "/admin/dashboard"], ["用户", "/admin/users"], ["举报", "/admin/reports"], ["认证", "/admin/verifications"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await getAuthenticatedAdmin();
  return <div className="admin-console">
    <header className="admin-console__masthead"><Logo /><div><p>公共服务治理台</p><span>MODERATION DESK · 公开规则，克制处置</span></div><form action="/api/auth/admin/logout" method="post"><button type="submit">退出登录</button></form></header>
    <div className="admin-console__frame">
      <aside><p className="admin-console__index">治理索引 / 04</p><nav aria-label="治理后台导航">{nav.map(([label, href], index) => <Link key={href} href={href}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{label}</Link>)}</nav><p className="admin-console__aside-note">管理员操作均进入不可变审计记录。证据只在主动调阅时读取。</p></aside>
      <div className="admin-console__body">{children}</div>
    </div>
  </div>;
}
