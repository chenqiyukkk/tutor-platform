import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GreetingComposer } from "./greeting-composer";

describe("GreetingComposer", () => {
  it("keeps identity/card fields locked and only submits request choice plus note", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ greeting: { id: "g1" } }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<GreetingComposer realm="parent" targetId="teacher-id" requestOptions={[{ id: "request-id", label: "初二数学需求" }]} />);
    expect(screen.queryByLabelText(/发送方/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/接收方/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("补充说明（选填）"), { target: { value: "希望交流时间" } });
    fireEvent.click(screen.getByRole("button", { name: "发送打招呼" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ targetId: "teacher-id", requestId: "request-id", note: "希望交流时间" });
    expect(screen.getByText("打招呼已发送，请等待对方回应。" )).toBeInTheDocument();
  });

  it("shows an actionable empty state when a parent has no published request", () => {
    render(<GreetingComposer realm="parent" targetId="teacher-id" requestOptions={[]} />);
    expect(screen.getByText("先发布一条有效需求" )).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去发布需求" })).toHaveAttribute("href", "/parent/requests/new");
  });
});
