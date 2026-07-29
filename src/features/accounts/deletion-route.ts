import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AuthError, type AuthenticatedAccount } from "@/features/auth/service";
import { getExpiredSessionCookie, sessionCookieNames } from "@/features/auth/session";
import { readUniqueCookieValue } from "@/features/directory/detail-auth";
import { JsonBodyError, readLimitedJson } from "@/lib/json-body";

import { AccountDeletionError, type AccountDeletionService } from "./deletion";

type Realm = "teacher" | "parent";
class RouteInputError extends Error {}

function realm(request: Request): Realm {
  const params = new URL(request.url).searchParams;
  if ([...new Set(params.keys())].some((key) => key !== "realm") || params.getAll("realm").length !== 1) throw new RouteInputError();
  const value = params.get("realm");
  if (value !== "teacher" && value !== "parent") throw new RouteInputError();
  return value;
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createAccountDeletionHandler({
  authenticate,
  deletionService,
}: {
  authenticate(role: Realm, token: string): Promise<AuthenticatedAccount>;
  deletionService: Pick<AccountDeletionService, "delete">;
}) {
  return {
    async POST(request: Request) {
      try {
        const selected = realm(request);
        if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return response({ code: "UNSUPPORTED_MEDIA_TYPE", error: "请提交 JSON 内容" }, 415);
        const token = readUniqueCookieValue(request.headers.get("cookie"), sessionCookieNames[selected]);
        if (!token) throw new AuthError("UNAUTHORIZED", "请先登录");
        const account = await authenticate(selected, token);
        const result = await deletionService.delete({ id: account.id, role: account.role }, await readLimitedJson(request));
        const resultResponse = response(result);
        const cookie = getExpiredSessionCookie(selected);
        resultResponse.cookies.set(cookie.name, "", cookie.options);
        return resultResponse;
      } catch (error) {
        if (error instanceof RouteInputError || error instanceof ZodError) return response({ code: "INVALID_INPUT", error: "请求内容无效" }, 400);
        if (error instanceof JsonBodyError) return response({ code: error.code === "too_large" ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT", error: error.message }, error.code === "too_large" ? 413 : 400);
        if (error instanceof AuthError) return response({ code: "UNAUTHORIZED", error: "请先登录" }, 401);
        if (error instanceof AccountDeletionError) {
          if (error.code === "INVALID_CREDENTIALS") return response({ code: error.code, error: "当前密码不正确" }, 401);
          if (error.code === "FORBIDDEN") return response({ code: error.code, error: "不能执行该操作" }, 403);
          return response({ code: error.code, error: "账号状态已经变化" }, 409);
        }
        return response({ code: "INTERNAL_ERROR", error: "服务暂时不可用" }, 500);
      }
    },
  };
}
