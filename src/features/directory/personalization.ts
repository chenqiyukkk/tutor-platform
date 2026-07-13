import "server-only";

import { cookies } from "next/headers";

import { getAuthService } from "@/features/auth/server";
import { sessionCookieNames } from "@/features/auth/session";
import type { AdjacentRegionPair } from "@/features/matching/types";
import { db } from "@/lib/db";

import type { DirectoryViewer } from "./circle";

export type DirectoryViewerContext = DirectoryViewer & { role: "parent" | "teacher" };

export async function getDirectoryViewerContext(role: "parent" | "teacher") {
  const token = (await cookies()).get(sessionCookieNames[role])?.value;
  if (!token) return null;
  let account;
  try {
    account = await getAuthService().getSession(role, token);
  } catch {
    return null;
  }

  if (role === "parent") {
    const request = await db.tutoringRequest.findFirst({
      where: {
        parentProfile: { accountId: account.id },
        status: { in: ["DRAFT", "PUBLISHED"] },
        regionId: { not: null },
        region: { is: { isActive: true, level: 3 } },
      },
      select: { regionId: true, teachingMode: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    return request?.regionId ? {
      role,
      districtIds: [{ districtId: request.regionId, isPrimary: true }],
      acceptsOnline: request.teachingMode === "ONLINE" || request.teachingMode === "BOTH",
    } satisfies DirectoryViewerContext : null;
  }

  const profile = await db.teacherProfile.findUnique({
    where: { accountId: account.id },
    select: { id: true, isOnline: true },
  });
  if (!profile) return null;
  const areas = await db.teacherServiceArea.findMany({
    where: { teacherProfileId: profile.id, region: { isActive: true, level: 3 } },
    select: { regionId: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" }, { regionId: "asc" }],
  });
  if (!areas.length && !profile.isOnline) return null;
  return {
    role,
    districtIds: areas.map(({ regionId, isPrimary }) => ({ districtId: regionId, isPrimary })),
    acceptsOnline: profile.isOnline,
  } satisfies DirectoryViewerContext;
}

export async function getAdjacentRegionPairs(regionIds: readonly string[]) {
  const uniqueIds = [...new Set(regionIds)];
  if (!uniqueIds.length) return [];
  const rows = await db.regionAdjacency.findMany({
    where: { OR: [{ regionAId: { in: uniqueIds } }, { regionBId: { in: uniqueIds } }] },
    select: { regionAId: true, regionBId: true },
    orderBy: [{ regionAId: "asc" }, { regionBId: "asc" }],
  });
  return rows.map(({ regionAId, regionBId }) => [regionAId, regionBId] as AdjacentRegionPair);
}

export async function getDirectoryFilterOptions() {
  const regions = await db.region.findMany({
    where: { isActive: true, level: 3 },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
  });
  const subjects = await db.subject.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
  });
  return { regions, subjects };
}
