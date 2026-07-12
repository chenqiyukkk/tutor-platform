import { createRoleAuthHandlers } from "@/features/auth/route-handler";
import { authService } from "@/features/auth/server";

const handlers = createRoleAuthHandlers(authService);

export async function POST(
  request: Request,
  context: { params: Promise<{ role: string }> },
) {
  return handlers.logout(request, (await context.params).role);
}
