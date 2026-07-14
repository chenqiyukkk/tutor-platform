import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  requestPublicVisibilityWhere,
  teacherPublicVisibilityWhere,
} from "@/features/directory/public-visibility";

import { resolveModerationTarget } from "./data";

const ids = {
  teacher: "11111111-1111-4111-8111-111111111111",
  parent: "22222222-2222-4222-8222-222222222222",
  profile: "33333333-3333-4333-8333-333333333333",
  request: "44444444-4444-4444-8444-444444444444",
  parentProfile: "55555555-5555-4555-8555-555555555555",
  student: "66666666-6666-4666-8666-666666666666",
  region: "77777777-7777-4777-8777-777777777777",
  subject: "88888888-8888-4888-8888-888888888888",
};

const now = new Date("2026-07-14T08:00:00.000Z");

function forbiddenEvidenceQuery(name: string) {
  return vi.fn(() => {
    throw new Error(`block must not hydrate ${name}`);
  });
}

describe("resolveModerationTarget evidence hydration", () => {
  it("resolves a teacher block with one scalar profile query and no report evidence", async () => {
    const teacherProfile = {
      findFirst: vi.fn().mockResolvedValue({ id: ids.profile, accountId: ids.teacher }),
    };
    const evidence = {
      teacherSubject: { findMany: forbiddenEvidenceQuery("teacher subjects") },
      subject: { findMany: forbiddenEvidenceQuery("subject evidence") },
      teacherServiceArea: { findMany: forbiddenEvidenceQuery("teacher areas") },
      region: { findMany: forbiddenEvidenceQuery("region evidence") },
      verification: { findMany: forbiddenEvidenceQuery("verification evidence") },
    };
    const client = { teacherProfile, ...evidence } as unknown as PrismaClient;

    const resolved = await resolveModerationTarget(
      client,
      { id: ids.parent, role: "parent" },
      { kind: "teacher_profile", profileId: ids.profile },
      now,
      "block",
    );

    expect(resolved).toMatchObject({
      targetType: "TEACHER_PROFILE",
      targetId: ids.profile,
      reportedAccountId: ids.teacher,
      pair: { teacherId: ids.teacher, parentId: ids.parent },
    });
    expect(resolved).not.toHaveProperty("snapshot");
    expect(teacherProfile.findFirst).toHaveBeenCalledWith({
      where: { AND: [teacherPublicVisibilityWhere, { id: ids.profile }] },
      select: { id: true, accountId: true },
    });
    for (const repository of Object.values(evidence)) expect(repository.findMany).not.toHaveBeenCalled();
  });

  it("resolves a request block with scalar request and parent-account queries only", async () => {
    const tutoringRequest = {
      findFirst: vi.fn().mockResolvedValue({ id: ids.request, parentProfileId: ids.parentProfile }),
    };
    const parentProfile = {
      findUnique: vi.fn().mockResolvedValue({ accountId: ids.parent }),
    };
    const evidence = {
      studentProfile: { findFirst: forbiddenEvidenceQuery("student evidence") },
      region: { findFirst: forbiddenEvidenceQuery("region evidence") },
      requestSubject: { findMany: forbiddenEvidenceQuery("request subjects") },
      subject: { findMany: forbiddenEvidenceQuery("subject evidence") },
    };
    const client = { tutoringRequest, parentProfile, ...evidence } as unknown as PrismaClient;

    const resolved = await resolveModerationTarget(
      client,
      { id: ids.teacher, role: "teacher" },
      { kind: "tutoring_request", requestId: ids.request },
      now,
      "block",
    );

    expect(resolved).toMatchObject({
      targetType: "TUTORING_REQUEST",
      targetId: ids.request,
      reportedAccountId: ids.parent,
      pair: { teacherId: ids.teacher, parentId: ids.parent },
    });
    expect(resolved).not.toHaveProperty("snapshot");
    expect(tutoringRequest.findFirst).toHaveBeenCalledWith({
      where: { AND: [requestPublicVisibilityWhere(now), { id: ids.request }] },
      select: { id: true, parentProfileId: true },
    });
    expect(parentProfile.findUnique).toHaveBeenCalledOnce();
    expect(evidence.studentProfile.findFirst).not.toHaveBeenCalled();
    expect(evidence.region.findFirst).not.toHaveBeenCalled();
    expect(evidence.requestSubject.findMany).not.toHaveBeenCalled();
    expect(evidence.subject.findMany).not.toHaveBeenCalled();
  });

  it("hydrates the complete safe teacher snapshot for a report", async () => {
    const client = {
      teacherProfile: {
        findFirst: vi.fn().mockResolvedValue({
          id: ids.profile,
          accountId: ids.teacher,
          displayName: "林老师",
          identityType: "FULL_TIME_TEACHER",
          headline: "耐心讲解",
          bio: "公开简介",
          yearsExperience: 5,
          hourlyRate: { toNumber: () => 100 },
          hourlyRateMax: { toNumber: () => 150 },
          isOnline: true,
          publishedAt: now,
        }),
      },
      teacherSubject: { findMany: vi.fn().mockResolvedValue([{ subjectId: ids.subject }]) },
      subject: { findMany: vi.fn().mockResolvedValue([{ id: ids.subject, name: "数学" }]) },
      teacherServiceArea: {
        findMany: vi.fn().mockResolvedValue([{ regionId: ids.region, isPrimary: true }]),
      },
      region: { findMany: vi.fn().mockResolvedValue([{ id: ids.region, name: "浦东新区" }]) },
      verification: { findMany: vi.fn().mockResolvedValue([{ id: "verification" }]) },
    };

    const resolved = await resolveModerationTarget(
      client as unknown as PrismaClient,
      { id: ids.parent, role: "parent" },
      { kind: "teacher_profile", profileId: ids.profile },
      now,
      "report",
    );

    expect(client.teacherSubject.findMany).toHaveBeenCalledOnce();
    expect(client.teacherServiceArea.findMany).toHaveBeenCalledOnce();
    expect(client.region.findMany).toHaveBeenCalledOnce();
    expect(client.verification.findMany).toHaveBeenCalledOnce();
    expect(resolved?.snapshot).toMatchObject({
      kind: "teacher_profile",
      profile: {
        id: ids.profile,
        subjects: [{ id: ids.subject, name: "数学" }],
        serviceAreas: [{ id: ids.region, name: "浦东新区", isPrimary: true }],
        verified: true,
      },
    });
  });

  it("hydrates student, region and subject evidence for a request report", async () => {
    const client = {
      tutoringRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: ids.request,
          title: "初中数学辅导",
          description: "公开需求描述",
          scheduleText: "周末",
          budgetMin: 10000,
          budgetMax: 15000,
          teachingMode: "BOTH",
          publicLocationNote: "地铁站附近",
          publishedAt: now,
          parentProfileId: ids.parentProfile,
          studentProfileId: ids.student,
          regionId: ids.region,
        }),
      },
      parentProfile: { findUnique: vi.fn().mockResolvedValue({ accountId: ids.parent }) },
      studentProfile: {
        findFirst: vi.fn().mockResolvedValue({ displayName: "同学A", gradeLevel: "八年级" }),
      },
      region: { findFirst: vi.fn().mockResolvedValue({ id: ids.region, name: "浦东新区" }) },
      requestSubject: { findMany: vi.fn().mockResolvedValue([{ subjectId: ids.subject }]) },
      subject: { findMany: vi.fn().mockResolvedValue([{ id: ids.subject, name: "数学" }]) },
    };

    const resolved = await resolveModerationTarget(
      client as unknown as PrismaClient,
      { id: ids.teacher, role: "teacher" },
      { kind: "tutoring_request", requestId: ids.request },
      now,
      "report",
    );

    expect(client.studentProfile.findFirst).toHaveBeenCalledOnce();
    expect(client.region.findFirst).toHaveBeenCalledOnce();
    expect(client.requestSubject.findMany).toHaveBeenCalledOnce();
    expect(client.subject.findMany).toHaveBeenCalledOnce();
    expect(resolved?.snapshot).toMatchObject({
      kind: "tutoring_request",
      request: {
        id: ids.request,
        studentAlias: "同学A",
        region: { id: ids.region, name: "浦东新区" },
        subjects: [{ id: ids.subject, name: "数学" }],
      },
    });
  });
});
