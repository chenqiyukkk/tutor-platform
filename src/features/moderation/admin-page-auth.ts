import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireSessionRole } from "@/features/auth/guards";
import { getAuthService } from "@/features/auth/server";
import { sessionCookieNames } from "@/features/auth/session";

export async function getAuthenticatedAdmin() {
  const cookieStore = await cookies();
  try {
    const account = await requireSessionRole(getAuthService(), "admin", cookieStore.get(sessionCookieNames.admin)?.value);
    return { id: account.id, role: "admin" as const };
  } catch {
    redirect("/admin/login");
  }
}
