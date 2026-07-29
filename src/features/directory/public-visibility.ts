import "server-only";

import type { Prisma } from "@prisma/client";

import { CURRENT_PUBLIC_CONTENT_SAFETY_VERSION } from "@/features/safety/public-content-version";

export const teacherPublicVisibilityWhere = {
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
  subjects: {
    some: {},
    every: { subject: { isActive: true } },
  },
  serviceAreas: {
    some: { isPrimary: true },
    every: { region: { isActive: true, level: 3 } },
  },
} satisfies Prisma.TeacherProfileWhereInput;

export function requestPublicVisibilityWhere(now = new Date()): Prisma.TutoringRequestWhereInput {
  return {
    status: "PUBLISHED",
    publishedAt: { not: null },
    publicContentSafetyVersion: CURRENT_PUBLIC_CONTENT_SAFETY_VERSION,
    title: { not: "" },
    description: { not: "" },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    parentProfile: { account: { role: "PARENT", status: "ACTIVE" } },
    studentProfile: { is: { isActive: true } },
    region: { is: { isActive: true, level: 3 } },
    subjects: {
      some: {},
      every: { subject: { isActive: true } },
    },
  };
}
