import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { getDatabaseEnv } from "../src/lib/env";
import { regionSeedRows, type RegionSeedRow } from "./region-data";

const adapter = new PrismaPg({ connectionString: getDatabaseEnv().DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const subjects = [
  { slug: "chinese", name: "语文", sortOrder: 10 },
  { slug: "mathematics", name: "数学", sortOrder: 20 },
  { slug: "english", name: "英语", sortOrder: 30 },
  { slug: "physics", name: "物理", sortOrder: 40 },
  { slug: "chemistry", name: "化学", sortOrder: 50 },
  { slug: "biology", name: "生物", sortOrder: 60 },
];

async function seedSubjects() {
  for (const subject of subjects) {
    await prisma.subject.upsert({
      where: { slug: subject.slug },
      update: { name: subject.name, sortOrder: subject.sortOrder, isActive: true },
      create: subject,
    });
  }
}

async function seedRegions() {
  const regionIds = new Map<string, string>();

  for (const level of [1, 2, 3] as const) {
    await seedRegionLevel(
      regionSeedRows.filter((region) => region.level === level),
      regionIds,
    );
  }

  await prisma.region.updateMany({
    where: {
      code: { notIn: regionSeedRows.map((region) => region.code) },
      isActive: true,
    },
    data: { isActive: false },
  });

  for (const [leftCode, rightCode] of [
    ["110105", "110108"],
    ["310101", "310115"],
    ["440104", "440106"],
    ["440304", "440305"],
  ]) {
    const leftId = regionIds.get(leftCode);
    const rightId = regionIds.get(rightCode);
    if (!leftId || !rightId) throw new Error("Missing district adjacency fixture");
    const [regionAId, regionBId] = [leftId, rightId].sort();
    await prisma.regionAdjacency.upsert({
      where: { regionAId_regionBId: { regionAId, regionBId } },
      update: {},
      create: { regionAId, regionBId },
    });
  }
}

async function seedRegionLevel(
  rows: RegionSeedRow[],
  regionIds: Map<string, string>,
) {
  const existing = await prisma.region.findMany({
    where: { code: { in: rows.map((region) => region.code) } },
    select: {
      id: true,
      code: true,
      name: true,
      level: true,
      parentId: true,
      sortOrder: true,
      isActive: true,
    },
  });
  const existingByCode = new Map(existing.map((region) => [region.code, region]));

  const toCreate = rows
    .filter((region) => !existingByCode.has(region.code))
    .map((region) => ({
      code: region.code,
      name: region.name,
      level: region.level,
      parentId: getParentId(region, regionIds),
      sortOrder: region.sortOrder,
      isActive: true,
    }));
  if (toCreate.length > 0) {
    await prisma.region.createMany({ data: toCreate, skipDuplicates: true });
  }

  const toUpdate = rows.filter((region) => {
    const saved = existingByCode.get(region.code);
    if (!saved) return false;
    return saved.name !== region.name ||
      saved.level !== region.level ||
      saved.parentId !== getParentId(region, regionIds) ||
      saved.sortOrder !== region.sortOrder ||
      !saved.isActive;
  });
  for (let index = 0; index < toUpdate.length; index += 50) {
    await Promise.all(toUpdate.slice(index, index + 50).map((region) =>
      prisma.region.update({
        where: { code: region.code },
        data: {
          name: region.name,
          level: region.level,
          parentId: getParentId(region, regionIds),
          sortOrder: region.sortOrder,
          isActive: true,
        },
      })));
  }

  const saved = await prisma.region.findMany({
    where: { code: { in: rows.map((region) => region.code) } },
    select: { id: true, code: true },
  });
  for (const region of saved) regionIds.set(region.code, region.id);
}

function getParentId(
  region: RegionSeedRow,
  regionIds: Map<string, string>,
) {
  if (!region.parentCode) return null;
  const parentId = regionIds.get(region.parentCode);
  if (!parentId) {
    throw new Error(`Missing parent region ${region.parentCode} for ${region.code}`);
  }
  return parentId;
}

async function main() {
  await seedSubjects();
  await seedRegions();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
