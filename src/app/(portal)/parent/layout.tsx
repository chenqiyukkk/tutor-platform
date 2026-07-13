import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { getAuthenticatedParent } from "@/features/requests/auth";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  await getAuthenticatedParent();
  return <div className="parent-portal-shell"><header className="parent-portal-header"><Logo /><nav aria-label="家长工作区导航"><Link href="/parent/dashboard">工作台</Link><Link href="/parent/students">学生档案</Link><Link href="/parent/requests/new">发布需求</Link></nav><form action="/api/auth/parent/logout" method="post"><button className="button button--outline button--small" type="submit">退出登录</button></form></header>{children}</div>;
}
