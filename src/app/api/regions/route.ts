import { PrismaRegionRepository } from "@/features/regions/repository";
import { createRegionsGetHandler } from "@/features/regions/service";
import { db } from "@/lib/db";

const getRegions = createRegionsGetHandler(new PrismaRegionRepository(db));

export async function GET(request: Request) {
  return getRegions(request);
}
