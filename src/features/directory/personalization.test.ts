// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { sessionCookieNames } from "@/features/auth/session";

const mocks = vi.hoisted(() => ({
  cookieHeader: "",
  getSession: vi.fn(),
  findRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: mocks.cookieHeader }),
  cookies: async () => ({
    get(name: string) {
      const match = mocks.cookieHeader
        .split(";")
        .map((cookie) => cookie.trim().split("="))
        .filter(([cookieName]) => cookieName === name)
        .at(-1);
      return match ? { name, value: match.slice(1).join("=") } : undefined;
    },
  }),
}));
vi.mock("@/features/auth/server", () => ({
  getAuthService: () => ({ getSession: mocks.getSession }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    tutoringRequest: { findFirst: mocks.findRequest },
    teacherProfile: { findUnique: vi.fn() },
    teacherServiceArea: { findMany: vi.fn() },
    region: { findMany: vi.fn() },
    subject: { findMany: vi.fn() },
    regionAdjacency: { findMany: vi.fn() },
  },
}));

import { getDirectoryAccessContext } from "./personalization";

describe("directory page access context cookies", () => {
  beforeEach(() => {
    mocks.cookieHeader = "";
    mocks.getSession.mockReset();
    mocks.findRequest.mockReset();
    mocks.getSession.mockResolvedValue({ id: "parent-account" });
    mocks.findRequest.mockResolvedValue(null);
  });

  it.each([
    ["malformed", `${sessionCookieNames.parent}=%E0%A4%A`],
    ["empty", `${sessionCookieNames.parent}=`],
    ["duplicate", [
      `${sessionCookieNames.parent}=stale-token`,
      `${sessionCookieNames.parent}=valid-token`,
    ].join("; ")],
  ])("rejects %s target-role cookies before session lookup", async (_label, cookieHeader) => {
    mocks.cookieHeader = cookieHeader;

    await expect(getDirectoryAccessContext("parent")).resolves.toEqual({
      authenticated: false,
      matchingViewer: null,
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("ignores an unsafe cookie belonging to the other role", async () => {
    mocks.cookieHeader = [
      `${sessionCookieNames.teacher}=%E0%A4%A`,
      `${sessionCookieNames.parent}=valid-token`,
    ].join("; ");

    await expect(getDirectoryAccessContext("parent")).resolves.toEqual({
      authenticated: true,
      matchingViewer: null,
    });
    expect(mocks.getSession).toHaveBeenCalledWith("parent", "valid-token");
  });

  it("authenticates a single valid target-role cookie", async () => {
    mocks.cookieHeader = `${sessionCookieNames.parent}=valid-token`;

    await expect(getDirectoryAccessContext("parent")).resolves.toEqual({
      authenticated: true,
      matchingViewer: null,
    });
    expect(mocks.getSession).toHaveBeenCalledWith("parent", "valid-token");
  });
});
