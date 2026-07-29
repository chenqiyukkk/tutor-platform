import { createHmac, randomBytes } from "node:crypto";

import type { AuthRole } from "./schemas";

export const sessionCookieNames: Record<AuthRole, string> = {
  teacher: "tutor_teacher_session",
  parent: "tutor_parent_session",
  admin: "tutor_admin_session",
};

export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

export function assertSessionSecret(sessionSecret: string) {
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
}

export function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function digestSessionToken(token: string, sessionSecret: string) {
  assertSessionSecret(sessionSecret);
  return createHmac("sha256", sessionSecret).update(token).digest("hex");
}

export function getSessionCookie(role: AuthRole, production = process.env.NODE_ENV === "production") {
  return {
    name: sessionCookieNames[role],
    options: {
      httpOnly: true as const,
      sameSite: "lax" as const,
      path: "/",
      secure: production,
    },
  };
}

export function getExpiredSessionCookie(role: AuthRole) {
  const cookie = getSessionCookie(role);
  return {
    ...cookie,
    options: {
      ...cookie.options,
      expires: new Date(0),
      maxAge: 0,
    },
  };
}
