import { describe, expect, it } from "vitest";

import { createRoleAuthHandlers } from "./route-handler";
import { parsePublicAuthRole, roleDashboardPath } from "./schemas";
import { AuthError, type AuthService } from "./service";

describe("role-scoped authentication routes", () => {
  it("accepts public registration only for teacher and parent path roles", () => {
    expect(parsePublicAuthRole("teacher")).toBe("teacher");
    expect(parsePublicAuthRole("parent")).toBe("parent");
    expect(() => parsePublicAuthRole("admin")).toThrow();
    expect(() => parsePublicAuthRole("anything")).toThrow();
  });

  it("maps every login role to its own dashboard", () => {
    expect(roleDashboardPath.teacher).toBe("/teacher/dashboard");
    expect(roleDashboardPath.parent).toBe("/parent/dashboard");
    expect(roleDashboardPath.admin).toBe("/admin/dashboard");
  });

  it("takes registration role from the URL and ignores a body role", async () => {
    const calls: string[] = [];
    const service = {
      async register(role: string) {
        calls.push(`register:${role}`);
        return { id: "teacher-1", role };
      },
      async login(role: string) {
        calls.push(`login:${role}`);
        return {
          token: "opaque-teacher-token",
          expiresAt: new Date("2030-01-01T00:00:00Z"),
          account: { id: "teacher-1", role },
        };
      },
    } as unknown as AuthService;
    const handlers = createRoleAuthHandlers(service);
    const request = new Request("http://localhost/api/auth/teacher/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "parent",
        username: "teacher-user",
        email: "teacher@example.com",
        password: "long-enough-password",
      }),
    });

    const response = await handlers.register(request, "teacher");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/teacher/dashboard");
    expect(response.headers.get("set-cookie")).toContain("tutor_teacher_session=opaque-teacher-token");
    expect(calls).toEqual(["register:teacher", "login:teacher"]);
  });

  it("does not expose whether the account or password was wrong", async () => {
    const service = {
      async login() {
        throw new AuthError("INVALID_CREDENTIALS", "账号或密码错误");
      },
    } as unknown as AuthService;
    const handlers = createRoleAuthHandlers(service);
    const request = new Request("http://localhost/api/auth/parent/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: "missing", password: "wrong" }),
    });

    const response = await handlers.login(request, "parent");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "账号或密码错误" });
  });

  it("revokes and clears only the URL role cookie on logout", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const service = {
      async getSession() {
        return { id: "teacher-1", role: "teacher" };
      },
      async logout(role: string, token?: string) {
        calls.push([role, token]);
      },
    } as unknown as AuthService;
    const handlers = createRoleAuthHandlers(service);
    const request = new Request("http://localhost/api/auth/teacher/logout", {
      method: "POST",
      headers: { cookie: "tutor_teacher_session=teacher-token; tutor_parent_session=parent-token" },
    });

    const response = await handlers.logout(request, "teacher");

    expect(calls).toEqual([["teacher", "teacher-token"]]);
    expect(response.headers.get("set-cookie")).toContain("tutor_teacher_session=");
    expect(response.headers.get("set-cookie")).not.toContain("tutor_parent_session");
  });

  it.each(["parent", "admin"] as const)(
    "does not let a teacher session execute the %s logout handler",
    async (role) => {
      const revoked: string[] = [];
      const service = {
        async getSession(expectedRole: string, token?: string) {
          if (expectedRole !== "teacher" || token !== "teacher-token") {
            throw new AuthError("UNAUTHORIZED", "登录状态无效或已过期");
          }
          return { id: "teacher-1", role: "teacher" };
        },
        async logout(expectedRole: string) {
          revoked.push(expectedRole);
        },
      } as unknown as AuthService;
      const handlers = createRoleAuthHandlers(service);
      const request = new Request(`http://localhost/api/auth/${role}/logout`, {
        method: "POST",
        headers: { cookie: `tutor_${role}_session=teacher-token` },
      });

      const response = await handlers.logout(request, role);

      expect(revoked).toEqual([]);
      expect(response.status).toBe(303);
      expect(response.headers.get("set-cookie")).toContain(`tutor_${role}_session=`);
    },
  );
});
