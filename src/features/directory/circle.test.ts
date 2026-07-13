import { describe, expect, it } from "vitest";

import { resolveRequestCircleTier, resolveTeacherCircleTier } from "./circle";

const adjacent = [["viewer-region", "nearby-region"]] as const;

describe("directory circle tier", () => {
  it("uses exact, adjacent, then online order for a parent viewing teachers", () => {
    const viewer = { districtIds: [{ districtId: "viewer-region", isPrimary: true }], acceptsOnline: true };
    expect(resolveTeacherCircleTier({ id: "same", subjectIds: [], serviceAreas: [{ districtId: "viewer-region", isPrimary: false }], acceptsOnline: true }, viewer, adjacent)).toBe("SAME_DISTRICT");
    expect(resolveTeacherCircleTier({ id: "near", subjectIds: [], serviceAreas: [{ districtId: "nearby-region", isPrimary: true }], acceptsOnline: true }, viewer, adjacent)).toBe("ADJACENT_DISTRICT");
    expect(resolveTeacherCircleTier({ id: "online", subjectIds: [], serviceAreas: [], acceptsOnline: true }, viewer, adjacent)).toBe("ONLINE");
  });

  it("uses the teacher service areas when a teacher views a request", () => {
    const viewer = { districtIds: [{ districtId: "viewer-region", isPrimary: true }], acceptsOnline: false };
    expect(resolveRequestCircleTier({ id: "request", subjectIds: [], districtId: "nearby-region", acceptsOnline: false }, viewer, adjacent)).toBe("ADJACENT_DISTRICT");
  });
});
