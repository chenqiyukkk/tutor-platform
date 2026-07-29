import { interactionHandlers } from "@/features/greetings/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return interactionHandlers.greeting.POST(request, (await context.params).id);
}
