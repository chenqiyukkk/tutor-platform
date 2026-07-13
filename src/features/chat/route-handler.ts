import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { AuthError, type AuthenticatedAccount } from "@/features/auth/service";
import { sessionCookieNames } from "@/features/auth/session";
import { readUniqueCookieValue } from "@/features/directory/detail-auth";
import { JsonBodyError, readLimitedJson } from "@/lib/json-body";

import { conversationListQuerySchema, messageListQuerySchema, sendMessageSchema } from "./schema";
import { ChatWorkflowError, type ChatService } from "./service";

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

function errorResponse(error: unknown) {
  if (error instanceof AuthError || (error instanceof ChatWorkflowError && error.code === "UNAUTHORIZED")) {
    return NextResponse.json({ code: "UNAUTHORIZED", error: "请先登录" }, { status: 401 });
  }
  if (error instanceof JsonBodyError) {
    return NextResponse.json(
      { code: error.code === "too_large" ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT", error: error.message },
      { status: error.code === "too_large" ? 413 : 400 },
    );
  }
  if (error instanceof ZodError || error instanceof RouteInputError) {
    return NextResponse.json({ code: "INVALID_INPUT", error: "请求内容无效" }, { status: 400 });
  }
  if (error instanceof ChatWorkflowError) {
    const status = error.code === "FORBIDDEN" ? 403
      : error.code === "NOT_FOUND" ? 404
        : error.code === "BLOCKED" || error.code === "CONFLICT" ? 409 : 400;
    return NextResponse.json({ code: error.code, error: error.message }, { status });
  }
  throw error;
}

type Dependencies = {
  authenticate(role: Realm, token: string | undefined): Promise<AuthenticatedAccount>;
  chatService: Pick<ChatService, "listConversations" | "listMessages" | "sendMessage" | "markRead">;
};

const readBodySchema = z.object({}).strict();
const conversationIdSchema = z.string().uuid();

export function createChatHandlers({ authenticate, chatService }: Dependencies) {
  async function caller(request: Request, allowed: readonly string[]) {
    const params = strictParams(request, allowed);
    const realm = realmFrom(params);
    const token = readUniqueCookieValue(request.headers.get("cookie"), sessionCookieNames[realm]);
    return { account: await authenticate(realm, token), params };
  }

  return {
    conversations: {
      async GET(request: Request) {
        try {
          const { account, params } = await caller(request, ["realm", "limit", "cursor"]);
          const query = conversationListQuerySchema.parse(Object.fromEntries([...params].filter(([key]) => key !== "realm")));
          return NextResponse.json(await chatService.listConversations(account, query));
        } catch (error) { return errorResponse(error); }
      },
    },
    messages: {
      async GET(request: Request, rawId: string) {
        try {
          const { account, params } = await caller(request, ["realm", "before", "after", "limit"]);
          const conversationId = conversationIdSchema.parse(rawId);
          const query = messageListQuerySchema.parse(Object.fromEntries([...params].filter(([key]) => key !== "realm")));
          return NextResponse.json(await chatService.listMessages(account, conversationId, query));
        } catch (error) { return errorResponse(error); }
      },
      async POST(request: Request, rawId: string) {
        try {
          const { account } = await caller(request, ["realm"]);
          const conversationId = conversationIdSchema.parse(rawId);
          const input = sendMessageSchema.parse(await readLimitedJson(request));
          return NextResponse.json({ message: await chatService.sendMessage(account, conversationId, input) }, { status: 201 });
        } catch (error) { return errorResponse(error); }
      },
    },
    read: {
      async POST(request: Request, rawId: string) {
        try {
          const { account } = await caller(request, ["realm"]);
          const conversationId = conversationIdSchema.parse(rawId);
          readBodySchema.parse(await readLimitedJson(request));
          return NextResponse.json(await chatService.markRead(account, conversationId));
        } catch (error) { return errorResponse(error); }
      },
    },
  };
}
