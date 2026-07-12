import { PasswordRecoveryPage } from "@/features/auth/password-recovery-page";

export default async function ParentResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";
  return <PasswordRecoveryPage mode="reset" role="parent" token={token} />;
}
