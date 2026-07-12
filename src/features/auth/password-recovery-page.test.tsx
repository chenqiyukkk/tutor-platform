import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthPage } from "./auth-page";
import { PasswordRecoveryPage } from "./password-recovery-page";

describe("password recovery pages", () => {
  it.each(["teacher", "parent", "admin"] as const)(
    "keeps an independent forgot-password entry for %s",
    (role) => {
      render(<AuthPage mode="login" role={role} />);
      expect(screen.getByRole("link", { name: "忘记密码？" })).toHaveAttribute(
        "href",
        `/${role}/forgot-password`,
      );
    },
  );

  it("renders role-scoped forgot and reset pages", () => {
    const { rerender } = render(<PasswordRecoveryPage mode="forgot" role="admin" />);
    expect(screen.getByRole("heading", { name: "找回管理员账户" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回登录" })).toHaveAttribute("href", "/admin/login");

    rerender(<PasswordRecoveryPage mode="reset" role="teacher" />);
    expect(screen.getByRole("heading", { name: "设置新密码" })).toBeInTheDocument();
  });
});
