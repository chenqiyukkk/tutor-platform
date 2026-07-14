import { adminModerationHandlers } from "@/features/moderation/admin-server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return adminModerationHandlers.evidence.GET(request, (await params).id);
}
