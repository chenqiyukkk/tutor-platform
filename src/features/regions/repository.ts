import "server-only";

import type { PrismaClient } from "@prisma/client";

import type { RegionQuery, RegionRepository } from "./service";

export class PrismaRegionRepository implements RegionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: RegionQuery) {
    return this.prisma.region.findMany({
      where: {
        isActive: true,
        ...(query.level === undefined ? {} : { level: query.level }),
        ...(query.parentId === undefined ? {} : { parentId: query.parentId }),
      },
      select: {
        id: true,
        code: true,
        name: true,
        level: true,
        parentId: true,
      },
      orderBy: [
        { sortOrder: "asc" },
        { code: "asc" },
        { id: "asc" },
      ],
    });
  }

  async listAdjacentRegionIds(regionId: string) {
    const pairs = await this.prisma.regionAdjacency.findMany({
      where: { OR: [{ regionAId: regionId }, { regionBId: regionId }] },
      select: { regionAId: true, regionBId: true },
    });
    return [...new Set(pairs.map((pair) =>
      pair.regionAId === regionId ? pair.regionBId : pair.regionAId))].sort();
  }
}
