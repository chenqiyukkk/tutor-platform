import "server-only";

import { headers } from "next/headers";

import { getAuthService } from "@/features/auth/server";
import { sessionCookieNames } from "@/features/auth/session";
import { readUniqueCookieValue } from "@/features/directory/detail-auth";
import { db } from "@/lib/db";

export async function getParentPublishedRequestOptions() {
  const token = readUniqueCookieValue((await headers()).get("cookie"), sessionCookieNames.parent);
  if (!token) return [];
  let account;
  try { account = await getAuthService().getSession("parent", token); } catch { return []; }
  const now = new Date();
  return db.tutoringRequest.findMany({
    where: {
      parentProfile: { accountId: account.id, account: { status: "ACTIVE" } },
      status: "PUBLISHED", publishedAt: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      studentProfile: { is: { isActive: true } },
      region: { is: { isActive: true, level: 3 } },
      subjects: { some: {}, every: { subject: { isActive: true } } },
    },
    select: { id: true, title: true },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: 50,
  }).then((rows) => rows.map(({ id, title }) => ({ id, label: title })));
}
