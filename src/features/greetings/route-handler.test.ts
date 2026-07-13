import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "@/features/auth/service";

import { createInteractionHandlers } from "./route-handler";

const actor = { id: "00000000-0000-4000-8000-000000000001", role: "parent" as const, status: "active" as const, username: "test", email: "test@example.test" };

function setup() {
  const authenticate = vi.fn(async (role: "parent" | "teacher", token: string | undefined) => {
    if (!token) throw new AuthError("UNAUTHORIZED", "missing");
    return { ...actor, role };
  });
  const greetingService = {
    send: vi.fn(async () => ({ id: "greeting" })),
    respond: vi.fn(async () => ({ id: "greeting", status: "ACCEPTED" })),
    listInbox: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  };
  const favoriteService = {
    add: vi.fn(async () => ({ id: "favorite" })), remove: vi.fn(async () => undefined), list: vi.fn(async () => []),
    has: vi.fn(async () => true),
  };
  return { authenticate, greetingService, favoriteService, handlers: createInteractionHandlers({ authenticate, greetingService, favoriteService }) };
}

describe("interaction routes", () => {
  it("uses realm only to select and validate the matching cookie", async () => {
    const { handlers, authenticate } = setup();
    const response = await handlers.greetings.GET(new Request("http://test/api/greetings?realm=parent&box=received", { headers: { cookie: "tutor_parent_session=parent-token; tutor_teacher_session=teacher-token" } }));
    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith("parent", "parent-token");
  });

  it.each([
    "tutor_parent_session=one; tutor_parent_session=two",
    "tutor_parent_session=%E0%A4%A",
  ])("treats malformed or duplicate realm cookies as unauthorized", async (cookie) => {
    const { handlers } = setup();
    const response = await handlers.greetings.GET(new Request("http://test/api/greetings?realm=parent", { headers: { cookie } }));
    expect(response.status).toBe(401);
  });

  it("rejects unknown or repeated query parameters and strict JSON", async () => {
    const { handlers, greetingService } = setup();
    const headers = { "content-type": "application/json", cookie: "tutor_parent_session=token" };
    expect((await handlers.greetings.GET(new Request("http://test/api/greetings?realm=parent&realm=teacher", { headers }))).status).toBe(400);
    expect((await handlers.greetings.GET(new Request("http://test/api/greetings?realm=parent&ownerAccountId=oops", { headers }))).status).toBe(400);
    expect((await handlers.greetings.GET(new Request("http://test/api/greetings?realm=parent&page=2", { headers }))).status).toBe(400);
    expect((await handlers.greetings.GET(new Request("http://test/api/greetings?realm=parent&cursor=bad+cursor", { headers }))).status).toBe(400);
    expect((await handlers.greetings.GET(new Request("http://test/api/greetings?realm=parent&cursor=abc&cursor=def", { headers }))).status).toBe(400);
    const response = await handlers.greetings.POST(new Request("http://test/api/greetings?realm=parent", { method: "POST", headers, body: JSON.stringify({ targetId: actor.id, requestId: actor.id, note: "", senderAccountId: actor.id }) }));
    expect(response.status).toBe(400);
    expect(greetingService.send).not.toHaveBeenCalled();
  });

  it("loads only a strict target-specific favorite state", async () => {
    const { handlers, favoriteService } = setup();
    const headers = { cookie: "tutor_parent_session=token" };
    const targetId = "00000000-0000-4000-8000-000000000002";
    const response = await handlers.favorites.GET(new Request(`http://test/api/favorites?realm=parent&targetType=teacher&targetId=${targetId}`, { headers }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ favorite: true });
    expect(favoriteService.has).toHaveBeenCalledWith(expect.objectContaining({ role: "parent" }), { targetType: "teacher", targetId });

    expect((await handlers.favorites.GET(new Request(`http://test/api/favorites?realm=parent&targetId=${targetId}`, { headers }))).status).toBe(400);
    expect((await handlers.favorites.GET(new Request(`http://test/api/favorites?realm=parent&targetType=teacher&targetType=request&targetId=${targetId}`, { headers }))).status).toBe(400);
  });

  it("maps workflow actions and favorites without trusting an owner id", async () => {
    const { handlers, greetingService, favoriteService } = setup();
    const headers = { "content-type": "application/json", cookie: "tutor_teacher_session=token" };
    const action = await handlers.greeting.POST(new Request("http://test/api/greetings/g?realm=teacher", { method: "POST", headers, body: JSON.stringify({ action: "accept" }) }), actor.id);
    expect(action.status).toBe(200);
    expect(greetingService.respond).toHaveBeenCalledWith(expect.objectContaining({ role: "teacher" }), actor.id, { action: "accept" });
    const favorite = await handlers.favorites.POST(new Request("http://test/api/favorites?realm=teacher", { method: "POST", headers, body: JSON.stringify({ targetType: "request", targetId: actor.id }) }));
    expect(favorite.status).toBe(201);
    expect(favoriteService.add).toHaveBeenCalledWith(expect.objectContaining({ role: "teacher" }), expect.not.objectContaining({ ownerAccountId: expect.anything() }));
  });
});
