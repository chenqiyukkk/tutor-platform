import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GreetingComposer } from "./greeting-composer";

describe("GreetingComposer", () => {
  it("keeps identity/card fields locked and only submits request choice plus note", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (_input, init) => {
      if (!init?.method) return Response.json({ favorite: false });
      return Response.json({ greeting: { id: "g1" } }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GreetingComposer realm="parent" targetId="teacher-id" requestOptions={[{ id: "request-id", label: "初二数学需求" }]} />);
    expect(screen.queryByLabelText(/发送方/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/接收方/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("补充说明（选填）"), { target: { value: "希望交流时间" } });
    fireEvent.click(screen.getByRole("button", { name: "发送打招呼" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(init?.body))).toEqual({ targetId: "teacher-id", requestId: "request-id", note: "希望交流时间" });
    expect(screen.getByText("打招呼已发送，请等待对方回应。" )).toBeInTheDocument();
  });

  it("keeps favorite independent when a parent has no published request", async () => {
    const fetchMock = vi.fn(async () => Response.json({ favorite: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<GreetingComposer realm="parent" targetId="teacher-id" requestOptions={[]} />);
    expect(screen.getByText("先发布一条有效需求" )).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去发布需求" })).toHaveAttribute("href", "/parent/requests/new");
    expect(await screen.findByRole("button", { name: "取消收藏" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/favorites?realm=parent&targetType=teacher&targetId=teacher-id",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("loads the current target-specific favorite, toggles it, and surfaces failures", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (_input, init) => {
      if (!init?.method) return Response.json({ favorite: true });
      return Response.json({ error: "收藏状态没有更新" }, { status: 409 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GreetingComposer realm="teacher" targetId="00000000-0000-4000-8000-000000000002" requestId="00000000-0000-4000-8000-000000000002" />);

    fireEvent.click(await screen.findByRole("button", { name: "取消收藏" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("收藏状态没有更新"));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
    expect(screen.getByRole("button", { name: "取消收藏" })).toBeInTheDocument();
  });

  it("recovers from a network failure while sending a greeting", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (_input, init) => {
      if (!init?.method) return Response.json({ favorite: false });
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GreetingComposer realm="teacher" targetId="00000000-0000-4000-8000-000000000002" requestId="00000000-0000-4000-8000-000000000002" />);

    fireEvent.click(screen.getByRole("button", { name: "发送打招呼" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("网络连接异常"));
    expect(screen.getByRole("button", { name: "发送打招呼" })).toBeEnabled();
  });

  it("always releases favorite busy state after a network failure", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (_input, init) => {
      if (!init?.method) return Response.json({ favorite: false });
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GreetingComposer realm="teacher" targetId="00000000-0000-4000-8000-000000000002" requestId="00000000-0000-4000-8000-000000000002" />);

    fireEvent.click(await screen.findByRole("button", { name: "收藏这条资料" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("网络连接异常"));
    expect(screen.getByRole("button", { name: "收藏这条资料" })).toBeEnabled();
  });
});
