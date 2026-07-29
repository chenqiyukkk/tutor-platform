import { RequestForm } from "@/components/requests/request-form";
import { getAuthenticatedParent } from "@/features/requests/auth";
import { getRequestService } from "@/features/requests/server";
import { db } from "@/lib/db";

export default async function NewRequestPage() {
  const account = await getAuthenticatedParent();
  const [students, subjects] = await Promise.all([getRequestService().listStudents(account), db.subject.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } })]);
  return <main className="parent-page portal-page" id="main-content"><header className="parent-page__intro"><p className="eyebrow">新建需求</p><h1>先保存，再慢慢写完整</h1><p>发布前必须选好学生、科目、区县、预算、方式和时间；线上需求也需选择所在区县。</p></header><RequestForm initialRequest={null} students={students} subjects={subjects} /></main>;
}
