import { notFound } from "next/navigation";

import { RequestForm } from "@/components/requests/request-form";
import { getAuthenticatedParent } from "@/features/requests/auth";
import { getRequestService } from "@/features/requests/server";
import { RequestWorkflowError, toRequestDto } from "@/features/requests/service";
import { db } from "@/lib/db";

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await getAuthenticatedParent();
  const id = (await params).id;
  let request;
  try {
    request = await getRequestService().getRequest(account, id);
  } catch (error) {
    if (error instanceof RequestWorkflowError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [students, subjects] = await Promise.all([getRequestService().listStudents(account), db.subject.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } })]);
  const visibleSubjects = [...subjects];
  for (const subject of request.subjects) if (!visibleSubjects.some(({ id: subjectId }) => subjectId === subject.id)) visibleSubjects.push({ id: subject.id, name: `${subject.name}（已停用）` });
  return <main className="parent-page portal-page" id="main-content"><header className="parent-page__intro"><p className="eyebrow">编辑需求</p><h1>{request.status === "CLOSED" ? "这条需求已经归档" : "调整信息，再决定何时公开"}</h1><p>已发布需求保存后会自动回到草稿，避免未经确认的修改直接公开。</p></header><RequestForm initialRequest={toRequestDto(request)} students={students} subjects={visibleSubjects} /></main>;
}
