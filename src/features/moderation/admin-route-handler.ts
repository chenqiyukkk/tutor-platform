import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AuthError, type AuthenticatedAccount } from "@/features/auth/service";
import { sessionCookieNames } from "@/features/auth/session";
import { readUniqueCookieValue } from "@/features/directory/detail-auth";
import { JsonBodyError, readLimitedJson } from "@/lib/json-body";

import {
  accountMutationSchema,
  adminTargetIdSchema,
  reportMutationSchema,
  verificationMutationSchema,
} from "./admin-schema";
import { AdminModerationError, type AdminModerationService } from "./admin-service";

class RouteInputError extends Error {}
class UnsupportedMediaTypeError extends Error {}

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function assertNoQuery(request: Request) {
  if (new URL(request.url).searchParams.size !== 0) throw new RouteInputError("查询参数无效");
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new UnsupportedMediaTypeError("请提交 JSON 内容");
  return readLimitedJson(request);
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError || (error instanceof AdminModerationError && error.code === "UNAUTHORIZED")) {
    return jsonNoStore({ code: "UNAUTHORIZED", error: "请先登录管理员账号" }, 401);
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return jsonNoStore({ code: "UNSUPPORTED_MEDIA_TYPE", error: "请提交 JSON 内容" }, 415);
  }
  if (error instanceof JsonBodyError) {
    const tooLarge = error.code === "too_large";
    return jsonNoStore({
      code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT",
      error: tooLarge ? "请求内容过大" : "请求内容无效",
    }, tooLarge ? 413 : 400);
  }
  if (error instanceof ZodError || error instanceof RouteInputError) {
    return jsonNoStore({ code: "INVALID_INPUT", error: "请求内容无效" }, 400);
  }
  if (error instanceof AdminModerationError) {
    if (error.code === "FORBIDDEN") return jsonNoStore({ code: "FORBIDDEN", error: "不能执行该操作" }, 403);
    if (error.code === "NOT_FOUND" || error.code === "INVALID_EVIDENCE") {
      return jsonNoStore({ code: "NOT_FOUND", error: "目标不存在" }, 404);
    }
    return jsonNoStore({ code: "CONFLICT", error: "操作发生冲突，请刷新后重试" }, 409);
  }
  return jsonNoStore({ code: "INTERNAL_ERROR", error: "服务暂时不可用" }, 500);
}

type Dependencies = {
  authenticate(role: "admin", token: string | undefined): Promise<AuthenticatedAccount>;
  moderationService: Pick<
    AdminModerationService,
    "updateAccount" | "decideReport" | "decideVerification" | "readVerificationEvidence"
  >;
};

export function createAdminModerationHandlers({ authenticate, moderationService }: Dependencies) {
  async function caller(request: Request) {
    assertNoQuery(request);
    const token = readUniqueCookieValue(request.headers.get("cookie"), sessionCookieNames.admin);
    const account = await authenticate("admin", token);
    if (account.role !== "admin" || account.status !== "active") {
      throw new AuthError("UNAUTHORIZED", "管理员登录状态无效");
    }
    return { id: account.id, role: "admin" as const };
  }

  async function mutation<T>(
    request: Request,
    idValue: string,
    schema: { parse(value: unknown): T },
    execute: (actor: { id: string; role: "admin" }, id: string, input: T) => Promise<unknown>,
    key: string,
  ) {
    try {
      const id = adminTargetIdSchema.parse(idValue);
      const actor = await caller(request);
      const input = schema.parse(await readJson(request));
      return jsonNoStore({ [key]: await execute(actor, id, input) });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    users: {
      PATCH: (request: Request, id: string) => mutation(
        request, id, accountMutationSchema,
        (actor, targetId, input) => moderationService.updateAccount(actor, targetId, input),
        "user",
      ),
    },
    reports: {
      PATCH: (request: Request, id: string) => mutation(
        request, id, reportMutationSchema,
        (actor, targetId, input) => moderationService.decideReport(actor, targetId, input),
        "report",
      ),
    },
    verifications: {
      PATCH: (request: Request, id: string) => mutation(
        request, id, verificationMutationSchema,
        (actor, targetId, input) => moderationService.decideVerification(actor, targetId, input),
        "verification",
      ),
    },
    evidence: {
      async GET(request: Request, idValue: string) {
        try {
          const id = adminTargetIdSchema.parse(idValue);
          const actor = await caller(request);
          const evidence = await moderationService.readVerificationEvidence(actor, id);
          const extension = evidence.mimeType === "image/png" ? "png" : "jpg";
          return new Response(Uint8Array.from(evidence.bytes).buffer, {
            headers: {
              "Cache-Control": "private, no-store",
              "Content-Disposition": `attachment; filename=verification-evidence.${extension}`,
              "Content-Type": evidence.mimeType,
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  };
}

export type AdminModerationHandlers = ReturnType<typeof createAdminModerationHandlers>;
