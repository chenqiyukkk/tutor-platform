import { NextResponse, type NextRequest } from "next/server";

import { sessionCookieNames } from "./features/auth/session";
import { FixedWindowRateLimiter, type RateLimitPolicy } from "./lib/rate-limit";

const protectedRolePath = /^\/(teacher|parent|admin)\/dashboard(?:\/|$)/;
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const defaultLimiter = new FixedWindowRateLimiter();

type Limiter = { consume(key: string, policy: RateLimitPolicy): { allowed: boolean; retryAfterSeconds: number } };

function mutationPolicy(pathname: string): { bucket: string; policy: RateLimitPolicy } {
  if (/^\/api\/auth\/[^/]+\/(?:login|register|forgot-password|reset-password)$/u.test(pathname)) {
    return { bucket: "auth", policy: { limit: 10, windowMs: 15 * 60_000 } };
  }
  if (/^\/api\/conversations\/[^/]+\/(?:messages|read)$/u.test(pathname)) {
    return { bucket: "chat", policy: { limit: 60, windowMs: 60_000 } };
  }
  return { bucket: "mutation", policy: { limit: 120, windowMs: 60_000 } };
}

function clientAddress(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip") || "unknown").slice(0, 80);
}

export function createPlatformProxy({ appUrl, limiter = defaultLimiter }: { appUrl?: string; limiter?: Limiter } = {}) {
  return function platformProxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    if (pathname.startsWith("/api/") && unsafeMethods.has(request.method.toUpperCase())) {
      const expectedOrigin = new URL(appUrl ?? process.env.APP_URL ?? request.nextUrl.origin).origin;
      const origin = request.headers.get("origin");
      if (!origin || origin !== expectedOrigin) {
        return NextResponse.json({ code: "FORBIDDEN_ORIGIN", error: "请求来源无效" }, { status: 403, headers: { "Cache-Control": "no-store" } });
      }
      const selected = mutationPolicy(pathname);
      const result = limiter.consume(`${selected.bucket}:${clientAddress(request)}`, selected.policy);
      if (!result.allowed) {
        return NextResponse.json({ code: "RATE_LIMITED", error: "请求过于频繁，请稍后重试" }, {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": String(result.retryAfterSeconds) },
        });
      }
    }

    const match = pathname.match(protectedRolePath);
    if (!match) return NextResponse.next();

    const role = match[1] as keyof typeof sessionCookieNames;
    if (!request.cookies.has(sessionCookieNames[role])) {
      return NextResponse.redirect(new URL(`/${role}/login`, request.url));
    }
    return NextResponse.next();
  };
}

export const proxy = createPlatformProxy();

export const config = {
  matcher: [
    "/teacher/dashboard/:path*",
    "/parent/dashboard/:path*",
    "/admin/dashboard/:path*",
    "/api/:path*",
  ],
};
