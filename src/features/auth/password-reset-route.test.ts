import { describe, expect, it, vi } from "vitest";

import {
  FORGOT_PASSWORD_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
  PasswordResetError,
  type PasswordResetService,
} from "./password-reset";
import { createPasswordResetHandlers } from "./password-reset-route";

describe("role-scoped password reset routes", () => {
  it("returns the generic response before deferred password-reset work completes", async () => {
    let finishRequest!: () => void;
    const deferred = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    const requestReset = vi.fn(() => deferred.then(() => ({ message: FORGOT_PASSWORD_MESSAGE })));
    const service = {
      requestReset,
    } as unknown as PasswordResetService;
    const tasks: Array<() => Promise<void>> = [];
    const handlers = createPasswordResetHandlers(() => service, {
      schedule: (task) => tasks.push(task),
    });
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
    expect(requestReset).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);

    let completed = false;
    const completion = tasks[0]().then(() => { completed = true; });
    await Promise.resolve();
    expect(requestReset).toHaveBeenCalledWith("teacher", { email: "Mai@Example.COM" });
    expect(completed).toBe(false);
    finishRequest();
    await completion;
  });

  it("schedules the same callback path for known and unknown email inputs", async () => {
    const requestReset = vi.fn().mockResolvedValue({ message: FORGOT_PASSWORD_MESSAGE });
    const service = { requestReset } as unknown as PasswordResetService;
    const tasks: Array<() => Promise<void>> = [];
    const handlers = createPasswordResetHandlers(() => service, {
      schedule: (task) => tasks.push(task),
    });

    const responses = await Promise.all(["known@example.test", "unknown@example.test"].map(
      (email) => handlers.forgotPassword(new Request(
        "https://tutor.example.test/api/auth/parent/forgot-password",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        },
      ), "parent"),
    ));

    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { message: FORGOT_PASSWORD_MESSAGE },
      { message: FORGOT_PASSWORD_MESSAGE },
    ]);
    expect(tasks).toHaveLength(2);
    expect(requestReset).not.toHaveBeenCalled();
    await Promise.all(tasks.map((task) => task()));
    expect(requestReset.mock.calls).toEqual([
      ["parent", { email: "known@example.test" }],
      ["parent", { email: "unknown@example.test" }],
    ]);
  });

  it("contains lazy runtime failures and logs no SMTP details", async () => {
    const logger = { error: vi.fn() };
    const tasks: Array<() => Promise<void>> = [];
    const handlers = createPasswordResetHandlers(() => {
      throw new Error("SMTP_PASS=sensitive-password smtp.internal.example.test");
    }, {
      logger,
      schedule: (task) => tasks.push(task),
    });

    const response = await handlers.forgotPassword(new Request(
      "https://tutor.example.test/api/auth/admin/forgot-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.test" }),
      },
    ), "admin");

    expect(response.status).toBe(200);
    await expect(tasks[0]()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith("Password reset background request failed");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sensitive-password");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("smtp.internal.example.test");
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

  it("rejects oversized password-reset bodies", async () => {
    const handlers = createPasswordResetHandlers({} as PasswordResetService);
    const response = await handlers.resetPassword(new Request(
      "https://tutor.example.test/api/auth/parent/reset-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "x".repeat(17_000), newPassword: "new password long enough" }),
      },
    ), "parent");

    expect(response.status).toBe(413);
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
