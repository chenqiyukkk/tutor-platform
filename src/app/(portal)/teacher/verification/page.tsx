import Link from "next/link";

import { VerificationForm } from "@/components/verifications/verification-form";
import { getAuthenticatedTeacher } from "@/features/teachers/auth";
import { verificationService, verificationStorage } from "@/features/verifications/server";
import { VerificationWorkflowError } from "@/features/verifications/service";

export const dynamic = "force-dynamic";

export default async function TeacherVerificationPage() {
  const account = await getAuthenticatedTeacher();
  let verifications = null;
  try {
    verifications = await verificationService.list({ id: account.id, role: "teacher" });
  } catch (error) {
    if (!(error instanceof VerificationWorkflowError) || error.code !== "PROFILE_REQUIRED") throw error;
  }
  return (
    <main className="verification-page portal-page" id="main-content">
      <header className="verification-page__intro">
        <p className="eyebrow">可信资料 · 非付费等级</p>
        <h1>自愿认证</h1>
        <p>在你愿意时，向平台提交材料供人工审核。公开页面只展示审核结论，原始图片不会公开。</p>
      </header>
      {verifications ? (
        <VerificationForm initialVerifications={verifications} uploadEnabled={verificationStorage.enabled} />
      ) : (
        <section className="verification-unavailable" aria-labelledby="verification-profile-required-title">
          <p className="eyebrow">开始之前</p>
          <h2 id="verification-profile-required-title">请先完善教师资料</h2>
          <p>认证会关联到你的教师资料。请先补充基本资料，再回来决定是否自愿提交认证材料。</p>
          <Link className="button button--primary" href="/teacher/profile">前往完善教师资料</Link>
        </section>
      )}
    </main>
  );
}
