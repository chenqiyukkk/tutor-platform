import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { AuthError, type AuthenticatedAccount } from "@/features/auth/service";
import { sessionCookieNames } from "@/features/auth/session";

import { RequestWorkflowError, toRequestDto, type RequestService } from "./service";

const actionSchema = z.object({ action: z.enum(["publish", "close"]) }).strict();

function cookieValue(request: Request, name: string) {
  for (const cookie of (request.headers.get("cookie") ?? "").split(";")) {
    const [rawName, ...value] = cookie.trim().split("=");
    if (rawName === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

async function readJson(request: Request) {
  try { return await request.json(); } catch {
    throw new RequestWorkflowError("INVALID_INPUT", "请求内容格式不正确", { form: ["请提交有效的 JSON 内容"] });
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return NextResponse.json({ error: "请先登录", code: "UNAUTHORIZED" }, { status: 401 });
  if (error instanceof ZodError) return NextResponse.json({ error: "操作无效", code: "INVALID_INPUT" }, { status: 400 });
  if (error instanceof RequestWorkflowError) {
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code, ...(Object.keys(error.fieldErrors).length ? { fieldErrors: error.fieldErrors } : {}) }, { status });
  }
  throw error;
}

type Dependencies = { authenticate(token: string | undefined): Promise<AuthenticatedAccount>; service: RequestService };

export function createStudentHandlers({ authenticate, service }: Dependencies) {
  const caller = (request: Request) => authenticate(cookieValue(request, sessionCookieNames.parent));
  return {
    collection: {
      async GET(request: Request) {
        try { return NextResponse.json({ students: await service.listStudents(await caller(request)) }); } catch (error) { return errorResponse(error); }
      },
      async POST(request: Request) {
        try { return NextResponse.json({ student: await service.createStudent(await caller(request), await readJson(request)) }, { status: 201 }); } catch (error) { return errorResponse(error); }
      },
    },
    member: {
      async PUT(request: Request, id: string) {
        try { return NextResponse.json({ student: await service.updateStudent(await caller(request), id, await readJson(request)) }); } catch (error) { return errorResponse(error); }
      },
      async DELETE(request: Request, id: string) {
        try { await service.deactivateStudent(await caller(request), id); return new NextResponse(null, { status: 204 }); } catch (error) { return errorResponse(error); }
      },
    },
  };
}

export function createRequestHandlers({ authenticate, service }: Dependencies) {
  const caller = (request: Request) => authenticate(cookieValue(request, sessionCookieNames.parent));
  return {
    collection: {
      async GET(request: Request) {
        try { return NextResponse.json({ requests: (await service.listRequests(await caller(request))).map(toRequestDto) }); } catch (error) { return errorResponse(error); }
      },
      async POST(request: Request) {
        try { return NextResponse.json({ request: toRequestDto(await service.createDraft(await caller(request), await readJson(request))) }, { status: 201 }); } catch (error) { return errorResponse(error); }
      },
    },
    member: {
      async GET(request: Request, id: string) {
        try { return NextResponse.json({ request: toRequestDto(await service.getRequest(await caller(request), id)) }); } catch (error) { return errorResponse(error); }
      },
      async PUT(request: Request, id: string) {
        try { return NextResponse.json({ request: toRequestDto(await service.updateDraft(await caller(request), id, await readJson(request))) }); } catch (error) { return errorResponse(error); }
      },
      async POST(request: Request, id: string) {
        try {
          const account = await caller(request);
          const { action } = actionSchema.parse(await readJson(request));
          const result = action === "publish" ? await service.publish(account, id) : await service.close(account, id);
          return NextResponse.json({ request: toRequestDto(result) });
        } catch (error) { return errorResponse(error); }
      },
    },
  };
}
