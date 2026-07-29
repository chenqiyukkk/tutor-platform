import { sessionCookieNames } from "@/features/auth/session";

type DetailRole = "parent" | "teacher";
type AuthenticateSession = (role: DetailRole, token: string) => Promise<unknown>;

export function readUniqueCookieValue(cookieHeader: string | null | undefined, name: string) {
  const matches: string[] = [];
  for (const cookie of (cookieHeader ?? "").split(";")) {
    const [rawName, ...value] = cookie.trim().split("=");
    if (rawName === name) matches.push(value.join("="));
  }
  if (matches.length !== 1 || !matches[0]) return undefined;
  try {
    return decodeURIComponent(matches[0]) || undefined;
  } catch {
    return undefined;
  }
}

export function createDirectoryDetailAuthorizer(authenticate: AuthenticateSession) {
  return async (request: Request, role: DetailRole) => {
    try {
      const token = readUniqueCookieValue(
        request.headers.get("cookie"),
        sessionCookieNames[role],
      );
      if (!token) return false;
      await authenticate(role, token);
      return true;
    } catch {
      return false;
    }
  };
}
