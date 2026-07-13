import { parentStudentHandlers } from "@/features/requests/routes";

type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, { params }: Context) { return parentStudentHandlers.member.PUT(request, (await params).id); }
export async function DELETE(request: Request, { params }: Context) { return parentStudentHandlers.member.DELETE(request, (await params).id); }
