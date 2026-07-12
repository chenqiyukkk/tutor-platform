import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireSessionRole } from "./guards";
import {
  loginSchema,
  parseAuthRole,
  parsePublicAuthRole,
  registerSchema,
  roleDashboardPath,
} from "./schemas";
import { AuthError, type AuthService } from "./service";
import { getExpiredSessionCookie, getSessionCookie } from "./session";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ZodError([]);
  }
}

function getCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

function redirectFrom(request: Request, pathname: string) {
  return NextResponse.redirect(new URL(pathname, request.url), 303);
}

function routeError(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError(error.issues[0]?.message ?? "请求内容格式不正确", 400);
  }
  if (error instanceof AuthError) {
    if (error.code === "ACCOUNT_EXISTS") return jsonError(error.message, 409);
    if (error.code === "INVALID_CREDENTIALS") return jsonError("账号或密码错误", 401);
    return jsonError("请先登录", 401);
  }
  throw error;
}

export function createRoleAuthHandlers(service: AuthService) {
  return {
    async register(request: Request, pathRole: string) {
      try {
        const role = parsePublicAuthRole(pathRole);
        const input = registerSchema.parse(await readJson(request));
        await service.register(role, input);
        const session = await service.login(role, {
          identifier: input.username,
          password: input.password,
        });
        const response = redirectFrom(request, roleDashboardPath[role]);
        const cookie = getSessionCookie(role);
        response.cookies.set(cookie.name, session.token, {
          ...cookie.options,
          expires: session.expiresAt,
        });
        return response;
      } catch (error) {
        if (error instanceof ZodError && error.issues.some((issue) => issue.path.length === 0)) {
          return jsonError("不支持该注册入口", 404);
        }
        return routeError(error);
      }
    },

    async login(request: Request, pathRole: string) {
      try {
        const role = parseAuthRole(pathRole);
        const input = loginSchema.parse(await readJson(request));
        const session = await service.login(role, input);
        const response = redirectFrom(request, roleDashboardPath[role]);
        const cookie = getSessionCookie(role);
        response.cookies.set(cookie.name, session.token, {
          ...cookie.options,
          expires: session.expiresAt,
        });
        return response;
      } catch (error) {
        return routeError(error);
      }
    },

    async logout(request: Request, pathRole: string) {
      try {
        const role = parseAuthRole(pathRole);
        const cookie = getExpiredSessionCookie(role);
        const token = getCookie(request, cookie.name);
        try {
          await requireSessionRole(service, role, token);
          await service.logout(role, token);
        } catch (error) {
          if (!(error instanceof AuthError) || error.code !== "UNAUTHORIZED") {
            throw error;
          }
        }
        const response = redirectFrom(request, `/${role}/login`);
        response.cookies.set(cookie.name, "", cookie.options);
        return response;
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
