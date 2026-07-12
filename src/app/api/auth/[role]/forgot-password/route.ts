import { createPasswordResetHandlers } from "@/features/auth/password-reset-route";
import { passwordResetService } from "@/features/auth/server";

const handlers = createPasswordResetHandlers(passwordResetService);

export async function POST(
  request: Request,
  context: { params: Promise<{ role: string }> },
) {
  return handlers.forgotPassword(request, (await context.params).role);
}
