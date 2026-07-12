import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FORGOT_PASSWORD_MESSAGE, INVALID_RESET_TOKEN_MESSAGE } from "./password-reset";
import { PasswordRecoveryForm } from "./password-recovery-form";

describe("PasswordRecoveryForm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("submits a labelled email field and always shows the generic confirmation", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ message: FORGOT_PASSWORD_MESSAGE }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    render(<PasswordRecoveryForm mode="forgot" role="teacher" />);

    const email = screen.getByLabelText(/^邮箱/);
    expect(email).toHaveAttribute("autocomplete", "email");
    await userEvent.type(email, "mai@example.com");
    await userEvent.click(screen.getByRole("button", { name: "发送重置链接" }));

    expect(await screen.findByRole("status")).toHaveTextContent(FORGOT_PASSWORD_MESSAGE);
    expect(fetch).toHaveBeenCalledWith("/api/auth/teacher/forgot-password", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "mai@example.com" }),
    }));
  });

  it("submits the URL token with an accessible new-password field and generic failure", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ error: INVALID_RESET_TOKEN_MESSAGE }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));
    render(<PasswordRecoveryForm mode="reset" role="parent" token="raw-token" />);

    const password = screen.getByLabelText(/^新密码/);
    expect(password).toHaveAttribute("autocomplete", "new-password");
    await userEvent.type(password, "new password long enough");
    await userEvent.click(screen.getByRole("button", { name: "重置密码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(INVALID_RESET_TOKEN_MESSAGE);
    expect(fetch).toHaveBeenCalledWith("/api/auth/parent/reset-password", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: "raw-token", newPassword: "new password long enough" }),
    }));
  });
});
