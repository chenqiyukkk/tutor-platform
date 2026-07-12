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
  let provinceId: string | undefined;

  afterAll(async () => {
    if (provinceId) {
      await prisma.region.deleteMany({ where: { OR: [{ id: provinceId }, { parentId: provinceId }] } });
    }
    await prisma.$disconnect();
  });

  it("runs a real filtered query with stable ordering through the API service", async () => {
    const province = await prisma.region.create({
      data: { code: `T${marker}`, name: "测试省", level: 1, sortOrder: 9999 },
    });
    provinceId = province.id;
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
});
