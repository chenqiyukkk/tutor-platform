import "server-only";

import { cookies } from "next/headers";

import { getAuthService } from "@/features/auth/server";
import { sessionCookieNames } from "@/features/auth/session";
import { db } from "@/lib/db";

import { findAdjacentRegionPairs } from "./adjacency";
import { createDirectoryAccessContext, type DirectoryViewer } from "./circle";

export async function getDirectoryAccessContext(role: "parent" | "teacher") {
  const token = (await cookies()).get(sessionCookieNames[role])?.value;
  if (!token) return createDirectoryAccessContext(false, null);
  let account;
  try {
    account = await getAuthService().getSession(role, token);
  } catch {
    return createDirectoryAccessContext(false, null);
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
    const candidate: DirectoryViewer | null = request?.regionId ? {
      districtIds: [{ districtId: request.regionId, isPrimary: true }],
      acceptsOnline: request.teachingMode === "ONLINE" || request.teachingMode === "BOTH",
    } : null;
    return createDirectoryAccessContext(true, candidate);
  }

  const profile = await db.teacherProfile.findUnique({
    where: { accountId: account.id },
    select: { id: true, isOnline: true },
  });
  if (!profile) return createDirectoryAccessContext(true, null);
  const areas = await db.teacherServiceArea.findMany({
    where: { teacherProfileId: profile.id, region: { isActive: true, level: 3 } },
    select: { regionId: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" }, { regionId: "asc" }],
  });
  return createDirectoryAccessContext(true, {
    districtIds: areas.map(({ regionId, isPrimary }) => ({ districtId: regionId, isPrimary })),
    acceptsOnline: profile.isOnline,
  });
}

export async function getAdjacentRegionPairs(regionIds: readonly string[]) {
  return findAdjacentRegionPairs(db, regionIds);
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
