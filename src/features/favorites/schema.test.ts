import { describe, expect, it } from "vitest";

import {
  decodeFavoriteCursor,
  encodeFavoriteCursor,
  favoriteListQuerySchema,
} from "./schema";

describe("favorite list cursor schema", () => {
  it("round-trips a canonical timestamp and UUID cursor", () => {
    const value = {
      createdAt: new Date("2026-07-13T06:00:00.123Z"),
      id: "00000000-0000-4000-8000-000000000001",
    };
    const cursor = encodeFavoriteCursor(value);

    expect(decodeFavoriteCursor(cursor)).toEqual(value);
    expect(favoriteListQuerySchema.parse({ pageSize: "50", cursor })).toEqual({
      pageSize: 50,
      cursor,
    });
  });

  it.each([
    "",
    "not+base64",
    Buffer.from("{}", "utf8").toString("base64url"),
    Buffer.from(
      JSON.stringify({
        createdAt: "not-a-date",
        id: "00000000-0000-4000-8000-000000000001",
      }),
      "utf8",
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        createdAt: "2026-07-13T06:00:00.123Z",
        id: "not-a-uuid",
      }),
      "utf8",
    ).toString("base64url"),
    "a".repeat(257),
  ])("rejects a malformed cursor: %s", (cursor) => {
    expect(() => favoriteListQuerySchema.parse({ cursor })).toThrow();
  });

  it("limits page sizes and rejects legacy offsets or unknown fields", () => {
    expect(favoriteListQuerySchema.parse({})).toEqual({ pageSize: 20 });
    expect(() => favoriteListQuerySchema.parse({ pageSize: 51 })).toThrow();
    expect(() => favoriteListQuerySchema.parse({ page: 2 })).toThrow();
    expect(() => favoriteListQuerySchema.parse({ ownerAccountId: crypto.randomUUID() })).toThrow();
  });
});
