import { directoryHandlers } from "@/features/directory/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return directoryHandlers.requests.detail(request, (await params).id);
}
