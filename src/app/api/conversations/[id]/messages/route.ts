import { chatHandlers } from "@/features/chat/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return chatHandlers.messages.GET(request, (await params).id);
}

export async function POST(request: Request, { params }: Context) {
  return chatHandlers.messages.POST(request, (await params).id);
}
