import { adminModerationHandlers } from "@/features/moderation/admin-server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return adminModerationHandlers.verifications.PATCH(request, (await params).id);
}
