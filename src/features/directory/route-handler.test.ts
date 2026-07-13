// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createDirectoryHandlers } from "./route-handler";
import type { DirectoryRepository } from "./repository";

function repositoryStub(): DirectoryRepository {
  return {
    async listTeachers(query) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    },
    async getTeacher() { return null; },
    async listRequests(query) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    },
    async getRequest() { return null; },
  };
}

describe("public directory route handlers", () => {
  it.each([
    ["teachers", "https://example.test/api/directory/teachers?unknown=yes"],
    ["teachers", "https://example.test/api/directory/teachers?page=1&page=2"],
    ["requests", "https://example.test/api/directory/requests?identityType=OTHER"],
    ["requests", "https://example.test/api/directory/requests?pageSize=25"],
  ] as const)("returns 400 for invalid %s query", async (kind, url) => {
    const handlers = createDirectoryHandlers(repositoryStub());
    const response = await handlers[kind].GET(new Request(url));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_QUERY" });
  });

  it("returns explicit pagination metadata for valid lists", async () => {
    const response = await createDirectoryHandlers(repositoryStub()).teachers.GET(
      new Request("https://example.test/api/directory/teachers?page=2&pageSize=6"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      teachers: [],
      pagination: { page: 2, pageSize: 6, total: 0, totalPages: 0 },
    });
  });

  it("returns 404 for absent details and rejects malformed public ids", async () => {
    const handlers = createDirectoryHandlers(repositoryStub());
    const missing = await handlers.requests.detail("11111111-1111-4111-8111-111111111111");
    const malformed = await handlers.teachers.detail("not-a-uuid");

    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ code: "INVALID_QUERY" });
  });
});
