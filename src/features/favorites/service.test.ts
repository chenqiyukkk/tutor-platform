import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decodeFavoriteCursor } from "./schema";
import { createFavoriteService } from "./service";

const ownerId = "00000000-0000-4000-8000-000000000001";
const firstFavoriteId = "00000000-0000-4000-8000-000000000011";
const secondFavoriteId = "00000000-0000-4000-8000-000000000012";
const overflowFavoriteId = "00000000-0000-4000-8000-000000000013";
const firstTargetId = "00000000-0000-4000-8000-000000000021";
const secondTargetId = "00000000-0000-4000-8000-000000000022";
const overflowTargetId = "00000000-0000-4000-8000-000000000023";

function createListDb(role: "parent" | "teacher") {
  const createdAt = new Date("2026-07-13T06:00:00.123Z");
  const favoriteRows = [
    {
      id: firstFavoriteId,
      teacherProfileId: role === "parent" ? firstTargetId : null,
      tutoringRequestId: role === "teacher" ? firstTargetId : null,
      createdAt: new Date("2026-07-14T06:00:00.123Z"),
    },
    {
      id: secondFavoriteId,
      teacherProfileId: role === "parent" ? secondTargetId : null,
      tutoringRequestId: role === "teacher" ? secondTargetId : null,
      createdAt,
    },
    {
      id: overflowFavoriteId,
      teacherProfileId: role === "parent" ? overflowTargetId : null,
      tutoringRequestId: role === "teacher" ? overflowTargetId : null,
      createdAt,
    },
  ];
  const targetRows = [
    role === "parent"
      ? { id: secondTargetId, displayName: "第二位老师", headline: "第二条摘要" }
      : { id: secondTargetId, title: "第二条需求" },
    role === "parent"
      ? { id: firstTargetId, displayName: "第一位老师", headline: "第一条摘要" }
      : { id: firstTargetId, title: "第一条需求" },
  ];
  const teacherFindMany = vi.fn(async () => role === "parent" ? targetRows : []);
  const requestFindMany = vi.fn(async () => role === "teacher" ? targetRows : []);
  const favoriteFindMany = vi.fn(async () => favoriteRows);
  const db = {
    account: { findFirst: vi.fn(async () => ({ id: ownerId })) },
    favorite: { findMany: favoriteFindMany },
    teacherProfile: { findMany: teacherFindMany },
    tutoringRequest: { findMany: requestFindMany },
  } as unknown as PrismaClient;
  return { createdAt, db, favoriteFindMany, teacherFindMany, requestFindMany };
}

describe("favorite list service", () => {
  it.each(["parent", "teacher"] as const)(
    "loads one bounded %s page with one role-specific target query and preserves favorite order",
    async (role) => {
      const { createdAt, db, favoriteFindMany, requestFindMany, teacherFindMany } = createListDb(role);
      const page = await createFavoriteService(db).list(
        { id: ownerId, role },
        { pageSize: 2 },
      );

      expect(page.items.map(({ id }) => id)).toEqual([
        firstFavoriteId,
        secondFavoriteId,
      ]);
      expect(page.pageSize).toBe(2);
      expect(favoriteFindMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 3,
      }));
      expect(decodeFavoriteCursor(page.nextCursor!)).toEqual({
        createdAt,
        id: secondFavoriteId,
      });
      expect(teacherFindMany).toHaveBeenCalledTimes(role === "parent" ? 1 : 0);
      expect(requestFindMany).toHaveBeenCalledTimes(role === "teacher" ? 1 : 0);
    },
  );
});
