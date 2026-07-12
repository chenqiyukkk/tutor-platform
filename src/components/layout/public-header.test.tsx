import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import HomePage from "@/app/(public)/page";
import { PublicHeader } from "./public-header";

describe("PublicHeader", () => {
  it("provides public landmarks and a single page-level heading on the real home page", () => {
    render(
      <>
        <PublicHeader />
        <HomePage />
      </>,
    );

    const banner = screen.getByRole("banner");

    expect(
      screen.getByRole("navigation", { name: "公共导航" }),
    ).toBeInTheDocument();
    expect(within(banner).getByRole("link", { name: "我是老师" })).toHaveAttribute(
      "href",
      "/teacher/login",
    );
    expect(within(banner).getByRole("link", { name: "我是家长" })).toHaveAttribute(
      "href",
      "/parent/login",
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("places the visible-on-focus skip link first in the keyboard tab order", async () => {
    const user = userEvent.setup();

    render(
      <>
        <PublicHeader />
        <HomePage />
      </>,
    );

    const skipLink = screen.getByRole("link", { name: "跳到主要内容" });

    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(skipLink).toHaveClass("skip-link");

    await user.tab();

    expect(skipLink).toHaveFocus();
  });
});
