import { render, screen } from "@testing-library/react";

import HomePage from "./page";

describe("HomePage", () => {
  it("shows the platform promise and role entry links", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: "找到合适的老师，也找到真正需要你的学生",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "我是老师" })).toHaveAttribute(
      "href",
      "/teacher",
    );
    expect(screen.getByRole("link", { name: "我是家长" })).toHaveAttribute(
      "href",
      "/parent",
    );
  });
});
