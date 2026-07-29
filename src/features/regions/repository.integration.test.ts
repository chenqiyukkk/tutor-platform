// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaRegionRepository } from "./repository";
import { createRegionService } from "./service";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for region integration tests");

describe("Prisma region repository", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const repository = new PrismaRegionRepository(prisma);
  const service = createRegionService(repository);
  const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const provinceIds: string[] = [];

  afterAll(async () => {
    if (provinceIds.length) {
      await prisma.region.deleteMany({
        where: { OR: [{ id: { in: provinceIds } }, { parentId: { in: provinceIds } }] },
      });
    }
    await prisma.$disconnect();
  });

  it("runs a real filtered query with stable ordering through the API service", async () => {
    const province = await prisma.region.create({
      data: { code: `T${marker}`, name: "测试省", level: 1, sortOrder: 9999 },
    });
    provinceIds.push(province.id);
    await prisma.region.createMany({ data: [
      { code: `B${marker}`, name: "后创建市", level: 2, parentId: province.id, sortOrder: 20 },
      { code: `A${marker}`, name: "先展示市", level: 2, parentId: province.id, sortOrder: 10 },
    ] });

    const rows = await service.listRegions(new URLSearchParams({
      level: "2",
      parentId: province.id,
    }));

    expect(rows.map((row) => row.name)).toEqual(["先展示市", "后创建市"]);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["code", "id", "level", "name", "parentId"]);
  });

  it("finds canonical adjacency from both endpoints and enforces pair constraints", async () => {
    const province = await prisma.region.create({
      data: { code: `P${marker}`, name: "邻接测试省", level: 1, sortOrder: 9998 },
    });
    provinceIds.push(province.id);
    const regions = await Promise.all(["甲区", "乙区", "丙区"].map((name, index) =>
      prisma.region.create({
        data: {
          code: `${index}${marker}`,
          name,
          level: 3,
          parentId: province.id,
          sortOrder: index,
        },
      })));
    const [regionA, regionB, regionC] = regions;
    const canonicalPair = (left: string, right: string) => [left, right].sort() as [string, string];
    const [firstA, firstB] = canonicalPair(regionA.id, regionB.id);
    const [secondA, secondB] = canonicalPair(regionA.id, regionC.id);
    await prisma.regionAdjacency.createMany({ data: [
      { regionAId: firstA, regionBId: firstB },
      { regionAId: secondA, regionBId: secondB },
    ] });

    await expect(service.listAdjacentRegionIds(regionA.id)).resolves
      .toEqual([regionB.id, regionC.id].sort());
    await expect(service.listAdjacentRegionIds(regionB.id)).resolves.toEqual([regionA.id]);
    await expect(service.listAdjacentRegionIds(regionC.id)).resolves.toEqual([regionA.id]);
    await expect(service.listAdjacentRegionIds("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))
      .resolves.toEqual([]);

    await expect(prisma.regionAdjacency.create({
      data: { regionAId: regionA.id, regionBId: regionA.id },
    })).rejects.toThrow();
    await expect(prisma.regionAdjacency.create({
      data: { regionAId: firstB, regionBId: firstA },
    })).rejects.toThrow();
    await expect(prisma.regionAdjacency.create({
      data: { regionAId: firstA, regionBId: firstB },
    })).rejects.toThrow();
  });
});
