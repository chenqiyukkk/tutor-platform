import { render, screen } from "@testing-library/react";

import { PublicHeader } from "./public-header";

describe("PublicHeader", () => {
  it("provides keyboard-friendly public navigation landmarks and role calls to action", () => {
    render(
      <>
        <PublicHeader />
        <main id="main-content">
          <h1>找到合适的老师，也找到真正需要你的学生</h1>
        </main>
      </>,
    );

    expect(screen.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "公共导航" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "我是老师" })).toHaveAttribute(
      "href",
      "/teacher",
    );
    expect(screen.getByRole("link", { name: "我是家长" })).toHaveAttribute(
      "href",
      "/parent",
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
