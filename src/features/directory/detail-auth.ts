import { sessionCookieNames } from "@/features/auth/session";

type DetailRole = "parent" | "teacher";
type AuthenticateSession = (role: DetailRole, token: string) => Promise<unknown>;

function cookieValue(request: Request, name: string) {
  for (const cookie of (request.headers.get("cookie") ?? "").split(";")) {
    const [rawName, ...value] = cookie.trim().split("=");
    if (rawName === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function createDirectoryDetailAuthorizer(authenticate: AuthenticateSession) {
  return async (request: Request, role: DetailRole) => {
    const token = cookieValue(request, sessionCookieNames[role]);
    if (!token) return false;
    try {
      await authenticate(role, token);
      return true;
    } catch {
      return false;
    }
  };
}
