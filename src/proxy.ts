import { NextResponse, type NextRequest } from "next/server";

import { sessionCookieNames } from "./features/auth/session";

const protectedRolePath = /^\/(teacher|parent|admin)\/dashboard(?:\/|$)/;

export function proxy(request: NextRequest) {
  const match = request.nextUrl.pathname.match(protectedRolePath);
  if (!match) return NextResponse.next();

  const role = match[1] as keyof typeof sessionCookieNames;
  if (!request.cookies.has(sessionCookieNames[role])) {
    return NextResponse.redirect(new URL(`/${role}/login`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/teacher/dashboard/:path*",
    "/parent/dashboard/:path*",
    "/admin/dashboard/:path*",
  ],
};
