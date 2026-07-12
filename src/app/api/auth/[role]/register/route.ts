import { authService } from "@/features/auth/server";
import { createRoleAuthHandlers } from "@/features/auth/route-handler";

const handlers = createRoleAuthHandlers(authService);

export async function POST(
  request: Request,
  context: { params: Promise<{ role: string }> },
) {
  return handlers.register(request, (await context.params).role);
}
