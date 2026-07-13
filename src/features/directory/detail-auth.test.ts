// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { sessionCookieNames } from "@/features/auth/session";

import { createDirectoryDetailAuthorizer } from "./detail-auth";

describe("directory detail cookie authorization", () => {
  it("accepts only the requested role cookie", async () => {
    const authenticate = vi.fn(async () => undefined);
    const authorize = createDirectoryDetailAuthorizer(authenticate);
    const parentRequest = new Request("https://example.test", {
      headers: { cookie: `${sessionCookieNames.parent}=parent-token` },
    });

    await expect(authorize(parentRequest, "parent")).resolves.toBe(true);
    await expect(authorize(parentRequest, "teacher")).resolves.toBe(false);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(authenticate).toHaveBeenCalledWith("parent", "parent-token");
  });

  it("treats invalid or expired sessions as anonymous", async () => {
    const authorize = createDirectoryDetailAuthorizer(async () => {
      throw new Error("expired");
    });
    const request = new Request("https://example.test", {
      headers: { cookie: `${sessionCookieNames.teacher}=expired-token` },
    });

    await expect(authorize(request, "teacher")).resolves.toBe(false);
  });

  it.each([
    ["malformed", `${sessionCookieNames.parent}=%E0%A4%A`],
    ["empty", `${sessionCookieNames.parent}=`],
    ["duplicate", `${sessionCookieNames.parent}=first; ${sessionCookieNames.parent}=second`],
  ])("treats %s target-role cookies as anonymous without authenticating", async (_label, cookie) => {
    const authenticate = vi.fn(async () => undefined);
    const authorize = createDirectoryDetailAuthorizer(authenticate);
    const request = new Request("https://example.test", { headers: { cookie } });

    await expect(authorize(request, "parent")).resolves.toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("ignores a malformed cookie belonging to the other role", async () => {
    const authenticate = vi.fn(async () => undefined);
    const authorize = createDirectoryDetailAuthorizer(authenticate);
    const request = new Request("https://example.test", {
      headers: {
        cookie: `${sessionCookieNames.teacher}=%E0%A4%A; ${sessionCookieNames.parent}=parent-token`,
      },
    });

    await expect(authorize(request, "parent")).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(authenticate).toHaveBeenCalledWith("parent", "parent-token");
  });
});
