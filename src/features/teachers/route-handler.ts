import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { AuthError, type AuthenticatedAccount } from "@/features/auth/service";
import { sessionCookieNames } from "@/features/auth/session";

import {
  TeacherProfileError,
  calculateProfileCompletion,
  toTeacherProfileDto,
  type TeacherProfileService,
} from "./service";

const actionSchema = z.object({ action: z.enum(["publish", "unpublish"]) }).strict();

function cookieValue(request: Request, name: string) {
  for (const cookie of (request.headers.get("cookie") ?? "").split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new TeacherProfileError("INVALID_INPUT", "请求内容格式不正确", {
      form: ["请提交有效的 JSON 内容"],
    });
  }
}

function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "操作无效", code: "INVALID_INPUT" }, { status: 400 });
  }
  if (error instanceof AuthError) {
    return NextResponse.json({ error: "请先登录", code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (error instanceof TeacherProfileError) {
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({
      error: error.message,
      code: error.code,
      ...(Object.keys(error.fieldErrors).length ? { fieldErrors: error.fieldErrors } : {}),
    }, { status });
  }
  throw error;
}

type HandlerDependencies = {
  authenticate(token: string | undefined): Promise<AuthenticatedAccount>;
  service: TeacherProfileService;
};

export function createTeacherProfileHandlers({ authenticate, service }: HandlerDependencies) {
  async function account(request: Request) {
    return authenticate(cookieValue(request, sessionCookieNames.teacher));
  }

  async function save(request: Request) {
    try {
      const result = await service.saveDraft(await account(request), await readJson(request));
      return NextResponse.json({
        profile: toTeacherProfileDto(result),
        completion: calculateProfileCompletion(result),
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    async GET(request: Request) {
      try {
        const profile = await service.get(await account(request));
        if (!profile) throw new TeacherProfileError("NOT_FOUND", "教师资料不存在");
        return NextResponse.json({
          profile: toTeacherProfileDto(profile),
          completion: calculateProfileCompletion(profile),
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
    PUT: save,
    async POST(request: Request) {
      try {
        const caller = await account(request);
        const { action } = actionSchema.parse(await readJson(request));
        const profile = action === "publish"
          ? await service.publish(caller)
          : await service.unpublish(caller);
        return NextResponse.json({
          profile: toTeacherProfileDto(profile),
          completion: calculateProfileCompletion(profile),
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
