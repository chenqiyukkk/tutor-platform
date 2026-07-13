import type { PrismaClient } from "@prisma/client";

import type { AdjacentRegionPair } from "@/features/matching/types";

type AdjacencyClient = Pick<PrismaClient, "regionAdjacency">;

export async function findAdjacentRegionPairs(
  client: AdjacencyClient,
  regionIds: readonly string[],
) {
  const uniqueIds = [...new Set(regionIds)];
  if (!uniqueIds.length) return [];
  const rows = await client.regionAdjacency.findMany({
    where: { OR: [{ regionAId: { in: uniqueIds } }, { regionBId: { in: uniqueIds } }] },
    select: { regionAId: true, regionBId: true },
    orderBy: [{ regionAId: "asc" }, { regionBId: "asc" }],
  });
  return rows.map(({ regionAId, regionBId }) => [regionAId, regionBId] as AdjacentRegionPair);
}
