export type RegionDto = {
  id: string;
  code: string;
  name: string;
  level: number;
  parentId: string | null;
};

export type RegionQuery = {
  parentId?: string | null;
  level?: 1 | 2 | 3;
};

export interface RegionRepository {
  list(query: RegionQuery): Promise<readonly RegionDto[]>;
}

export class RegionQueryError extends Error {
  constructor() {
    super("Invalid region query");
    this.name = "RegionQueryError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRegionQuery(searchParams: URLSearchParams): RegionQuery {
  for (const key of searchParams.keys()) {
    if (key !== "parentId" && key !== "level") throw new RegionQueryError();
  }
  if (searchParams.getAll("parentId").length > 1 || searchParams.getAll("level").length > 1) {
    throw new RegionQueryError();
  }

  const rawParentId = searchParams.get("parentId");
  const rawLevel = searchParams.get("level");
  if (rawParentId !== null && !UUID_PATTERN.test(rawParentId)) throw new RegionQueryError();
  if (rawLevel !== null && !/^[1-3]$/.test(rawLevel)) throw new RegionQueryError();

  if (rawParentId === null && rawLevel === null) return { level: 1, parentId: null };
  const level = rawLevel === null ? undefined : Number(rawLevel) as 1 | 2 | 3;
  return {
    ...(rawParentId === null ? {} : { parentId: rawParentId }),
    ...(level === undefined ? {} : { level }),
    ...(level === 1 && rawParentId === null ? { parentId: null } : {}),
  };
}

function toRegionDto(region: RegionDto): RegionDto {
  return {
    id: region.id,
    code: region.code,
    name: region.name,
    level: region.level,
    parentId: region.parentId,
  };
}

export function createRegionService(repository: RegionRepository) {
  return {
    async listRegions(searchParams: URLSearchParams) {
      const regions = await repository.list(parseRegionQuery(searchParams));
      return regions.map(toRegionDto);
    },
  };
}

export function createRegionsGetHandler(repository: RegionRepository) {
  const service = createRegionService(repository);
  return async (request: Request) => {
    try {
      const regions = await service.listRegions(new URL(request.url).searchParams);
      return Response.json(regions);
    } catch (error) {
      if (error instanceof RegionQueryError) {
        return Response.json({ error: "区域查询参数无效" }, { status: 400 });
      }
      throw error;
    }
  };
}
