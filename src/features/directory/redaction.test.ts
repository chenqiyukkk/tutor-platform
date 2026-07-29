import { describe, expect, it } from "vitest";

import {
  toPublicRequestDetail,
  toPublicRequestListItem,
  toPublicTeacherDetail,
  toPublicTeacherListItem,
} from "./redaction";

const teacherRow = {
  id: "teacher-public-id",
  displayName: "林老师",
  identityType: "FULL_TIME_TEACHER" as const,
  headline: "把几何讲成可复用的方法",
  bio: "八年一线教学经验",
  yearsExperience: 8,
  hourlyRate: { toNumber: () => 120 },
  hourlyRateMax: { toNumber: () => 180 },
  isOnline: true,
  publishedAt: new Date("2026-07-01T08:00:00.000Z"),
  subjects: [{ subject: { id: "subject-id", name: "数学" } }],
  serviceAreas: [{ isPrimary: true, region: { id: "region-id", name: "海淀区" } }],
  verifications: [{ id: "approved-verification" }],
};

const requestRow = {
  id: "request-public-id",
  title: "初二数学巩固",
  description: "希望梳理几何基础",
  scheduleText: "周六下午",
  budgetMin: 10000,
  budgetMax: 16000,
  teachingMode: "BOTH" as const,
  publicLocationNote: "五道口商圈附近",
  publishedAt: new Date("2026-07-02T08:00:00.000Z"),
  studentProfile: { displayName: "小树", gradeLevel: "GRADE_8" },
  region: { id: "region-id", name: "海淀区" },
  subjects: [{ subject: { id: "subject-id", name: "数学" } }],
};

describe("directory redaction", () => {
  it("constructs teacher list/detail DTOs from an explicit public whitelist", () => {
    const list = toPublicTeacherListItem(teacherRow);
    const detail = toPublicTeacherDetail(teacherRow);

    expect(list).toEqual({
      id: "teacher-public-id",
      publicNickname: "林老师",
      identityType: "FULL_TIME_TEACHER",
      headline: "把几何讲成可复用的方法",
      yearsExperience: 8,
      rateMinCents: 12000,
      rateMaxCents: 18000,
      online: true,
      subjects: [{ id: "subject-id", name: "数学" }],
      serviceAreas: [{ id: "region-id", name: "海淀区", isPrimary: true }],
      verified: true,
      publishedAt: "2026-07-01T08:00:00.000Z",
    });
    expect(detail).toEqual({ ...list, bio: "八年一线教学经验" });
    expect(JSON.stringify({ list, detail })).not.toMatch(
      /username|email|passwordHash|accountId|evidence|reviewNote/i,
    );
  });

  it("keeps request list compact and never includes parent or student-private fields", () => {
    const list = toPublicRequestListItem(requestRow);
    const detail = toPublicRequestDetail(requestRow);

    expect(list).toEqual({
      id: "request-public-id",
      title: "初二数学巩固",
      studentAlias: "小树",
      gradeLevel: "GRADE_8",
      budgetMinCents: 10000,
      budgetMaxCents: 16000,
      teachingMode: "BOTH",
      scheduleText: "周六下午",
      region: { id: "region-id", name: "海淀区" },
      subjects: [{ id: "subject-id", name: "数学" }],
      publishedAt: "2026-07-02T08:00:00.000Z",
    });
    expect(detail).toEqual({
      ...list,
      description: "希望梳理几何基础",
      publicLocationNote: "五道口商圈附近",
    });
    expect(JSON.stringify({ list, detail })).not.toMatch(
      /notes|parentProfile|account|username|email|passwordHash/i,
    );
  });
});
