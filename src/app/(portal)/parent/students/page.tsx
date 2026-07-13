import { StudentManager } from "@/components/parents/student-manager";
import { getAuthenticatedParent } from "@/features/requests/auth";
import { getRequestService } from "@/features/requests/server";

export default async function ParentStudentsPage() {
  const account = await getAuthenticatedParent();
  const students = await getRequestService().listStudents(account);
  return <main className="parent-page portal-page" id="main-content"><header className="parent-page__intro"><p className="eyebrow">学生档案</p><h1>昵称公开，隐私留在家里</h1><p>需求卡片只展示学习昵称与年级；内部备注不会公开给教师。</p></header><StudentManager initialStudents={students} /></main>;
}
