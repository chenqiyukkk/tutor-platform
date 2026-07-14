import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModerationTable } from "./moderation-table";

describe("ModerationTable", () => {
  const columns = [
    { key: "name", label: "用户名" },
    { key: "status", label: "状态" },
  ] as const;
  const rows = [{ id: "safe-row", name: "青禾", status: "待处理" }];

  it("renders a caption, scoped headers, and equivalent desktop/mobile information", () => {
    render(<ModerationTable caption="用户治理列表" columns={columns} rows={rows} />);
    const table = screen.getByRole("table", { name: "用户治理列表" });
    expect(within(table).getByRole("columnheader", { name: "用户名" })).toHaveAttribute("scope", "col");
    expect(within(table).getByRole("columnheader", { name: "状态" })).toHaveAttribute("scope", "col");
    const mobile = screen.getByRole("list", { name: "用户治理列表（移动版）" });
    expect(within(mobile).getByText("青禾")).toBeInTheDocument();
    expect(within(mobile).getByText("待处理")).toBeInTheDocument();
  });

  it("distinguishes an empty queue from a filter with no results", () => {
    const { rerender } = render(<ModerationTable caption="举报队列" columns={columns} rows={[]} emptyKind="queue" />);
    expect(screen.getByText("当前队列已经清空")).toBeInTheDocument();
    rerender(<ModerationTable caption="举报队列" columns={columns} rows={[]} emptyKind="filter" />);
    expect(screen.getByText("没有符合当前筛选的结果")).toBeInTheDocument();
  });
});
