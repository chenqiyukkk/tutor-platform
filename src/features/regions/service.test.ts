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

  it("accepts a UUID parentId and an optional level", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const service = createRegionService({ list } as RegionRepository);
    const parentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await service.listRegions(new URLSearchParams({ parentId, level: "3" }));

    expect(list).toHaveBeenCalledWith({ parentId, level: 3 });
  });

  it.each([
    ["unknown parameter", "other=x"],
    ["invalid UUID", "parentId=not-a-uuid"],
    ["blank parent", "parentId="],
    ["invalid level", "level=4"],
    ["non-integer level", "level=2.5"],
    ["repeated parent", "parentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&parentId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  ])("rejects %s", async (_label, query) => {
    const service = createRegionService({ list: vi.fn() } as unknown as RegionRepository);

    await expect(service.listRegions(new URLSearchParams(query))).rejects
      .toBeInstanceOf(RegionQueryError);
  });
});
