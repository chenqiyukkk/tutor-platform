import type { AuthRole } from "./schemas";
import type { AuthService } from "./service";

export function requireSessionRole(
  service: AuthService,
  role: AuthRole,
  token: string | undefined | null,
) {
  return service.getSession(role, token);
}
