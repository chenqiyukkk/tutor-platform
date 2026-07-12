import { describe, expect, it } from "vitest";

import { getSessionCookie, sessionCookieNames } from "./session";

describe("role session cookies", () => {
  it("uses a distinct cookie name for every role", () => {
    expect(new Set(Object.values(sessionCookieNames)).size).toBe(3);
    expect(sessionCookieNames).toEqual({
      teacher: "tutor_teacher_session",
      parent: "tutor_parent_session",
      admin: "tutor_admin_session",
    });
  });

  it("uses secure server-only cookie options", () => {
    expect(getSessionCookie("teacher", false)).toEqual({
      name: "tutor_teacher_session",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    });
    expect(getSessionCookie("teacher", true).options.secure).toBe(true);
  });
});
