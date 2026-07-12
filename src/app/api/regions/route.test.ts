// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createRegionsGetHandler, type RegionRepository } from "@/features/regions/service";

describe("GET /api/regions", () => {
  it("returns public region JSON", async () => {
    const handler = createRegionsGetHandler({
      list: vi.fn().mockResolvedValue([
        { id: "p1", code: "440000", name: "广东省", level: 1, parentId: null },
      ]),
    } as RegionRepository);

    const response = await handler(new Request("http://localhost/api/regions?level=1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual([
      { id: "p1", code: "440000", name: "广东省", level: 1, parentId: null },
    ]);
  });

  it("returns 400 for illegal query parameters without querying", async () => {
    const list = vi.fn();
    const handler = createRegionsGetHandler({ list } as RegionRepository);

    const response = await handler(new Request("http://localhost/api/regions?level=county"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "区域查询参数无效" });
    expect(list).not.toHaveBeenCalled();
  });
});
