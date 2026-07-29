import { chatHandlers } from "@/features/chat/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return chatHandlers.read.POST(request, (await params).id);
}
