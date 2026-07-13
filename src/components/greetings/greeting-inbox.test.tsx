import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("navigates keyset cursors, remembers previous cursors, and resets when switching boxes", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.includes("cursor=next-cursor")) return Response.json({ items: [], pageSize: 20, nextCursor: null });
      return Response.json({ items: [], pageSize: 20, nextCursor: "next-cursor" });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GreetingInbox realm="teacher" />);
    await screen.findByText("还没有收到打招呼");

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/greetings?realm=teacher&box=received&pageSize=20&cursor=next-cursor",
      expect.objectContaining({ cache: "no-store" }),
    ));
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => !String(url).includes("cursor=")).length).toBeGreaterThan(1));

    fireEvent.click(screen.getByRole("tab", { name: "发出的" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/greetings?realm=teacher&box=sent&pageSize=20",
      expect.objectContaining({ cache: "no-store" }),
    ));
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  });

  it("refreshes the current cursor page after a greeting action", async () => {
    let reads = 0;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (_input, init) => {
      if (init?.method === "POST") return Response.json({ greeting: { status: "REJECTED" } });
      reads += 1;
      return Response.json({
        items: reads === 1 ? [{
          id: "00000000-0000-4000-8000-000000000001", direction: "received", status: "PENDING",
          note: "", card: { legacy: true }, createdAt: "2026-07-13T06:00:00.000Z",
        }] : [],
        pageSize: 20, nextCursor: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GreetingInbox realm="parent" />);
    fireEvent.click(await screen.findByRole("button", { name: "婉拒" }));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByText("还没有收到打招呼")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/greetings/00000000-0000-4000-8000-000000000001?realm=parent",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
