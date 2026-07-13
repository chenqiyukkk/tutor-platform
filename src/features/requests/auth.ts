import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireSessionRole } from "@/features/auth/guards";
import { getAuthService } from "@/features/auth/server";
import { sessionCookieNames } from "@/features/auth/session";

export async function getAuthenticatedParent() {
  const cookieStore = await cookies();
  try { return await requireSessionRole(getAuthService(), "parent", cookieStore.get(sessionCookieNames.parent)?.value); }
  catch { redirect("/parent/login"); }
}
