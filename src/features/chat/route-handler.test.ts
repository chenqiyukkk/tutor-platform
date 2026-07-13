import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "@/features/auth/service";

import { createChatHandlers } from "./route-handler";
import { ChatWorkflowError } from "./service";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "parent" as const,
  status: "active" as const,
  username: "test",
  email: "test@example.test",
};
const conversationId = "00000000-0000-4000-8000-000000000002";
const clientMessageId = "00000000-0000-4000-8000-000000000003";

function setup() {
  const authenticate = vi.fn(async (role: "parent" | "teacher", token: string | undefined) => {
    if (!token) throw new AuthError("UNAUTHORIZED", "missing");
    return { ...actor, role };
  });
  const chatService = {
    listConversations: vi.fn(async () => ({ items: [], limit: 20, nextCursor: null })),
    listMessages: vi.fn(async () => ({ items: [], limit: 50, nextBeforeCursor: null, nextAfterCursor: null, nextChangesCursor: null, hasMore: false })),
    sendMessage: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000004",
      clientMessageId,
      body: "你好",
      sentAt: "2026-07-13T12:00:00.000Z",
      readAt: null,
      editedAt: null,
      deletedAt: null,
      updatedAt: "2026-07-13T12:00:00.000Z",
      mine: true,
    })),
    markRead: vi.fn(async () => ({ readCount: 1, readAt: "2026-07-13T12:00:00.000Z" })),
    blockConversation: vi.fn(async () => ({ blocked: true as const })),
  };
  return { authenticate, chatService, handlers: createChatHandlers({ authenticate, chatService }) };
}

describe("chat routes", () => {
  it("uses realm only to select the matching session cookie and never accepts sender identity", async () => {
    const { handlers, authenticate, chatService } = setup();
    const response = await handlers.conversations.GET(new Request(
      "http://test/api/conversations?realm=parent&limit=20",
      { headers: { cookie: "tutor_parent_session=parent-token; tutor_teacher_session=teacher-token" } },
    ));
    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith("parent", "parent-token");

    const send = await handlers.messages.POST(new Request(
      `http://test/api/conversations/${conversationId}/messages?realm=parent`,
      {
        method: "POST",
        headers: { cookie: "tutor_parent_session=parent-token", "content-type": "application/json" },
        body: JSON.stringify({ clientMessageId, body: "你好", senderId: actor.id }),
      },
    ), conversationId);
    expect(send.status).toBe(400);
    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects unknown, repeated, mixed-direction, malformed UUID, and oversized query inputs", async () => {
    const { handlers } = setup();
    const headers = { cookie: "tutor_parent_session=token" };
    for (const url of [
      "http://test/api/conversations?realm=parent&realm=teacher",
      "http://test/api/conversations?realm=parent&page=2",
      "http://test/api/conversations?realm=parent&limit=101",
    ]) {
      expect((await handlers.conversations.GET(new Request(url, { headers }))).status).toBe(400);
    }
    for (const url of [
      `http://test/api/conversations/${conversationId}/messages?realm=parent&before=abc&after=abc`,
      `http://test/api/conversations/${conversationId}/messages?realm=parent&after=abc&after=def`,
      `http://test/api/conversations/${conversationId}/messages?realm=parent&before=abc&changesAfter=abc`,
    ]) {
      expect((await handlers.messages.GET(new Request(url, { headers }), conversationId)).status).toBe(400);
    }
    expect((await handlers.messages.GET(
      new Request("http://test/api/conversations/not-a-uuid/messages?realm=parent", { headers }),
      "not-a-uuid",
    )).status).toBe(400);
  });

  it("uses bounded strict JSON for send, exact read ids, and block endpoints", async () => {
    const { handlers, chatService } = setup();
    const headers = { cookie: "tutor_teacher_session=token", "content-type": "application/json" };
    const send = await handlers.messages.POST(new Request(
      `http://test/api/conversations/${conversationId}/messages?realm=teacher`,
      { method: "POST", headers, body: JSON.stringify({ clientMessageId, body: "  你好  " }) },
    ), conversationId);
    expect(send.status).toBe(201);
    expect(chatService.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "teacher" }), conversationId, {
      clientMessageId,
      body: "你好",
    });

    const messageIds = [
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000011",
    ];
    const validRead = await handlers.read.POST(new Request(
      `http://test/api/conversations/${conversationId}/read?realm=teacher`,
      { method: "POST", headers, body: JSON.stringify({ messageIds }) },
    ), conversationId);
    expect(validRead.status).toBe(200);
    expect(chatService.markRead).toHaveBeenCalledWith(expect.objectContaining({ role: "teacher" }), conversationId, { messageIds });

    chatService.markRead.mockClear();
    const invalidRead = await handlers.read.POST(new Request(
      `http://test/api/conversations/${conversationId}/read?realm=teacher`,
      { method: "POST", headers, body: JSON.stringify({ readAt: "client-time" }) },
    ), conversationId);
    expect(invalidRead.status).toBe(400);
    expect(chatService.markRead).not.toHaveBeenCalled();

    for (const body of [
      { messageIds: [] },
      { messageIds: [messageIds[0], messageIds[0]] },
      { messageIds: Array.from({ length: 101 }, () => messageIds[0]) },
      { messageIds: messageIds, senderAccountId: actor.id },
    ]) {
      const response = await handlers.read.POST(new Request(
        `http://test/api/conversations/${conversationId}/read?realm=teacher`,
        { method: "POST", headers, body: JSON.stringify(body) },
      ), conversationId);
      expect(response.status).toBe(400);
    }

    const blocked = await handlers.block.POST(new Request(
      `http://test/api/conversations/${conversationId}/block?realm=teacher`,
      { method: "POST", headers, body: JSON.stringify({ reason: "  不希望继续沟通  " }) },
    ), conversationId);
    expect(blocked.status).toBe(200);
    expect(chatService.blockConversation).toHaveBeenCalledWith(expect.objectContaining({ role: "teacher" }), conversationId, {
      reason: "不希望继续沟通",
    });

    const invalidBlock = await handlers.block.POST(new Request(
      `http://test/api/conversations/${conversationId}/block?realm=teacher`,
      { method: "POST", headers, body: JSON.stringify({ reason: "x", blockedAccountId: actor.id }) },
    ), conversationId);
    expect(invalidBlock.status).toBe(400);

    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(`{"body":"${"x".repeat(17_000)}`)); },
    });
    const oversized = new Request(`http://test/api/conversations/${conversationId}/messages?realm=teacher`, {
      method: "POST",
      headers,
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await handlers.messages.POST(oversized, conversationId)).status).toBe(413);

    const oversizedBlock = new Request(`http://test/api/conversations/${conversationId}/block?realm=teacher`, {
      method: "POST",
      headers,
      body: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode(`{"reason":"${"x".repeat(17_000)}`)); },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await handlers.block.POST(oversizedBlock, conversationId)).status).toBe(413);
  });

  it("maps authentication and chat workflow errors to stable HTTP statuses", async () => {
    const cases = [
      [new AuthError("UNAUTHORIZED", "no"), 401],
      [new ChatWorkflowError("UNAUTHORIZED", "no"), 401],
      [new ChatWorkflowError("FORBIDDEN", "no"), 403],
      [new ChatWorkflowError("NOT_FOUND", "no"), 404],
      [new ChatWorkflowError("BLOCKED", "no"), 409],
      [new ChatWorkflowError("CONFLICT", "no"), 409],
    ] as const;
    for (const [error, status] of cases) {
      const { handlers, chatService } = setup();
      chatService.listConversations.mockRejectedValueOnce(error);
      const response = await handlers.conversations.GET(new Request(
        "http://test/api/conversations?realm=parent",
        { headers: { cookie: "tutor_parent_session=token" } },
      ));
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ code: expect.any(String), error: expect.any(String) });
    }
  });
});
