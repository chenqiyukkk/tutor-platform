import { after, NextResponse } from "next/server";
import { ZodError } from "zod";

import { JsonBodyError, readLimitedJson } from "@/lib/json-body";

import { parseAuthRole } from "./schemas";
import {
  FORGOT_PASSWORD_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
  PasswordResetError,
  type PasswordResetService,
} from "./password-reset";

type PasswordResetServiceSource = PasswordResetService | (() => PasswordResetService);
type BackgroundScheduler = (task: () => Promise<void>) => void;

function resolveService(source: PasswordResetServiceSource) {
  return typeof source === "function" ? source() : source;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await readLimitedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof JsonBodyError) throw error;
    throw new ZodError([]);
  }
}

function routeError(error: unknown) {
  if (error instanceof JsonBodyError) {
    return jsonError(error.message, error.code === "too_large" ? 413 : 400);
  }
  if (error instanceof PasswordResetError) {
    return jsonError(INVALID_RESET_TOKEN_MESSAGE, 400);
  }
  if (error instanceof ZodError) {
    return jsonError(error.issues[0]?.message ?? "请求内容格式不正确", 400);
  }
  throw error;
}

export function createPasswordResetHandlers(
  serviceSource: PasswordResetServiceSource,
  {
    schedule = (task) => after(task),
    logger = console,
  }: {
    schedule?: BackgroundScheduler;
    logger?: Pick<Console, "error">;
  } = {},
) {
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
        try {
          schedule(async () => {
            try {
              await resolveService(serviceSource).requestReset(role, {
                email: body.email as string,
              });
            } catch {
              logger.error("Password reset background request failed");
            }
          });
        } catch {
          logger.error("Password reset background request failed");
        }
        return NextResponse.json({ message: FORGOT_PASSWORD_MESSAGE });
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
        await resolveService(serviceSource).resetPassword(role, {
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
