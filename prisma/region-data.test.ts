import { describe, expect, it } from "vitest";

import { REGION_DATA_SOURCE, regionSeedRows } from "./region-data";

const guangzhouDistricts = new Map([
  ["440103", "荔湾区"],
  ["440104", "越秀区"],
  ["440105", "海珠区"],
  ["440106", "天河区"],
  ["440111", "白云区"],
  ["440112", "黄埔区"],
  ["440113", "番禺区"],
  ["440114", "花都区"],
  ["440115", "南沙区"],
  ["440117", "从化区"],
  ["440118", "增城区"],
]);

describe("全国行政区划种子数据", () => {
  it("固定到可追溯的数据快照", () => {
    expect(REGION_DATA_SOURCE).toEqual({
      package: "@province-city-china/level",
      version: "8.5.8",
      upstreamCommit: "ca2ada5ea608b57c7b0178aa568ced6e363b57f7",
    });
  });

  it("提供全国可用的省、市、区县三级数据", () => {
    expect(regionSeedRows.filter((region) => region.level === 1)).toHaveLength(33);
    expect(regionSeedRows.filter((region) => region.level === 2).length).toBeGreaterThanOrEqual(340);
    expect(regionSeedRows.filter((region) => region.level === 3).length).toBeGreaterThanOrEqual(3_000);
  });

  it("所有代码唯一，且每个市和区县都有已存在的父级", () => {
    const codes = new Set(regionSeedRows.map((region) => region.code));
    expect(codes.size).toBe(regionSeedRows.length);

    for (const region of regionSeedRows) {
      if (region.level === 1) {
        expect(region.parentCode).toBeNull();
      } else {
        expect(region.parentCode).not.toBeNull();
        expect(codes.has(region.parentCode!)).toBe(true);
      }
    }
  });

  it("广州包含全部 11 个正式行政区，并过滤无意义占位项", () => {
    const actual = regionSeedRows
      .filter((region) => region.parentCode === "440100")
      .map((region): [string, string] => [region.code, region.name]);

    expect(new Map(actual)).toEqual(guangzhouDistricts);
    expect(regionSeedRows.some((region) => region.name === "市辖区")).toBe(false);
  });

  it("无下辖区县的地级市仍可作为完整授课圈选择", () => {
    expect(
      regionSeedRows.filter((region) => region.parentCode === "441900"),
    ).toEqual([
      expect.objectContaining({
        code: "441900-all",
        name: "东莞市全市",
        level: 3,
      }),
    ]);
  });
});
