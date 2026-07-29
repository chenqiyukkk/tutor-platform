import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthForm } from "./auth-form";

describe("AuthForm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("provides labelled login fields with correct autocomplete", () => {
    render(<AuthForm mode="login" role="teacher" />);

    expect(screen.getByLabelText(/用户名或邮箱/)).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText(/密码/)).toHaveAttribute("autocomplete", "current-password");
  });

  it("provides labelled registration fields with correct autocomplete", () => {
    render(<AuthForm mode="register" role="parent" />);

    expect(screen.getByLabelText(/用户名/)).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText(/邮箱/)).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText(/密码/)).toHaveAttribute("autocomplete", "new-password");
  });

  it("shows the generic API error without losing the form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "账号或密码错误" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<AuthForm mode="login" role="admin" />);
    await userEvent.type(screen.getByLabelText(/用户名或邮箱/), "missing-admin");
    await userEvent.type(screen.getByLabelText(/密码/), "wrong-password");

    await userEvent.click(screen.getByRole("button", { name: "登录管理员账户" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("账号或密码错误");
    expect(screen.getByLabelText(/用户名或邮箱/)).toHaveValue("missing-admin");
  });
});
