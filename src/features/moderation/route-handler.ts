import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AuthError, type AuthenticatedAccount } from "@/features/auth/service";
import { sessionCookieNames } from "@/features/auth/session";
import { readUniqueCookieValue } from "@/features/directory/detail-auth";
import { JsonBodyError, readLimitedJson } from "@/lib/json-body";

import { createBlockInputSchema, createReportInputSchema } from "./schema";
import { ModerationWorkflowError, type ModerationService } from "./service";

type Realm = "parent" | "teacher";

class RouteInputError extends Error {}
class UnsupportedMediaTypeError extends Error {}

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function strictRealm(request: Request): Realm {
  const params = new URL(request.url).searchParams;
  for (const key of new Set(params.keys())) {
    if (key !== "realm" || params.getAll(key).length !== 1) {
      throw new RouteInputError("查询参数无效");
    }
  }
  const realm = params.get("realm");
  if (realm !== "parent" && realm !== "teacher") {
    throw new RouteInputError("请选择家长或老师身份");
  }
  return realm;
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new UnsupportedMediaTypeError("请提交 JSON 内容");
  return readLimitedJson(request);
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError || (error instanceof ModerationWorkflowError && error.code === "UNAUTHORIZED")) {
    return jsonNoStore({ code: "UNAUTHORIZED", error: "请先登录" }, 401);
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return jsonNoStore({ code: "UNSUPPORTED_MEDIA_TYPE", error: "请提交 JSON 内容" }, 415);
  }
  if (error instanceof JsonBodyError) {
    const tooLarge = error.code === "too_large";
    return jsonNoStore({
      code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT",
      error: error.message,
    }, tooLarge ? 413 : 400);
  }
  if (error instanceof ZodError || error instanceof RouteInputError) {
    return jsonNoStore({ code: "INVALID_INPUT", error: "请求内容无效" }, 400);
  }
  if (error instanceof ModerationWorkflowError) {
    if (error.code === "FORBIDDEN") return jsonNoStore({ code: "FORBIDDEN", error: "不能执行该操作" }, 403);
    if (error.code === "NOT_FOUND") return jsonNoStore({ code: "NOT_FOUND", error: "目标不存在" }, 404);
    return jsonNoStore({ code: "CONFLICT", error: "操作发生冲突" }, 409);
  }
  return jsonNoStore({ code: "INTERNAL_ERROR", error: "服务暂时不可用" }, 500);
}

type Dependencies = {
  authenticate(role: Realm, token: string | undefined): Promise<AuthenticatedAccount>;
  moderationService: Pick<ModerationService, "createReport" | "createBlock">;
};

export function createModerationHandlers({ authenticate, moderationService }: Dependencies) {
  async function caller(request: Request) {
    const realm = strictRealm(request);
    const token = readUniqueCookieValue(request.headers.get("cookie"), sessionCookieNames[realm]);
    return authenticate(realm, token);
  }

  return {
    reports: {
      async POST(request: Request) {
        try {
          const account = await caller(request);
          const input = createReportInputSchema.parse(await readJson(request));
          const result = await moderationService.createReport({ id: account.id, role: account.role }, input);
          return jsonNoStore({ reportId: result.reportId, status: result.status }, 201);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
    blocks: {
      async POST(request: Request) {
        try {
          const account = await caller(request);
          const input = createBlockInputSchema.parse(await readJson(request));
          await moderationService.createBlock({ id: account.id, role: account.role }, input);
          return jsonNoStore({ blocked: true });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  };
}
