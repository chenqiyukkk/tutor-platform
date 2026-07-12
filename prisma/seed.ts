import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { getDatabaseEnv } from "../src/lib/env";

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
  const guangdong = await prisma.region.upsert({
    where: { code: "440000" },
    update: { name: "广东省", level: 1, parentId: null, sortOrder: 10, isActive: true },
    create: { code: "440000", name: "广东省", level: 1, sortOrder: 10 },
  });

  const cityFixtures = [
    { code: "440100", name: "广州市", sortOrder: 10 },
    { code: "440300", name: "深圳市", sortOrder: 20 },
  ];
  const cities = new Map<string, string>();

  for (const city of cityFixtures) {
    const saved = await prisma.region.upsert({
      where: { code: city.code },
      update: {
        name: city.name,
        level: 2,
        parentId: guangdong.id,
        sortOrder: city.sortOrder,
        isActive: true,
      },
      create: { ...city, level: 2, parentId: guangdong.id },
    });
    cities.set(city.code, saved.id);
  }

  const districtFixtures = [
    { code: "440104", name: "越秀区", cityCode: "440100", sortOrder: 10 },
    { code: "440106", name: "天河区", cityCode: "440100", sortOrder: 20 },
    { code: "440304", name: "福田区", cityCode: "440300", sortOrder: 10 },
    { code: "440305", name: "南山区", cityCode: "440300", sortOrder: 20 },
  ];
  const districts = new Map<string, string>();

  for (const district of districtFixtures) {
    const parentId = cities.get(district.cityCode);
    if (!parentId) throw new Error(`Missing city fixture ${district.cityCode}`);
    const saved = await prisma.region.upsert({
      where: { code: district.code },
      update: {
        name: district.name,
        level: 3,
        parentId,
        sortOrder: district.sortOrder,
        isActive: true,
      },
      create: {
        code: district.code,
        name: district.name,
        level: 3,
        parentId,
        sortOrder: district.sortOrder,
      },
    });
    districts.set(district.code, saved.id);
  }

  for (const [leftCode, rightCode] of [["440104", "440106"], ["440304", "440305"]]) {
    const leftId = districts.get(leftCode);
    const rightId = districts.get(rightCode);
    if (!leftId || !rightId) throw new Error("Missing district adjacency fixture");
    const [regionAId, regionBId] = [leftId, rightId].sort();
    await prisma.regionAdjacency.upsert({
      where: { regionAId_regionBId: { regionAId, regionBId } },
      update: {},
      create: { regionAId, regionBId },
    });
  }
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
