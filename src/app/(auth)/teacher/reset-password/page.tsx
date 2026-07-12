import { PasswordRecoveryPage } from "@/features/auth/password-recovery-page";

export default async function TeacherResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";
  return <PasswordRecoveryPage mode="reset" role="teacher" token={token} />;
}
