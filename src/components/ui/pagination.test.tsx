import { render, screen, within } from "@testing-library/react";

import { Pagination } from "./pagination";

describe("Pagination", () => {
  it("renders first, last, current, adjacent pages and ellipses", () => {
    render(<Pagination currentPage={5} totalPages={10} />);

    const navigation = screen.getByRole("navigation", { name: "分页" });
    const currentPage = within(navigation).getByRole("link", {
      name: "第 5 页",
    });

    expect(currentPage).toHaveAttribute("aria-current", "page");
    for (const page of [1, 4, 5, 6, 10]) {
      expect(
        within(navigation).getByRole("link", { name: `第 ${page} 页` }),
      ).toBeInTheDocument();
    }
    expect(
      within(navigation).queryByRole("link", { name: "第 2 页" }),
    ).not.toBeInTheDocument();
    expect(within(navigation).getAllByText("…")).toHaveLength(2);
  });

  it("keeps the number of rendered page links constant for a large total", () => {
    render(<Pagination currentPage={500} totalPages={1000} />);

    const navigation = screen.getByRole("navigation", { name: "分页" });
    const pageLinks = within(navigation).getAllByRole("link", {
      name: /^第 \d+ 页$/,
    });

    expect(pageLinks).toHaveLength(5);
  });

  it.each([
    {
      currentPage: 0,
      disabledControl: "上一页",
      enabledControl: "下一页",
      enabledHref: "?page=2",
      expectedPage: 1,
    },
    {
      currentPage: 11,
      disabledControl: "下一页",
      enabledControl: "上一页",
      enabledHref: "?page=9",
      expectedPage: 10,
    },
  ])(
    "clamps currentPage=$currentPage to page $expectedPage",
    ({
      currentPage,
      disabledControl,
      enabledControl,
      enabledHref,
      expectedPage,
    }) => {
      render(<Pagination currentPage={currentPage} totalPages={10} />);

      expect(
        screen.getByRole("link", { name: `第 ${expectedPage} 页` }),
      ).toHaveAttribute("aria-current", "page");
      expect(screen.getByText(disabledControl)).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getByRole("link", { name: enabledControl })).toHaveAttribute(
        "href",
        enabledHref,
      );
    },
  );
});
