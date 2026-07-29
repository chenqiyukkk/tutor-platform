import { render, screen } from "@testing-library/react";

import { FormField } from "./form-field";

describe("FormField", () => {
  it("injects required and complete error relationships into the form control", () => {
    render(
      <FormField
        error="请输入有效邮箱"
        hint="我们只用它联系你"
        htmlFor="email"
        label="邮箱"
        required
      >
        <input name="email" type="email" />
      </FormField>,
    );

    const input = screen.getByRole("textbox", { name: /邮箱/ });
    const hint = screen.getByText("我们只用它联系你");
    const error = screen.getByRole("alert");

    expect(input).toHaveAttribute("id", "email");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-errormessage", "email-error");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "email-hint email-error",
    );
    expect(hint).toHaveAttribute("id", "email-hint");
    expect(error).toHaveAttribute("id", "email-error");
  });

  it("preserves existing descriptions while linking a hint without an error", () => {
    render(
      <>
        <p id="format-help">最多 200 字</p>
        <FormField hint="介绍擅长的科目" htmlFor="bio" label="个人介绍">
          <textarea aria-describedby="format-help" name="bio" />
        </FormField>
      </>,
    );

    const textarea = screen.getByRole("textbox", { name: "个人介绍" });

    expect(textarea).toHaveAttribute(
      "aria-describedby",
      "format-help bio-hint",
    );
    expect(textarea).not.toHaveAttribute("aria-invalid");
    expect(textarea).not.toHaveAttribute("aria-errormessage");
    expect(textarea).not.toBeRequired();
  });

  it("reflects a child's required state in the label and form control", () => {
    render(
      <FormField htmlFor="email" label="邮箱">
        <input name="email" required type="email" />
      </FormField>,
    );

    const input = screen.getByRole("textbox", { name: /邮箱/ });
    const label = screen.getByText("邮箱", { exact: false, selector: "label" });

    expect(label).toHaveTextContent("邮箱 *（必填）");
    expect(input).toBeRequired();
  });
});
