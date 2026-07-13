import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "@/features/auth/service";

import { encodeFavoriteCursor } from "./schema";
import { createFavoriteHandlers } from "./route-handler";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "parent" as const,
  status: "active" as const,
  username: "test",
  email: "test@example.test",
};

function setup() {
  const authenticate = vi.fn(async (role: "parent" | "teacher", token: string | undefined) => {
    if (!token) throw new AuthError("UNAUTHORIZED", "missing");
    return { ...actor, role };
  });
  const favoriteService = {
    add: vi.fn(async () => ({ id: "favorite" })),
    remove: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], pageSize: 20, nextCursor: null })),
    has: vi.fn(async () => true),
  };
  return {
    authenticate,
    favoriteService,
    handlers: createFavoriteHandlers({ authenticate, favoriteService }),
  };
}

describe("favorite routes", () => {
  it("passes a strict canonical cursor query to the bounded list contract", async () => {
    const { favoriteService, handlers } = setup();
    const cursor = encodeFavoriteCursor({
      createdAt: new Date("2026-07-13T06:00:00.123Z"),
      id: "00000000-0000-4000-8000-000000000002",
    });
    const response = await handlers.GET(new Request(
      `http://test/api/favorites?realm=parent&pageSize=20&cursor=${cursor}`,
      { headers: { cookie: "tutor_parent_session=token" } },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [],
      pageSize: 20,
      nextCursor: null,
    });
    expect(favoriteService.list).toHaveBeenCalledWith(
      expect.objectContaining({ role: "parent" }),
      { pageSize: 20, cursor },
    );
  });

  it.each([
    "page=2",
    "ownerAccountId=00000000-0000-4000-8000-000000000001",
    "pageSize=51",
    "cursor=bad+cursor",
    "cursor=abc&cursor=def",
    "targetType=teacher&targetId=00000000-0000-4000-8000-000000000002&cursor=abc",
  ])("rejects an invalid list query: %s", async (query) => {
    const { favoriteService, handlers } = setup();
    const response = await handlers.GET(new Request(
      `http://test/api/favorites?realm=parent&${query}`,
      { headers: { cookie: "tutor_parent_session=token" } },
    ));

    expect(response.status).toBe(400);
    expect(favoriteService.list).not.toHaveBeenCalled();
  });

  it("keeps strict target-specific state and authenticated mutation contracts", async () => {
    const { favoriteService, handlers } = setup();
    const targetId = "00000000-0000-4000-8000-000000000002";
    const cookie = "tutor_parent_session=token";
    const targetResponse = await handlers.GET(new Request(
      `http://test/api/favorites?realm=parent&targetType=teacher&targetId=${targetId}`,
      { headers: { cookie } },
    ));
    expect(targetResponse.status).toBe(200);
    await expect(targetResponse.json()).resolves.toEqual({ favorite: true });
    expect(favoriteService.has).toHaveBeenCalledWith(
      expect.objectContaining({ role: "parent" }),
      { targetType: "teacher", targetId },
    );

    const headers = { "content-type": "application/json", cookie };
    const createResponse = await handlers.POST(new Request(
      "http://test/api/favorites?realm=parent",
      { method: "POST", headers, body: JSON.stringify({ targetType: "teacher", targetId }) },
    ));
    expect(createResponse.status).toBe(201);
    expect(favoriteService.add).toHaveBeenCalledWith(
      expect.objectContaining({ role: "parent" }),
      { targetType: "teacher", targetId },
    );
  });
});
