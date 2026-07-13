import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { getAuthenticatedTeacher } from "@/features/teachers/auth";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  await getAuthenticatedTeacher();
  return (
    <div className="teacher-portal-shell">
      <header className="teacher-portal-header">
        <Logo />
        <nav aria-label="教师工作区导航">
          <Link href="/teacher/dashboard">工作台</Link>
          <Link href="/teacher/profile">教师资料</Link>
          <Link href="/teacher/greetings">往来卡片</Link>
        </nav>
        <form action="/api/auth/teacher/logout" method="post">
          <button className="button button--outline button--small" type="submit">退出登录</button>
        </form>
      </header>
      {children}
    </div>
  );
}
