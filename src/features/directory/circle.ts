import { scoreMatch } from "@/features/matching/score";
import { MatchTier, type AdjacentRegionPair } from "@/features/matching/types";

export type DirectoryCircleTier = "SAME_DISTRICT" | "ADJACENT_DISTRICT" | "ONLINE";

export type DirectoryViewer = {
  districtIds: Array<{ districtId: string; isPrimary: boolean }>;
  acceptsOnline: boolean;
};

type TeacherTarget = {
  id: string;
  subjectIds: readonly string[];
  serviceAreas: Array<{ districtId: string; isPrimary: boolean }>;
  acceptsOnline: boolean;
};

type RequestTarget = {
  id: string;
  subjectIds: readonly string[];
  districtId: string | null;
  acceptsOnline: boolean;
};

function publicTier(tier: MatchTier): DirectoryCircleTier {
  if (tier === MatchTier.Online) return "ONLINE";
  if (tier === MatchTier.AdjacentDistrict) return "ADJACENT_DISTRICT";
  return "SAME_DISTRICT";
}

export function resolveTeacherCircleTier(
  teacher: TeacherTarget,
  viewer: DirectoryViewer,
  adjacentRegionPairs: readonly AdjacentRegionPair[],
) {
  const viewerDistricts = viewer.districtIds.length
    ? viewer.districtIds
    : [{ districtId: null, isPrimary: true }];
  const results = viewerDistricts.flatMap(({ districtId }) => {
    const result = scoreMatch(
      { ...teacher, subjectIds: ["directory-circle"] },
      {
        id: "directory-viewer",
        subjectIds: ["directory-circle"],
        districtId,
        acceptsOnline: viewer.acceptsOnline,
      },
      adjacentRegionPairs,
    );
    return result ? [result] : [];
  }).sort((left, right) => right.tier - left.tier);
  return results[0] ? publicTier(results[0].tier) : undefined;
}

export function resolveRequestCircleTier(
  request: RequestTarget,
  viewer: DirectoryViewer,
  adjacentRegionPairs: readonly AdjacentRegionPair[],
) {
  const result = scoreMatch(
    {
      id: "directory-viewer",
      subjectIds: ["directory-circle"],
      serviceAreas: viewer.districtIds,
      acceptsOnline: viewer.acceptsOnline,
    },
    { ...request, subjectIds: ["directory-circle"] },
    adjacentRegionPairs,
  );
  return result ? publicTier(result.tier) : undefined;
}
