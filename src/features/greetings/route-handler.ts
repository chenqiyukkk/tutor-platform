import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { AuthError, type AuthenticatedAccount } from "@/features/auth/service";
import { sessionCookieNames } from "@/features/auth/session";
import { readUniqueCookieValue } from "@/features/directory/detail-auth";
import { FavoriteWorkflowError, favoriteTargetSchema } from "@/features/favorites/service";

import { greetingActionSchema, greetingInboxQuerySchema, sendGreetingSchema, type GreetingActionInput, type SendGreetingInput } from "./schema";
import { GreetingWorkflowError } from "./service";

type Realm = "parent" | "teacher";

class RouteInputError extends Error {}

function strictParams(request: Request, allowed: readonly string[]) {
  const params = new URL(request.url).searchParams;
  for (const key of new Set(params.keys())) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new RouteInputError("查询参数无效");
  }
  return params;
}

function realmFrom(params: URLSearchParams): Realm {
  const realm = params.get("realm");
  if (realm !== "parent" && realm !== "teacher") throw new RouteInputError("请选择家长或老师身份");
  return realm;
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new RouteInputError("请提交 JSON 内容");
  try { return await request.json(); } catch { throw new RouteInputError("JSON 内容格式不正确"); }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError || (error instanceof GreetingWorkflowError && error.code === "UNAUTHORIZED") || (error instanceof FavoriteWorkflowError && error.code === "UNAUTHORIZED")) {
    return NextResponse.json({ code: "UNAUTHORIZED", error: "请先登录" }, { status: 401 });
  }
  if (error instanceof ZodError || error instanceof RouteInputError) {
    return NextResponse.json({ code: "INVALID_INPUT", error: "请求内容无效" }, { status: 400 });
  }
  if (error instanceof GreetingWorkflowError) {
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404
      : ["PENDING_EXISTS", "COOLDOWN", "PERMANENTLY_CLOSED", "EXPIRED", "BLOCKED", "DAILY_LIMIT", "CONFLICT"].includes(error.code) ? 409 : 400;
    return NextResponse.json({ code: error.code, error: error.message }, { status });
  }
  if (error instanceof FavoriteWorkflowError) {
    return NextResponse.json({ code: error.code, error: error.message }, { status: error.code === "FORBIDDEN" ? 403 : 400 });
  }
  throw error;
}

type Dependencies = {
  authenticate(role: Realm, token: string | undefined): Promise<AuthenticatedAccount>;
  greetingService: {
    send(actor: AuthenticatedAccount, input: SendGreetingInput): Promise<unknown>;
    respond(actor: AuthenticatedAccount, id: string, input: GreetingActionInput): Promise<unknown>;
    listInbox(actor: AuthenticatedAccount, query: unknown): Promise<unknown>;
  };
  favoriteService: {
    add(actor: AuthenticatedAccount, target: unknown): Promise<unknown>;
    remove(actor: AuthenticatedAccount, target: unknown): Promise<void>;
    list(actor: AuthenticatedAccount): Promise<unknown>;
  };
};

export function createInteractionHandlers({ authenticate, greetingService, favoriteService }: Dependencies) {
  async function caller(request: Request, allowed: readonly string[]) {
    const params = strictParams(request, allowed);
    const realm = realmFrom(params);
    const token = readUniqueCookieValue(request.headers.get("cookie"), sessionCookieNames[realm]);
    return { account: await authenticate(realm, token), realm, params };
  }

  return {
    greetings: {
      async GET(request: Request) {
        try {
          const { account, params } = await caller(request, ["realm", "box", "page", "pageSize"]);
          const query = greetingInboxQuerySchema.parse(Object.fromEntries([...params].filter(([key]) => key !== "realm")));
          return NextResponse.json(await greetingService.listInbox(account, query));
        } catch (error) { return errorResponse(error); }
      },
      async POST(request: Request) {
        try {
          const { account } = await caller(request, ["realm"]);
          const input = sendGreetingSchema.parse(await readJson(request));
          return NextResponse.json({ greeting: await greetingService.send(account, input) }, { status: 201 });
        } catch (error) { return errorResponse(error); }
      },
    },
    greeting: {
      async POST(request: Request, id: string) {
        try {
          const { account } = await caller(request, ["realm"]);
          const input = greetingActionSchema.parse(await readJson(request));
          const greetingId = z.string().uuid().parse(id);
          return NextResponse.json({ greeting: await greetingService.respond(account, greetingId, input) });
        } catch (error) { return errorResponse(error); }
      },
    },
    favorites: {
      async GET(request: Request) {
        try {
          const { account } = await caller(request, ["realm"]);
          return NextResponse.json({ favorites: await favoriteService.list(account) });
        } catch (error) { return errorResponse(error); }
      },
      async POST(request: Request) {
        try {
          const { account } = await caller(request, ["realm"]);
          const target = favoriteTargetSchema.parse(await readJson(request));
          return NextResponse.json({ favorite: await favoriteService.add(account, target) }, { status: 201 });
        } catch (error) { return errorResponse(error); }
      },
      async DELETE(request: Request) {
        try {
          const { account } = await caller(request, ["realm"]);
          const target = favoriteTargetSchema.parse(await readJson(request));
          await favoriteService.remove(account, target);
          return new NextResponse(null, { status: 204 });
        } catch (error) { return errorResponse(error); }
      },
    },
  };
}
