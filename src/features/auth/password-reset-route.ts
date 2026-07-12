import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { parseAuthRole } from "./schemas";
import {
  INVALID_RESET_TOKEN_MESSAGE,
  PasswordResetError,
  type PasswordResetService,
} from "./password-reset";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ZodError([]);
  }
}

function routeError(error: unknown) {
  if (error instanceof PasswordResetError) {
    return jsonError(INVALID_RESET_TOKEN_MESSAGE, 400);
  }
  if (error instanceof ZodError) {
    return jsonError(error.issues[0]?.message ?? "请求内容格式不正确", 400);
  }
  throw error;
}

export function createPasswordResetHandlers(service: PasswordResetService) {
  return {
    async forgotPassword(request: Request, pathRole: string) {
      let role;
      try {
        role = parseAuthRole(pathRole);
      } catch {
        return jsonError("不支持该账户入口", 404);
      }
      try {
        const body = await readObject(request);
        const result = await service.requestReset(role, { email: body.email as string });
        return NextResponse.json(result);
      } catch (error) {
        return routeError(error);
      }
    },

    async resetPassword(request: Request, pathRole: string) {
      let role;
      try {
        role = parseAuthRole(pathRole);
      } catch {
        return jsonError("不支持该账户入口", 404);
      }
      try {
        const body = await readObject(request);
        await service.resetPassword(role, {
          token: body.token as string,
          newPassword: body.newPassword as string,
        });
        return NextResponse.redirect(new URL(`/${role}/login`, request.url), 303);
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
