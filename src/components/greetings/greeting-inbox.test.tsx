import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GreetingInbox } from "./greeting-inbox";

describe("GreetingInbox", () => {
  it("renders loading then empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }), { status: 200 })));
    render(<GreetingInbox realm="teacher" />);
    expect(screen.getByText("正在整理往来卡片…" )).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("还没有收到打招呼" )).toBeInTheDocument());
  });

  it("shows a retry action on load errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "失败" }), { status: 500 })));
    render(<GreetingInbox realm="parent" />);
    await waitFor(() => expect(screen.getByText("暂时无法读取往来卡片" )).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
  });
});
