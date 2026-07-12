import { createPasswordResetHandlers } from "@/features/auth/password-reset-route";
import { getPasswordResetService } from "@/features/auth/server";

const handlers = createPasswordResetHandlers(getPasswordResetService);

export async function POST(
  request: Request,
  context: { params: Promise<{ role: string }> },
) {
  return handlers.resetPassword(request, (await context.params).role);
}
