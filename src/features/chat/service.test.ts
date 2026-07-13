import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ChatWorkflowError, createChatService } from "./service";

const conversationId = "00000000-0000-4000-8000-000000000001";
const clientMessageId = "00000000-0000-4000-8000-000000000002";

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
});
