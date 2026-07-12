import { PasswordRecoveryPage } from "@/features/auth/password-recovery-page";

export default async function AdminResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";
  return <PasswordRecoveryPage mode="reset" role="admin" token={token} />;
}
