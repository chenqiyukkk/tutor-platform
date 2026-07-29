import { describe, expect, it } from "vitest";

import {
  blockConversationSchema,
  conversationListQuerySchema,
  decodeConversationCursor,
  decodeMessageChangeCursor,
  decodeMessageCursor,
  encodeConversationCursor,
  encodeMessageChangeCursor,
  encodeMessageCursor,
  markReadSchema,
  messageListQuerySchema,
  sendMessageSchema,
} from "./schema";

const id = "00000000-0000-4000-8000-000000000001";

describe("chat message input", () => {
  it("trims only the outer whitespace, preserves internal newlines, and counts Unicode code points", () => {
    expect(sendMessageSchema.parse({ clientMessageId: id, body: "  第一行\n\n第二行  " })).toEqual({
      clientMessageId: id,
      body: "第一行\n\n第二行",
    });
    const exact = "🙂".repeat(1_000);
    expect(Array.from(exact)).toHaveLength(1_000);
    expect(sendMessageSchema.parse({ clientMessageId: id, body: exact }).body).toBe(exact);
  });

  it("rejects blank or over-1000-code-point bodies, non-UUID ids, sender ids, and unknown fields", () => {
    expect(() => sendMessageSchema.parse({ clientMessageId: id, body: " \n " })).toThrow();
    expect(() => sendMessageSchema.parse({ clientMessageId: id, body: "🙂".repeat(1_001) })).toThrow();
    expect(() => sendMessageSchema.parse({ clientMessageId: "client-1", body: "你好" })).toThrow();
    expect(() => sendMessageSchema.parse({ clientMessageId: id, body: "你好", senderId: id })).toThrow();
  });

  it("accepts only unique visible message ids for read receipts", () => {
    const secondId = "00000000-0000-4000-8000-000000000002";
    expect(markReadSchema.parse({ messageIds: [id, secondId] })).toEqual({ messageIds: [id, secondId] });
    for (const input of [
      { messageIds: [] },
      { messageIds: [id, id] },
      { messageIds: ["not-a-uuid"] },
      { messageIds: Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`) },
      { messageIds: [id], senderId: id },
    ]) expect(() => markReadSchema.parse(input)).toThrow();
  });

  it("trims and bounds conversation block reasons without accepting client identity", () => {
    expect(blockConversationSchema.parse({ reason: "  不希望继续沟通  " })).toEqual({ reason: "不希望继续沟通" });
    expect(blockConversationSchema.parse({ reason: "🙂".repeat(200) }).reason).toBe("🙂".repeat(200));
    for (const input of [
      { reason: " " },
      { reason: "a" },
      { reason: "🙂".repeat(201) },
      { reason: "不希望继续沟通", blockedAccountId: id },
    ]) expect(() => blockConversationSchema.parse(input)).toThrow();
  });
});

describe("chat keyset queries", () => {
  it("round-trips canonical message and conversation cursors", () => {
    const sentAt = new Date("2026-07-13T08:00:00.123Z");
    const activityAt = new Date("2026-07-13T09:00:00.456Z");
    const messageCursor = encodeMessageCursor({ sentAt, id });
    const changeCursor = encodeMessageChangeCursor({ changeVersion: BigInt(42) });
    const conversationCursor = encodeConversationCursor({ activityAt, id });

    expect(decodeMessageCursor(messageCursor)).toEqual({ sentAt, id });
    expect(changeCursor).toBe("42");
    expect(decodeMessageChangeCursor(changeCursor)).toEqual({ changeVersion: BigInt(42) });
    expect(encodeMessageChangeCursor({ changeVersion: BigInt(0) })).toBe("0");
    expect(decodeMessageChangeCursor("9223372036854775807")).toEqual({
      changeVersion: BigInt("9223372036854775807"),
    });
    expect(decodeConversationCursor(conversationCursor)).toEqual({ activityAt, id });
    expect(messageListQuerySchema.parse({ before: messageCursor, limit: "100" })).toEqual({ before: messageCursor, limit: 100 });
    expect(messageListQuerySchema.parse({ after: messageCursor })).toEqual({ after: messageCursor, limit: 50 });
    expect(messageListQuerySchema.parse({ changesAfter: changeCursor })).toEqual({ changesAfter: changeCursor, limit: 50 });
    expect(conversationListQuerySchema.parse({ cursor: conversationCursor, limit: "100" })).toEqual({ cursor: conversationCursor, limit: 100 });
  });

  it("rejects noncanonical cursors, mixed directions, offsets, unknown fields, and limits above 100", () => {
    const cursor = encodeMessageCursor({ sentAt: new Date("2026-07-13T08:00:00.123Z"), id });
    const changes = encodeMessageChangeCursor({ changeVersion: BigInt(42) });
    for (const query of [
      { before: cursor, after: cursor },
      { before: cursor, changesAfter: changes },
      { after: cursor, changesAfter: changes },
      { before: cursor, after: cursor, changesAfter: changes },
      { before: "not+base64" },
      { page: 2 },
      { ownerAccountId: id },
      { limit: 101 },
    ]) expect(() => messageListQuerySchema.parse(query)).toThrow();
    expect(() => conversationListQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => conversationListQuerySchema.parse({ cursor: "not+base64" })).toThrow();
    for (const changesAfter of [
      "00",
      "01",
      "+1",
      "-1",
      " 1",
      "1 ",
      "1e3",
      "9223372036854775808",
      cursor,
    ]) expect(() => messageListQuerySchema.parse({ changesAfter })).toThrow();
  });
});
