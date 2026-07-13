import { directoryHandlers } from "@/features/directory/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return directoryHandlers.teachers.detail((await params).id);
}
