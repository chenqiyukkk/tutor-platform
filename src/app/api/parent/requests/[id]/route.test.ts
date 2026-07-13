// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { member } = vi.hoisted(() => ({ member: {
  GET: vi.fn(),
  PUT: vi.fn(),
  POST: vi.fn(),
} }));
vi.mock("@/features/requests/routes", () => ({ parentRequestHandlers: { member } }));

import * as route from "./route";

describe("/api/parent/requests/[id] route module", () => {
  it("exports only full replacement and explicit-action methods so Next owns unsupported-method 405", async () => {
    expect(route).not.toHaveProperty("PATCH");
    expect(route).toEqual(expect.objectContaining({ GET: expect.any(Function), PUT: expect.any(Function), POST: expect.any(Function) }));
    await route.PUT(new Request("http://localhost/api/parent/requests/request-id", { method: "PUT" }), { params: Promise.resolve({ id: "request-id" }) });
    expect(member.PUT).toHaveBeenCalledWith(expect.any(Request), "request-id");
  });
});
