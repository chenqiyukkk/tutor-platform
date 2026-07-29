// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createRegionsGetHandler, type RegionRepository } from "@/features/regions/service";

describe("GET /api/regions", () => {
  it("returns public region JSON", async () => {
    const handler = createRegionsGetHandler({
      list: vi.fn().mockResolvedValue([
        { id: "p1", code: "440000", name: "广东省", level: 1, parentId: null },
      ]),
      listAdjacentRegionIds: vi.fn().mockResolvedValue([]),
    } as RegionRepository);

    const response = await handler(new Request("http://localhost/api/regions?level=1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual([
      { id: "p1", code: "440000", name: "广东省", level: 1, parentId: null },
    ]);
  });

  it.each([
    ["invalid value", "level=county"],
    ["level 1 with parent", "level=1&parentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ["level 2 without parent", "level=2"],
    ["level 3 without parent", "level=3"],
    ["parent without level", "parentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  ])("returns stable 400 for %s without querying", async (_label, query) => {
    const list = vi.fn();
    const handler = createRegionsGetHandler({
      list,
      listAdjacentRegionIds: vi.fn().mockResolvedValue([]),
    } as RegionRepository);

    const response = await handler(new Request(`http://localhost/api/regions?${query}`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_REGION_QUERY",
      error: "区域查询参数无效",
    });
    expect(list).not.toHaveBeenCalled();
  });
});
