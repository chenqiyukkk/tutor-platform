import { describe, expect, it } from "vitest";

import { compareMatchResults, scoreMatch } from "./score";
import { MatchTier, type MatchRequest, type MatchTeacher } from "./types";

const request: MatchRequest = {
  id: "request-1",
  subjectIds: ["math", "physics"],
  districtId: "district-a",
  acceptsOnline: true,
  budgetMinCents: 10_000,
  budgetMaxCents: 20_000,
};

function teacher(overrides: Partial<MatchTeacher> = {}): MatchTeacher {
  return {
    id: "teacher-default",
    subjectIds: ["math"],
    serviceAreas: [{ districtId: "district-a", isPrimary: true }],
    acceptsOnline: false,
    hourlyRateCents: 15_000,
    ...overrides,
  };
}

describe("deterministic matching score", () => {
  it("orders primary exact, extra exact, adjacent, then online regardless of secondary score", () => {
    const fixtures = [
      teacher({
        id: "online",
        subjectIds: ["math", "physics"],
        serviceAreas: [],
        acceptsOnline: true,
      }),
      teacher({
        id: "adjacent",
        subjectIds: ["math", "physics"],
        serviceAreas: [{ districtId: "district-b", isPrimary: false }],
      }),
      teacher({
        id: "extra",
        subjectIds: ["math"],
        serviceAreas: [
          { districtId: "district-z", isPrimary: true },
          { districtId: "district-a", isPrimary: false },
        ],
        hourlyRateCents: 99_999,
      }),
      teacher({ id: "primary", subjectIds: ["math"], hourlyRateCents: undefined }),
    ];

    const scored = fixtures
      .map((candidate) => scoreMatch(candidate, request, [["district-a", "district-b"]]))
      .filter((result) => result !== null)
      .sort(compareMatchResults);

    expect(scored.map(({ tieBreakKey, tier }) => [tieBreakKey, tier])).toEqual([
      ["primary", MatchTier.PrimaryDistrictExact],
      ["extra", MatchTier.ExtraDistrictExact],
      ["adjacent", MatchTier.AdjacentDistrict],
      ["online", MatchTier.Online],
    ]);
  });

  it("deduplicates subjects and service areas before scoring", () => {
    const result = scoreMatch(
      teacher({
        subjectIds: ["math", "math", "physics"],
        serviceAreas: [
          { districtId: "district-a", isPrimary: false },
          { districtId: "district-a", isPrimary: true },
        ],
      }),
      { ...request, subjectIds: ["math", "math", "physics"] },
      [],
    );

    expect(result).toMatchObject({
      tier: MatchTier.PrimaryDistrictExact,
      secondaryScore: 100,
    });
    expect(result?.reasons).toContain("科目匹配 2/2");
  });

  it.each([
    { teacherSubjects: [], requestSubjects: ["math"] },
    { teacherSubjects: ["math"], requestSubjects: [] },
    { teacherSubjects: ["english"], requestSubjects: ["math"] },
  ])("excludes empty or disjoint subject sets", ({ teacherSubjects, requestSubjects }) => {
    expect(scoreMatch(
      teacher({ subjectIds: teacherSubjects }),
      { ...request, subjectIds: requestSubjects },
      [],
    )).toBeNull();
  });

  it("returns null when neither a region nor mutual online preference matches", () => {
    expect(scoreMatch(
      teacher({
        serviceAreas: [{ districtId: "district-z", isPrimary: true }],
        acceptsOnline: true,
      }),
      { ...request, acceptsOnline: false },
      [],
    )).toBeNull();
  });

  it.each([
    { label: "missing teacher rate", hourlyRateCents: undefined, min: 10_000, max: 20_000, expected: 25 },
    { label: "missing minimum", hourlyRateCents: 15_000, min: undefined, max: 20_000, expected: 25 },
    { label: "minimum boundary", hourlyRateCents: 10_000, min: 10_000, max: 20_000, expected: 75 },
    { label: "maximum boundary", hourlyRateCents: 20_000, min: 10_000, max: 20_000, expected: 75 },
    { label: "below range", hourlyRateCents: 9_999, min: 10_000, max: 20_000, expected: 25 },
  ])("keeps the budget score bounded for $label", ({ hourlyRateCents, min, max, expected }) => {
    const result = scoreMatch(
      teacher({ hourlyRateCents }),
      { ...request, budgetMinCents: min, budgetMaxCents: max },
      [],
    );

    expect(result?.secondaryScore).toBe(expected);
    expect(result?.secondaryScore).toBeGreaterThanOrEqual(0);
    expect(result?.secondaryScore).toBeLessThanOrEqual(100);
  });

  it("uses budget overlap only inside the same region tier", () => {
    const compatible = scoreMatch(teacher({ id: "compatible", hourlyRateCents: 15_000 }), request, []);
    const incompatible = scoreMatch(teacher({ id: "incompatible", hourlyRateCents: 30_000 }), request, []);
    const betterRegion = scoreMatch(
      teacher({
        id: "better-region",
        serviceAreas: [{ districtId: "district-a", isPrimary: true }],
        hourlyRateCents: undefined,
      }),
      request,
      [],
    );
    const worseRegion = scoreMatch(
      teacher({
        id: "worse-region",
        subjectIds: ["math", "physics"],
        serviceAreas: [{ districtId: "district-b", isPrimary: false }],
      }),
      request,
      [["district-a", "district-b"]],
    );

    expect([incompatible!, compatible!].sort(compareMatchResults).map((item) => item.tieBreakKey))
      .toEqual(["compatible", "incompatible"]);
    expect([worseRegion!, betterRegion!].sort(compareMatchResults).map((item) => item.tieBreakKey))
      .toEqual(["better-region", "worse-region"]);
  });

  it("uses the teacher id as a deterministic final tie-break", () => {
    const first = scoreMatch(teacher({ id: "teacher-a" }), request, []);
    const second = scoreMatch(teacher({ id: "teacher-b" }), request, []);

    expect([second!, first!].sort(compareMatchResults).map((item) => item.tieBreakKey))
      .toEqual(["teacher-a", "teacher-b"]);
  });
});
