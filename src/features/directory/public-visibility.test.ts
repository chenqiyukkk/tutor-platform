import type { PrismaClient, Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CURRENT_PUBLIC_CONTENT_SAFETY_VERSION } from "@/features/safety/public-content-version";
import { resolveModerationTarget } from "@/features/moderation/data";

import { PrismaDirectoryRepository } from "./repository";

const now = new Date("2026-07-14T08:00:00.000Z");

function repositoryClient(transaction: object) {
  return {
    $transaction: vi.fn(async (callback: (client: object) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;
}

function firstAndFilter(where: { AND?: Prisma.TeacherProfileWhereInput[] | Prisma.TutoringRequestWhereInput[] }) {
  expect(Array.isArray(where.AND)).toBe(true);
  return where.AND?.[0];
}

afterEach(() => vi.useRealTimers());

describe("canonical public visibility predicates", () => {
  it("keeps teacher completeness, account, safety, subject and area edges in parity", async () => {
    const directoryFind = vi.fn().mockResolvedValue(null);
    const directory = new PrismaDirectoryRepository(repositoryClient({
      teacherProfile: { findFirst: directoryFind },
    }));
    const moderationFind = vi.fn().mockResolvedValue(null);

    await directory.getTeacherDetail("profile-id");
    await resolveModerationTarget(
      { teacherProfile: { findFirst: moderationFind } } as unknown as PrismaClient,
      { id: "parent-id", role: "parent" },
      { kind: "teacher_profile", profileId: "profile-id" },
      now,
      "report",
    );

    const directoryBase = firstAndFilter(directoryFind.mock.calls[0][0].where);
    const moderationBase = firstAndFilter(moderationFind.mock.calls[0][0].where);
    expect(moderationBase).toEqual(directoryBase);
    expect(directoryBase).toEqual({
      status: "PUBLISHED",
      publishedAt: { not: null },
      publicContentSafetyVersion: CURRENT_PUBLIC_CONTENT_SAFETY_VERSION,
      displayName: { not: "" },
      headline: { not: null },
      identityType: { not: null },
      bio: { not: null },
      yearsExperience: { not: null },
      hourlyRate: { not: null },
      hourlyRateMax: { not: null },
      account: { role: "TEACHER", status: "ACTIVE" },
      subjects: { some: {}, every: { subject: { isActive: true } } },
      serviceAreas: {
        some: { isPrimary: true },
        every: { region: { isActive: true, level: 3 } },
      },
    });
  });

  it("keeps request publication, expiry, parent, student, region and subject edges in parity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const directoryFind = vi.fn().mockResolvedValue(null);
    const directory = new PrismaDirectoryRepository(repositoryClient({
      tutoringRequest: { findFirst: directoryFind },
    }));
    const moderationFind = vi.fn().mockResolvedValue(null);

    await directory.getRequestDetail("request-id");
    await resolveModerationTarget(
      { tutoringRequest: { findFirst: moderationFind } } as unknown as PrismaClient,
      { id: "teacher-id", role: "teacher" },
      { kind: "tutoring_request", requestId: "request-id" },
      now,
      "report",
    );

    const directoryBase = firstAndFilter(directoryFind.mock.calls[0][0].where);
    const moderationBase = firstAndFilter(moderationFind.mock.calls[0][0].where);
    expect(moderationBase).toEqual(directoryBase);
    expect(directoryBase).toEqual({
      status: "PUBLISHED",
      publishedAt: { not: null },
      publicContentSafetyVersion: CURRENT_PUBLIC_CONTENT_SAFETY_VERSION,
      title: { not: "" },
      description: { not: "" },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      parentProfile: { account: { role: "PARENT", status: "ACTIVE" } },
      studentProfile: { is: { isActive: true } },
      region: { is: { isActive: true, level: 3 } },
      subjects: { some: {}, every: { subject: { isActive: true } } },
    });
  });
});
