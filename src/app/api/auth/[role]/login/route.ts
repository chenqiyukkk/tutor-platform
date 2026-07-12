import { createRoleAuthHandlers } from "@/features/auth/route-handler";
import { getAuthService } from "@/features/auth/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ role: string }> },
) {
  const handlers = createRoleAuthHandlers(getAuthService());
  return handlers.login(request, (await context.params).role);
}
