import { describe, expect, it, vi } from "vitest";

import { createRegionService, RegionQueryError, type RegionRepository } from "./service";

describe("region service", () => {
  it("defaults to active root provinces and returns only the public DTO", async () => {
    const list = vi.fn().mockResolvedValue([
      {
        id: "province-id",
        code: "440000",
        name: "广东省",
        level: 1,
        parentId: null,
        sortOrder: 10,
        isActive: true,
      },
    ]);
    const service = createRegionService({ list } as RegionRepository);

    await expect(service.listRegions(new URLSearchParams())).resolves.toEqual([
      { id: "province-id", code: "440000", name: "广东省", level: 1, parentId: null },
    ]);
    expect(list).toHaveBeenCalledWith({ level: 1, parentId: null });
  });

  it.each(["2", "3"])("accepts level %s only with a UUID parentId", async (level) => {
    const list = vi.fn().mockResolvedValue([]);
    const service = createRegionService({ list } as RegionRepository);
    const parentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await service.listRegions(new URLSearchParams({ parentId, level }));

    expect(list).toHaveBeenCalledWith({ parentId, level: Number(level) });
  });

  it.each([
    ["unknown parameter", "other=x"],
    ["invalid UUID", "parentId=not-a-uuid"],
    ["blank parent", "parentId="],
    ["invalid level", "level=4"],
    ["non-integer level", "level=2.5"],
    ["repeated parent", "parentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&parentId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ["level 1 with parent", "level=1&parentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ["level 2 without parent", "level=2"],
    ["level 3 without parent", "level=3"],
    ["parent without level", "parentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  ])("rejects %s", async (_label, query) => {
    const service = createRegionService({ list: vi.fn() } as unknown as RegionRepository);

    const error = await service.listRegions(new URLSearchParams(query)).catch((caught) => caught);

    expect(error).toBeInstanceOf(RegionQueryError);
    expect(error).toMatchObject({
      code: "INVALID_REGION_QUERY",
      message: "区域查询参数无效",
    });
  });
});
