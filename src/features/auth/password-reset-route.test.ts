import { describe, expect, it } from "vitest";

import {
  FORGOT_PASSWORD_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
  PasswordResetError,
  type PasswordResetService,
} from "./password-reset";
import { createPasswordResetHandlers } from "./password-reset-route";

describe("role-scoped password reset routes", () => {
  it("takes the forgot-password role from the URL and returns only the generic response", async () => {
    const calls: unknown[][] = [];
    const service = {
      async requestReset(...args: unknown[]) {
        calls.push(args);
        return { message: FORGOT_PASSWORD_MESSAGE };
      },
    } as unknown as PasswordResetService;
    const handlers = createPasswordResetHandlers(service);
    const response = await handlers.forgotPassword(new Request(
      "https://tutor.example.test/api/auth/teacher/forgot-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "parent", email: "Mai@Example.COM" }),
      },
    ), "teacher");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ message: FORGOT_PASSWORD_MESSAGE });
    expect(calls).toEqual([["teacher", { email: "Mai@Example.COM" }]]);
  });

  it("redirects a successful reset to the URL role login without creating a session", async () => {
    const calls: unknown[][] = [];
    const service = {
      async resetPassword(...args: unknown[]) {
        calls.push(args);
        return { success: true };
      },
    } as PasswordResetService;
    const handlers = createPasswordResetHandlers(service);
    const response = await handlers.resetPassword(new Request(
      "https://tutor.example.test/api/auth/admin/reset-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "teacher",
          token: "raw-reset-token",
          newPassword: "new password long enough",
        }),
      },
    ), "admin");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://tutor.example.test/admin/login");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(calls).toEqual([["admin", {
      token: "raw-reset-token",
      newPassword: "new password long enough",
    }]]);
  });

  it("uses one generic invalid message for every rejected reset", async () => {
    const service = {
      async resetPassword() {
        throw new PasswordResetError();
      },
    } as unknown as PasswordResetService;
    const handlers = createPasswordResetHandlers(service);
    const response = await handlers.resetPassword(new Request(
      "https://tutor.example.test/api/auth/parent/reset-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "unknown", newPassword: "new password long enough" }),
      },
    ), "parent");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: INVALID_RESET_TOKEN_MESSAGE });
  });

  it.each(["forgotPassword", "resetPassword"] as const)(
    "returns 404 for an unsupported %s role path",
    async (method) => {
      const handlers = createPasswordResetHandlers({} as PasswordResetService);
      const response = await handlers[method](new Request(
        `https://tutor.example.test/api/auth/unknown/${method}`,
        { method: "POST", body: "{}" },
      ), "unknown");
      expect(response.status).toBe(404);
    },
  );
});
