import { TeacherDashboard } from "@/components/teachers/teacher-dashboard";
import { getAuthenticatedTeacher } from "@/features/teachers/auth";
import { getTeacherProfileService } from "@/features/teachers/server";

export default async function TeacherDashboardPage() {
  const account = await getAuthenticatedTeacher();
  const profile = await getTeacherProfileService().get(account);
  return <TeacherDashboard profile={profile} username={account.username} />;
}
