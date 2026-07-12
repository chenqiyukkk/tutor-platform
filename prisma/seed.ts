import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { getServerEnv } from "../src/lib/env";

const adapter = new PrismaPg({ connectionString: getServerEnv().DATABASE_URL });
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
  const beijing = await prisma.region.upsert({
    where: { code: "110000" },
    update: { name: "北京市", level: 1, sortOrder: 10, isActive: true },
    create: { code: "110000", name: "北京市", level: 1, sortOrder: 10 },
  });

  const shanghai = await prisma.region.upsert({
    where: { code: "310000" },
    update: { name: "上海市", level: 1, sortOrder: 20, isActive: true },
    create: { code: "310000", name: "上海市", level: 1, sortOrder: 20 },
  });

  const districts = [
    { code: "110105", name: "朝阳区", parentId: beijing.id, sortOrder: 10 },
    { code: "110108", name: "海淀区", parentId: beijing.id, sortOrder: 20 },
    { code: "310101", name: "黄浦区", parentId: shanghai.id, sortOrder: 10 },
    { code: "310115", name: "浦东新区", parentId: shanghai.id, sortOrder: 20 },
  ];

  for (const district of districts) {
    await prisma.region.upsert({
      where: { code: district.code },
      update: {
        name: district.name,
        level: 2,
        parentId: district.parentId,
        sortOrder: district.sortOrder,
        isActive: true,
      },
      create: { ...district, level: 2 },
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
