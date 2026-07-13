import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ChatWorkflowError, createChatService } from "./service";
import { encodeMessageChangeCursor, encodeMessageCursor } from "./schema";

const conversationId = "00000000-0000-4000-8000-000000000001";
const clientMessageId = "00000000-0000-4000-8000-000000000002";
const teacherId = "00000000-0000-4000-8000-000000000003";
const parentId = "00000000-0000-4000-8000-000000000004";
const greetingId = "00000000-0000-4000-8000-000000000005";
const requestId = "00000000-0000-4000-8000-000000000006";
const nilId = "00000000-0000-0000-0000-000000000000";

const validConversationRow = {
  id: conversationId,
  greetingId,
  teacherId,
  parentId,
  tutoringRequestId: requestId,
  requestTitle: "数学巩固",
  parentDisplayName: "陈家长",
  teacherDisplayName: "林老师",
  contextValid: true,
};

function initialReadDb(findMany: () => Promise<never[]>, events: string[]) {
  const transaction = {
    account: { findFirst: vi.fn(async () => { events.push("actor"); return { id: parentId }; }) },
    message: { findMany },
    $queryRaw: vi.fn(async () => {
      const event = transaction.$queryRaw.mock.calls.length === 1 ? "lock" : "context";
      events.push(event);
      return event === "lock" ? [] : [validConversationRow];
    }),
  };
  return {
    conversation: { findUnique: vi.fn(async () => {
      events.push("pair");
      return { teacherId, parentId };
    }) },
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)),
  };
}

describe("chat service input boundary", () => {
  const service = createChatService({} as never);

  it("rejects administrators before touching persistence", async () => {
    await expect(service.listConversations({ id: crypto.randomUUID(), role: "admin" }, {}))
      .rejects.toEqual(expect.objectContaining<Partial<ChatWorkflowError>>({ code: "FORBIDDEN" }));
  });

  it("rejects sender spoofing and invalid bodies before touching persistence", async () => {
    const actor = { id: crypto.randomUUID(), role: "teacher" as const };
    await expect(service.sendMessage(actor, conversationId, {
      clientMessageId,
      body: "你好",
      senderId: crypto.randomUUID(),
    })).rejects.toThrow();
    await expect(service.sendMessage(actor, conversationId, {
      clientMessageId,
      body: "🙂".repeat(1_001),
    })).rejects.toThrow();
  });

  it("uses Epoch plus nil UUID for an empty history while establishing the change watermark under the pair lock", async () => {
    const events: string[] = [];
    const fixedNow = new Date("2026-07-13T12:00:00.000Z");
    const findMany = vi.fn(async () => { events.push("findMany"); return []; });
    const now = vi.fn(() => { events.push("now"); return fixedNow; });
    const service = createChatService(initialReadDb(findMany, events) as never, now);

    const page = await service.listMessages({ id: parentId, role: "parent" }, conversationId, {});

    expect(events).toEqual(["pair", "lock", "actor", "context", "now", "findMany"]);
    expect(page.nextAfterCursor).toBe(encodeMessageCursor({ sentAt: new Date(0), id: nilId }));
    expect(page.nextChangesCursor).toBe(encodeMessageChangeCursor({ updatedAt: fixedNow, id: nilId }));
  });

  it("loads actor, relational context and message changes in about three SQL operations", async () => {
    const updatedAt = new Date("2026-07-13T12:00:00.000Z");
    const findFirst = vi.fn(async () => ({ id: parentId }));
    const relationQuery = vi.fn(async () => [validConversationRow]);
    const findMany = vi.fn(async () => []);
    const db = {
      account: { findFirst },
      message: { findMany },
      $queryRaw: relationQuery,
    };
    const service = createChatService(db as never);

    await service.listMessages({ id: parentId, role: "parent" }, conversationId, {
      changesAfter: encodeMessageChangeCursor({ updatedAt, id: nilId }),
    });

    expect(findFirst).toHaveBeenCalledOnce();
    expect(relationQuery).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledOnce();
    expect(findFirst.mock.calls.length + relationQuery.mock.calls.length + findMany.mock.calls.length).toBeLessThanOrEqual(3);
    expect((db as Record<string, unknown>).greeting).toBeUndefined();
    expect((db as Record<string, unknown>).tutoringRequest).toBeUndefined();
  });
});
