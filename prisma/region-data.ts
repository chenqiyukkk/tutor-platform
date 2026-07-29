import sourceRegions from "@province-city-china/level/level.json";

export const REGION_DATA_SOURCE = {
  package: "@province-city-china/level",
  version: "8.5.8",
  upstreamCommit: "ca2ada5ea608b57c7b0178aa568ced6e363b57f7",
} as const;

export type RegionSeedRow = {
  code: string;
  name: string;
  level: 1 | 2 | 3;
  parentCode: string | null;
  sortOrder: number;
};

type SourceRegion = {
  code: string;
  name: string;
  children?: SourceRegion[];
};

const placeholderDistrictNames = new Set(["市辖区"]);

function isSelectableDistrict(region: SourceRegion) {
  return !placeholderDistrictNames.has(region.name);
}

function sortOrder(index: number) {
  return (index + 1) * 10;
}

function municipalityCityCode(provinceCode: string) {
  return `${provinceCode.slice(0, 2)}0100`;
}

export function buildRegionSeedRows(
  provinces: SourceRegion[],
): RegionSeedRow[] {
  const rows: RegionSeedRow[] = [];

  provinces.forEach((province, provinceIndex) => {
    const children = province.children ?? [];
    const directDistricts = children.filter(
      (child) =>
        !Array.isArray(child.children) && isSelectableDistrict(child),
    );
    const cities = children.filter(
      (child): child is SourceRegion & { children: SourceRegion[] } =>
        Array.isArray(child.children),
    );

    // The upstream GB/T 2260 snapshot only exposes a province-level entry for
    // Taiwan, without county-level records. Do not show a dead-end choice.
    if (directDistricts.length === 0 && cities.length === 0) return;

    rows.push({
      code: province.code,
      name: province.name,
      level: 1,
      parentCode: null,
      sortOrder: sortOrder(provinceIndex),
    });

    if (directDistricts.length > 0) {
      const cityCode = municipalityCityCode(province.code);
      rows.push({
        code: cityCode,
        name: province.name,
        level: 2,
        parentCode: province.code,
        sortOrder: 10,
      });
      directDistricts.forEach((district, districtIndex) => {
        rows.push({
          code: district.code,
          name: district.name,
          level: 3,
          parentCode: cityCode,
          sortOrder: sortOrder(districtIndex),
        });
      });
    }

    cities.forEach((city, cityIndex) => {
      rows.push({
        code: city.code,
        name: city.name,
        level: 2,
        parentCode: province.code,
        sortOrder: sortOrder(cityIndex + (directDistricts.length > 0 ? 1 : 0)),
      });
      const selectableDistricts = city.children.filter(isSelectableDistrict);
      if (selectableDistricts.length === 0) {
        rows.push({
          code: `${city.code}-all`,
          name: `${city.name}全市`,
          level: 3,
          parentCode: city.code,
          sortOrder: 10,
        });
      } else {
        selectableDistricts.forEach((district, districtIndex) => {
          rows.push({
            code: district.code,
            name: district.name,
            level: 3,
            parentCode: city.code,
            sortOrder: sortOrder(districtIndex),
          });
        });
      }
    });
  });

  return rows;
}

export const regionSeedRows = buildRegionSeedRows(
  sourceRegions as unknown as SourceRegion[],
);
