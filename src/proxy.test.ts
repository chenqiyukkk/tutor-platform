import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { createPlatformProxy } from "./proxy";

function request(path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(`https://tutor.example${path}`, init);
}

describe("platform proxy security", () => {
  it("rejects cross-origin and missing-origin API mutations before handlers run", () => {
    const proxy = createPlatformProxy({ appUrl: "https://tutor.example" });
    expect(proxy(request("/api/reports", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect(proxy(request("/api/reports", { method: "POST" })).status).toBe(403);
    expect(proxy(request("/api/reports", { method: "POST", headers: { origin: "https://tutor.example" } })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/api/reports", { method: "GET" })).headers.get("x-middleware-next")).toBe("1");
  });

  it("returns 429 with no-store and Retry-After when the selected policy is exhausted", async () => {
    const consume = vi.fn().mockReturnValue({ allowed: false, remaining: 0, retryAfterSeconds: 37 });
    const proxy = createPlatformProxy({ appUrl: "https://tutor.example", limiter: { consume } });
    const response = proxy(request("/api/auth/teacher/login", {
      method: "POST",
      headers: { origin: "https://tutor.example", "x-forwarded-for": "203.0.113.4" },
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(consume).toHaveBeenCalledWith(expect.stringContaining("203.0.113.4"), { limit: 10, windowMs: 900_000 });
    await expect(response.json()).resolves.toEqual({ code: "RATE_LIMITED", error: "请求过于频繁，请稍后重试" });
  });

  it("keeps the existing dashboard cookie redirect", () => {
    const proxy = createPlatformProxy({ appUrl: "https://tutor.example" });
    expect(proxy(request("/teacher/dashboard")).headers.get("location")).toBe("https://tutor.example/teacher/login");
  });
});
