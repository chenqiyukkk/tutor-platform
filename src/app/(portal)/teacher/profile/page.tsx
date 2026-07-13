import { ProfileForm } from "@/components/teachers/profile-form";
import { getAuthenticatedTeacher } from "@/features/teachers/auth";
import { getTeacherProfileService } from "@/features/teachers/server";
import { db } from "@/lib/db";

export default async function TeacherProfilePage() {
  const account = await getAuthenticatedTeacher();
  const [profile, subjects] = await Promise.all([
    getTeacherProfileService().get(account),
    db.subject.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);
  return (
    <main className="teacher-profile-page portal-page" id="main-content">
      <header className="teacher-profile-page__intro">
        <p className="eyebrow">教师资料</p>
        <h1>把教学经验，整理成一张可信的名片</h1>
        <p>草稿可以随时保存；只有资料完整后才能发布给家长查看。</p>
      </header>
      <ProfileForm initialProfile={profile} subjects={subjects} />
    </main>
  );
}
