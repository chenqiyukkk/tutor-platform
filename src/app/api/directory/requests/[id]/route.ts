import { directoryHandlers } from "@/features/directory/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return directoryHandlers.requests.detail((await params).id);
}
