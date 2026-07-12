export enum MatchTier {
  Online = 1,
  AdjacentDistrict = 2,
  ExtraDistrictExact = 3,
  PrimaryDistrictExact = 4,
}

export const MATCH_TIER_LABELS: Record<MatchTier, string> = {
  [MatchTier.PrimaryDistrictExact]: "首选服务区完全匹配",
  [MatchTier.ExtraDistrictExact]: "附加服务区完全匹配",
  [MatchTier.AdjacentDistrict]: "相邻服务区匹配",
  [MatchTier.Online]: "双方接受线上授课",
};

export type MatchServiceArea = {
  districtId: string;
  isPrimary: boolean;
};

export type MatchTeacher = {
  id: string;
  subjectIds: readonly string[];
  serviceAreas: readonly MatchServiceArea[];
  acceptsOnline: boolean;
  hourlyRateCents?: number;
};

export type MatchRequest = {
  id: string;
  subjectIds: readonly string[];
  districtId?: string | null;
  acceptsOnline: boolean;
  budgetMinCents?: number;
  budgetMaxCents?: number;
};

export type AdjacentRegionPair = readonly [string, string];

export type MatchResult = {
  tier: MatchTier;
  tierLabel: string;
  secondaryScore: number;
  reasons: string[];
  tieBreakKey: string;
};
