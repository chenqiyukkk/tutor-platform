import { NextResponse } from "next/server";

import { AuthError, type AuthenticatedAccount } from "@/features/auth/service";
import { sessionCookieNames } from "@/features/auth/session";
import { readUniqueCookieValue } from "@/features/directory/detail-auth";

import { verificationSubmissionFieldsSchema } from "./schema";
import { EvidencePersistenceError, MAX_VERIFICATION_UPLOAD_BYTES, StorageError } from "./storage";
import { VerificationWorkflowError, type VerificationService } from "./service";

export const MAX_VERIFICATION_MULTIPART_BYTES = MAX_VERIFICATION_UPLOAD_BYTES + 64 * 1024;

class RouteInputError extends Error {
  constructor(readonly tooLarge = false) {
    super(tooLarge ? "请求内容过大" : "请求内容无效");
    this.name = "RouteInputError";
  }
}

class UnsupportedMediaTypeError extends Error {}

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function assertNoQuery(request: Request) {
  if (new URL(request.url).searchParams.size !== 0) throw new RouteInputError();
}

function assertMultipartContentType(request: Request) {
  const contentType = request.headers.get("content-type");
  if (!contentType) throw new UnsupportedMediaTypeError();
  const parts = contentType.split(";").map((part) => part.trim());
  if (parts.length !== 2 || parts[0].toLowerCase() !== "multipart/form-data") {
    throw new UnsupportedMediaTypeError();
  }
  const boundary = parts[1].match(/^boundary=(?:"([\x20-\x7e]{1,70})"|([^\s";]{1,70}))$/i);
  if (!boundary || !(boundary[1] ?? boundary[2])) throw new UnsupportedMediaTypeError();
}

function declaredLength(request: Request) {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) throw new RouteInputError();
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) throw new RouteInputError();
  if (length > MAX_VERIFICATION_MULTIPART_BYTES) throw new RouteInputError(true);
}

async function readBoundedMultipart(request: Request) {
  assertMultipartContentType(request);
  declaredLength(request);
  if (!request.body) throw new RouteInputError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_VERIFICATION_MULTIPART_BYTES) {
        await reader.cancel("请求内容过大");
        throw new RouteInputError(true);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RouteInputError) throw error;
    throw new RouteInputError();
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type")! },
      body: bytes,
    }).formData();
  } catch {
    throw new RouteInputError();
  }
}

async function parseSubmission(request: Request) {
  const form = await readBoundedMultipart(request);
  const allowed = new Set(["type", "clientRequestId", "file"]);
  const keys = [...new Set(form.keys())];
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) throw new RouteInputError();
  if ([...allowed].some((key) => form.getAll(key).length !== 1)) throw new RouteInputError();

  const type = form.get("type");
  const clientRequestId = form.get("clientRequestId");
  const file = form.get("file");
  if (typeof type !== "string" || typeof clientRequestId !== "string" || !(file instanceof File)) {
    throw new RouteInputError();
  }
  const fields = verificationSubmissionFieldsSchema.safeParse({ type, clientRequestId });
  if (!fields.success || file.size <= 0) throw new RouteInputError();
  if (file.size > MAX_VERIFICATION_UPLOAD_BYTES) throw new RouteInputError(true);
  if (file.type !== "image/jpeg" && file.type !== "image/png") throw new RouteInputError();

  return {
    ...fields.data,
    file: { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type },
  };
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError || (error instanceof VerificationWorkflowError && error.code === "UNAUTHORIZED")) {
    return jsonNoStore({ code: "UNAUTHORIZED", error: "请先登录" }, 401);
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return jsonNoStore({ code: "UNSUPPORTED_MEDIA_TYPE", error: "请提交 multipart/form-data 内容" }, 415);
  }
  if (error instanceof RouteInputError) {
    return jsonNoStore({
      code: error.tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT",
      error: error.tooLarge ? "认证图片不得超过 5 MiB" : "请求内容无效",
    }, error.tooLarge ? 413 : 400);
  }
  if (error instanceof StorageError) {
    if (error.code === "DISABLED") return jsonNoStore({ code: "DISABLED", error: "认证材料上传暂未开放" }, 503);
    if (error.code === "TOO_LARGE") return jsonNoStore({ code: "PAYLOAD_TOO_LARGE", error: "认证图片不得超过 5 MiB" }, 413);
    if (error.code === "WRITE_FAILED") {
      console.error("[verification-evidence]", error.code);
      return jsonNoStore({ code: "INTERNAL_ERROR", error: "服务暂时不可用" }, 500);
    }
    return jsonNoStore({ code: "INVALID_INPUT", error: "认证图片无效" }, 400);
  }
  if (error instanceof EvidencePersistenceError) {
    console.error("[verification-evidence]", error.code);
    return jsonNoStore({ code: "INTERNAL_ERROR", error: "服务暂时不可用" }, 500);
  }
  if (error instanceof VerificationWorkflowError) {
    if (error.code === "FORBIDDEN") return jsonNoStore({ code: "FORBIDDEN", error: "不能执行该操作" }, 403);
    if (error.code === "INVALID_INPUT") return jsonNoStore({ code: "INVALID_INPUT", error: "请求内容无效" }, 400);
    if (error.code === "PROFILE_REQUIRED") return jsonNoStore({ code: "PROFILE_REQUIRED", error: "请先创建老师资料" }, 409);
    if (error.code === "DISABLED") return jsonNoStore({ code: "DISABLED", error: "认证材料上传暂未开放" }, 503);
    return jsonNoStore({ code: "CONFLICT", error: "认证提交发生冲突" }, 409);
  }
  return jsonNoStore({ code: "INTERNAL_ERROR", error: "服务暂时不可用" }, 500);
}

type Dependencies = {
  authenticate(role: "teacher", token: string | undefined): Promise<AuthenticatedAccount>;
  verificationService: Pick<VerificationService, "list" | "submit">;
  uploadEnabled?: boolean;
};

export function createVerificationHandlers({
  authenticate,
  verificationService,
  uploadEnabled = true,
}: Dependencies) {
  async function caller(request: Request) {
    assertNoQuery(request);
    const token = readUniqueCookieValue(
      request.headers.get("cookie"),
      sessionCookieNames.teacher,
    );
    const account = await authenticate("teacher", token);
    if (account.role !== "teacher" || account.status !== "active") {
      throw new AuthError("UNAUTHORIZED", "登录状态无效");
    }
    return { id: account.id, role: "teacher" as const };
  }

  return {
    async GET(request: Request) {
      try {
        const account = await caller(request);
        return jsonNoStore({
          verifications: await verificationService.list(account),
          uploadEnabled,
        });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async POST(request: Request) {
      try {
        const account = await caller(request);
        if (!uploadEnabled) {
          throw new VerificationWorkflowError("DISABLED", "认证材料上传暂未开放");
        }
        const input = await parseSubmission(request);
        return jsonNoStore({ verification: await verificationService.submit(account, input) }, 201);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
