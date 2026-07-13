import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ChatWorkflowError, createChatService } from "./service";
import { encodeMessageCursor } from "./schema";

const conversationId = "00000000-0000-4000-8000-000000000001";
const clientMessageId = "00000000-0000-4000-8000-000000000002";
const teacherId = "00000000-0000-4000-8000-000000000003";
const parentId = "00000000-0000-4000-8000-000000000004";

function validListMessagesDb(findMany: () => Promise<never[]>) {
  return {
    account: {
      findFirst: vi.fn(async () => ({ id: parentId })),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        role: where.id === teacherId ? "TEACHER" : "PARENT",
      })),
    },
    conversation: { findUnique: vi.fn(async () => ({
      id: conversationId,
      greetingId: "00000000-0000-4000-8000-000000000005",
      teacherId,
      parentId,
      tutoringRequestId: "00000000-0000-4000-8000-000000000006",
    })) },
    greeting: { findUnique: vi.fn(async () => ({
      status: "ACCEPTED",
      senderAccountId: teacherId,
      recipientAccountId: parentId,
      tutoringRequestId: "00000000-0000-4000-8000-000000000006",
    })) },
    tutoringRequest: { findUnique: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000006",
      title: "数学巩固",
      parentProfileId: "00000000-0000-4000-8000-000000000007",
    })) },
    parentProfile: { findUnique: vi.fn(async () => ({ accountId: parentId, displayName: "陈家长" })) },
    teacherProfile: { findUnique: vi.fn(async () => ({ displayName: "林老师" })) },
    message: { findMany },
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

  it("captures an empty-history polling watermark before querying messages", async () => {
    const events: string[] = [];
    const fixedNow = new Date("2026-07-13T12:00:00.000Z");
    const findMany = vi.fn(async () => {
      events.push("findMany");
      return [];
    });
    const now = vi.fn(() => {
      events.push("now");
      return fixedNow;
    });
    const service = createChatService(validListMessagesDb(findMany) as never, now);

    const page = await service.listMessages({ id: parentId, role: "parent" }, conversationId, {});

    expect(events).toEqual(["now", "findMany"]);
    expect(now).toHaveBeenCalledOnce();
    expect(page.nextAfterCursor).toBe(encodeMessageCursor({
      sentAt: fixedNow,
      id: "00000000-0000-0000-0000-000000000000",
    }));
  });
});
