import { render, screen } from "@testing-library/react";

import { DirectoryContactCta } from "./contact-cta";

describe("DirectoryContactCta", () => {
  it("routes teacher details to parent login and request details to teacher login", () => {
    const { rerender } = render(<DirectoryContactCta kind="teacher" />);
    expect(screen.getByRole("link", { name: "家长登录后联系老师" }))
      .toHaveAttribute("href", "/parent/login");

    rerender(<DirectoryContactCta kind="request" />);
    expect(screen.getByRole("link", { name: "老师登录后回应需求" }))
      .toHaveAttribute("href", "/teacher/login");
  });

  it("does not send an already logged-in matching role back to login", () => {
    render(<DirectoryContactCta isLoggedIn kind="teacher" />);

    expect(screen.queryByRole("link", { name: /登录后/ })).not.toBeInTheDocument();
    expect(screen.getByText("站内打招呼功能即将开放")).toBeInTheDocument();
  });
});
