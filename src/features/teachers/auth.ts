import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireSessionRole } from "@/features/auth/guards";
import { getAuthService } from "@/features/auth/server";
import { sessionCookieNames } from "@/features/auth/session";

export async function getAuthenticatedTeacher() {
  const cookieStore = await cookies();
  try {
    return await requireSessionRole(
      getAuthService(),
      "teacher",
      cookieStore.get(sessionCookieNames.teacher)?.value,
    );
  } catch {
    redirect("/teacher/login");
  }
}
