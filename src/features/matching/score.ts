import {
  MATCH_TIER_LABELS,
  MatchTier,
  type AdjacentRegionPair,
  type MatchRequest,
  type MatchResult,
  type MatchServiceArea,
  type MatchTeacher,
} from "./types";

function uniqueNonEmpty(values: readonly string[]) {
  return new Set(values.filter((value) => value.length > 0));
}

function deduplicateServiceAreas(areas: readonly MatchServiceArea[]) {
  const byDistrict = new Map<string, boolean>();
  for (const area of areas) {
    if (!area.districtId) continue;
    byDistrict.set(area.districtId, Boolean(byDistrict.get(area.districtId)) || area.isPrimary);
  }
  return byDistrict;
}

function areAdjacent(
  left: string,
  right: string,
  adjacentRegionPairs: readonly AdjacentRegionPair[],
) {
  return adjacentRegionPairs.some(
    ([first, second]) =>
      (first === left && second === right) || (first === right && second === left),
  );
}

function resolveTier(
  teacher: MatchTeacher,
  request: MatchRequest,
  adjacentRegionPairs: readonly AdjacentRegionPair[],
) {
  const areas = deduplicateServiceAreas(teacher.serviceAreas);
  const districtId = request.districtId;

  if (districtId && areas.get(districtId) === true) {
    return MatchTier.PrimaryDistrictExact;
  }
  if (districtId && areas.has(districtId)) {
    return MatchTier.ExtraDistrictExact;
  }
  if (
    districtId &&
    [...areas.keys()].some((serviceDistrictId) =>
      areAdjacent(districtId, serviceDistrictId, adjacentRegionPairs))
  ) {
    return MatchTier.AdjacentDistrict;
  }
  if (teacher.acceptsOnline && request.acceptsOnline) {
    return MatchTier.Online;
  }
  return null;
}

function budgetCompatibility(teacher: MatchTeacher, request: MatchRequest) {
  const rate = teacher.hourlyRateCents;
  const minimum = request.budgetMinCents;
  const maximum = request.budgetMaxCents;
  if (
    rate === undefined ||
    minimum === undefined ||
    maximum === undefined ||
    !Number.isSafeInteger(rate) ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    rate < 0 ||
    minimum < 0 ||
    maximum < minimum
  ) {
    return 0;
  }
  return rate >= minimum && rate <= maximum ? 100 : 0;
}

export function scoreMatch(
  teacher: MatchTeacher,
  request: MatchRequest,
  adjacentRegionPairs: readonly AdjacentRegionPair[],
): MatchResult | null {
  const teacherSubjects = uniqueNonEmpty(teacher.subjectIds);
  const requestSubjects = uniqueNonEmpty(request.subjectIds);
  if (teacherSubjects.size === 0 || requestSubjects.size === 0) return null;

  const matchedSubjectCount = [...requestSubjects]
    .filter((subjectId) => teacherSubjects.has(subjectId)).length;
  if (matchedSubjectCount === 0) return null;

  const tier = resolveTier(teacher, request, adjacentRegionPairs);
  if (tier === null) return null;

  const subjectScore = Math.round((matchedSubjectCount / requestSubjects.size) * 100);
  const budgetScore = budgetCompatibility(teacher, request);
  const secondaryScore = Math.round((subjectScore + budgetScore) / 2);

  return {
    tier,
    tierLabel: MATCH_TIER_LABELS[tier],
    secondaryScore,
    reasons: [
      MATCH_TIER_LABELS[tier],
      `科目匹配 ${matchedSubjectCount}/${requestSubjects.size}`,
      budgetScore === 100 ? "时薪在预算范围内" : "预算未提供或不重叠",
    ],
    tieBreakKey: teacher.id,
  };
}

export function compareMatchResults(left: MatchResult, right: MatchResult) {
  if (left.tier !== right.tier) return right.tier - left.tier;
  if (left.secondaryScore !== right.secondaryScore) {
    return right.secondaryScore - left.secondaryScore;
  }
  if (left.tieBreakKey < right.tieBreakKey) return -1;
  if (left.tieBreakKey > right.tieBreakKey) return 1;
  return 0;
}
