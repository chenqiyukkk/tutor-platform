import { getAuthService } from "@/features/auth/server";
import { createRoleAuthHandlers } from "@/features/auth/route-handler";

export async function POST(
  request: Request,
  context: { params: Promise<{ role: string }> },
) {
  const handlers = createRoleAuthHandlers(getAuthService());
  return handlers.register(request, (await context.params).role);
}
