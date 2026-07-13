import { describe, expect, it, vi } from "vitest";

import {
  TeacherProfileError,
  calculateProfileCompletion,
  createTeacherProfileService,
  type TeacherProfile,
  type TeacherProfileRepository,
} from "./service";

const teacher = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "teacher" as const };
const parent = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", role: "parent" as const };
const subjectId = "11111111-1111-4111-8111-111111111111";
const primaryRegionId = "22222222-2222-4222-8222-222222222222";
const extraRegionId = "33333333-3333-4333-8333-333333333333";

function completeProfile(overrides: Partial<TeacherProfile> = {}): TeacherProfile {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    accountId: teacher.id,
    publicNickname: "林老师",
    identityType: "FULL_TIME_TEACHER",
    bio: "十年一线教学经验，擅长帮助学生建立清晰的知识体系。",
    yearsExperience: 10,
    online: true,
    rateMinCents: 12000,
    rateMaxCents: 20000,
    status: "DRAFT",
    publishedAt: null,
    subjects: [{ id: subjectId, name: "数学" }],
    primaryRegion: { id: primaryRegionId, name: "天河区" },
    extraRegions: [{ id: extraRegionId, name: "越秀区" }],
    ...overrides,
  };
}

function repository(overrides: Partial<TeacherProfileRepository> = {}): TeacherProfileRepository {
  return {
    findOwned: vi.fn().mockResolvedValue(null),
    saveOwned: vi.fn().mockResolvedValue(completeProfile()),
    setPublished: vi.fn().mockResolvedValue(completeProfile({ status: "PUBLISHED" })),
    ...overrides,
  };
}

describe("teacher profile service", () => {
  it("allows only a teacher and rejects caller-controlled accountId", async () => {
    const repo = repository();
    const service = createTeacherProfileService(repo);

    await expect(service.saveDraft(parent, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.saveDraft(teacher, { accountId: parent.id } as never))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.saveOwned).not.toHaveBeenCalled();
  });

  it("trims draft fields, deduplicates ids, and always uses the authenticated owner", async () => {
    const repo = repository();
    const service = createTeacherProfileService(repo);

    await service.saveDraft(teacher, {
      publicNickname: "  林老师  ",
      identityType: "UNIVERSITY_STUDENT",
      bio: "  擅长启发式教学  ",
      yearsExperience: 2,
      online: true,
      rateMinCents: 8000,
      rateMaxCents: 12000,
      subjectIds: [subjectId, subjectId],
      primaryRegionId,
      extraRegionIds: [extraRegionId, extraRegionId],
    });

    expect(repo.saveOwned).toHaveBeenCalledWith(teacher.id, expect.objectContaining({
      publicNickname: "林老师",
      bio: "擅长启发式教学",
      subjectIds: [subjectId],
      extraRegionIds: [extraRegionId],
    }));
  });

  it.each([
    [{ rateMinCents: -1 }, "rateMinCents"],
    [{ rateMaxCents: 100001 }, "rateMaxCents"],
    [{ rateMinCents: 20000, rateMaxCents: 10000 }, "rateMaxCents"],
    [{ primaryRegionId, extraRegionIds: [primaryRegionId] }, "extraRegionIds"],
    [{ extraRegionIds: Array.from({ length: 5 }, (_, index) => `${index + 1}0000000-0000-4000-8000-000000000000`) }, "extraRegionIds"],
  ])("rejects invalid provided draft values with field errors", async (input, field) => {
    const service = createTeacherProfileService(repository());
    await expect(service.saveDraft(teacher, input)).rejects.toSatisfy((error: unknown) =>
      Boolean(error instanceof TeacherProfileError && error.fieldErrors[field]?.length),
    );
  });

  it("requires complete fields, a subject and a primary district before publish", async () => {
    const service = createTeacherProfileService(repository({
      findOwned: vi.fn().mockResolvedValue(completeProfile({
        publicNickname: "",
        subjects: [],
        primaryRegion: null,
      })),
    }));

    await expect(service.publish(teacher)).rejects.toMatchObject({
      code: "INCOMPLETE_PROFILE",
      fieldErrors: expect.objectContaining({
        publicNickname: expect.any(Array),
        subjectIds: expect.any(Array),
        primaryRegionId: expect.any(Array),
      }),
    });
  });

  it("publishes, unpublishes and previews only the authenticated teacher profile", async () => {
    const own = completeProfile();
    const repo = repository({ findOwned: vi.fn().mockResolvedValue(own) });
    const service = createTeacherProfileService(repo);

    await expect(service.preview(teacher)).resolves.toEqual(own);
    await service.publish(teacher);
    await service.unpublish(teacher);

    expect(repo.findOwned).toHaveBeenCalledWith(teacher.id);
    expect(repo.setPublished).toHaveBeenNthCalledWith(1, teacher.id, true);
    expect(repo.setPublished).toHaveBeenNthCalledWith(2, teacher.id, false);
    await expect(service.preview(parent)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("profile completion", () => {
  it("is a pure calculation with stable missing labels", () => {
    const result = calculateProfileCompletion(completeProfile({
      bio: null,
      yearsExperience: null,
      rateMinCents: null,
      rateMaxCents: null,
      subjects: [],
    }));

    expect(result).toEqual({
      percentage: 43,
      missingItems: ["个人简介", "教学年限", "授课价格", "授课科目"],
    });
  });
});
