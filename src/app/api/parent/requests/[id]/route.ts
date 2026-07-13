import { parentRequestHandlers } from "@/features/requests/routes";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) { return parentRequestHandlers.member.GET(request, (await params).id); }
export async function PUT(request: Request, { params }: Context) { return parentRequestHandlers.member.PUT(request, (await params).id); }
export async function POST(request: Request, { params }: Context) { return parentRequestHandlers.member.POST(request, (await params).id); }
