import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AuthError, type AuthenticatedAccount } from "@/features/auth/service";
import { sessionCookieNames } from "@/features/auth/session";
import { readUniqueCookieValue } from "@/features/directory/detail-auth";

import { favoriteListQuerySchema } from "./schema";
import { FavoriteWorkflowError, favoriteTargetSchema } from "./service";

type Realm = "parent" | "teacher";

class RouteInputError extends Error {}

function strictParams(request: Request, allowed: readonly string[]) {
  const params = new URL(request.url).searchParams;
  for (const key of new Set(params.keys())) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) {
      throw new RouteInputError("查询参数无效");
    }
  }
  return params;
}

function realmFrom(params: URLSearchParams): Realm {
  const realm = params.get("realm");
  if (realm !== "parent" && realm !== "teacher") {
    throw new RouteInputError("请选择家长或老师身份");
  }
  return realm;
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new RouteInputError("请提交 JSON 内容");
  try {
    return await request.json();
  } catch {
    throw new RouteInputError("JSON 内容格式不正确");
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError || (error instanceof FavoriteWorkflowError && error.code === "UNAUTHORIZED")) {
    return NextResponse.json({ code: "UNAUTHORIZED", error: "请先登录" }, { status: 401 });
  }
  if (error instanceof ZodError || error instanceof RouteInputError) {
    return NextResponse.json({ code: "INVALID_INPUT", error: "请求内容无效" }, { status: 400 });
  }
  if (error instanceof FavoriteWorkflowError) {
    return NextResponse.json(
      { code: error.code, error: error.message },
      { status: error.code === "FORBIDDEN" ? 403 : 400 },
    );
  }
  throw error;
}

type Dependencies = {
  authenticate(role: Realm, token: string | undefined): Promise<AuthenticatedAccount>;
  favoriteService: {
    add(actor: AuthenticatedAccount, target: unknown): Promise<unknown>;
    remove(actor: AuthenticatedAccount, target: unknown): Promise<void>;
    list(actor: AuthenticatedAccount, query: unknown): Promise<unknown>;
    has(actor: AuthenticatedAccount, target: unknown): Promise<boolean>;
  };
};

export function createFavoriteHandlers({ authenticate, favoriteService }: Dependencies) {
  async function caller(request: Request, allowed: readonly string[]) {
    const params = strictParams(request, allowed);
    const realm = realmFrom(params);
    const token = readUniqueCookieValue(request.headers.get("cookie"), sessionCookieNames[realm]);
    return { account: await authenticate(realm, token), params };
  }

  return {
    async GET(request: Request) {
      try {
        const { account, params } = await caller(request, ["realm", "targetType", "targetId", "pageSize", "cursor"]);
        const targetType = params.get("targetType");
        const targetId = params.get("targetId");
        const hasTargetQuery = targetType !== null || targetId !== null;
        const hasListQuery = params.has("pageSize") || params.has("cursor");
        if (hasTargetQuery) {
          if (targetType === null || targetId === null || hasListQuery) {
            throw new RouteInputError("收藏目标参数无效");
          }
          const target = favoriteTargetSchema.parse({ targetType, targetId });
          return NextResponse.json({ favorite: await favoriteService.has(account, target) });
        }
        const query = favoriteListQuerySchema.parse(Object.fromEntries(
          [...params].filter(([key]) => key !== "realm"),
        ));
        return NextResponse.json(await favoriteService.list(account, query));
      } catch (error) {
        return errorResponse(error);
      }
    },

    async POST(request: Request) {
      try {
        const { account } = await caller(request, ["realm"]);
        const target = favoriteTargetSchema.parse(await readJson(request));
        return NextResponse.json({ favorite: await favoriteService.add(account, target) }, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async DELETE(request: Request) {
      try {
        const { account } = await caller(request, ["realm"]);
        const target = favoriteTargetSchema.parse(await readJson(request));
        await favoriteService.remove(account, target);
        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
