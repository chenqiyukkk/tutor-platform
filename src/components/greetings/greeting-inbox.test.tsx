import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GreetingInbox } from "./greeting-inbox";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

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

  it("disables actions and ignores a deferred action refresh after the user switches boxes", async () => {
    const actionResponse = deferred<Response>();
    const reads: string[] = [];
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return actionResponse.promise;
      reads.push(url);
      if (url.includes("box=sent")) return Response.json({ items: [], pageSize: 20, nextCursor: null });
      return Response.json({
        items: [{
          id: "00000000-0000-4000-8000-000000000001", direction: "received", status: "PENDING",
          note: "", card: { legacy: true }, createdAt: "2026-07-13T06:00:00.000Z",
        }],
        pageSize: 20,
        nextCursor: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GreetingInbox realm="parent" />);

    fireEvent.click(await screen.findByRole("button", { name: "婉拒" }));
    expect(screen.getByRole("button", { name: "接受" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "婉拒" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "发出的" }));
    await screen.findByText("还没有发出打招呼");

    actionResponse.resolve(Response.json({ greeting: { status: "REJECTED" } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("还没有发出打招呼")).toBeInTheDocument();
    expect(reads.filter((url) => url.includes("box=received"))).toHaveLength(1);
  });

  it("collects report reasons in an accessible dialog instead of a browser prompt", async () => {
    const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: close });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (_input, init) => {
      if (init?.method === "POST") return Response.json({ greeting: { status: "REPORTED" } });
      return Response.json({
        items: [{
          id: "00000000-0000-4000-8000-000000000001", direction: "received", status: "PENDING",
          note: "", card: { legacy: true }, createdAt: "2026-07-13T06:00:00.000Z",
        }],
        pageSize: 20,
        nextCursor: null,
      });
    });
    try {
      vi.stubGlobal("fetch", fetchMock);
      render(<GreetingInbox realm="parent" />);

      const trigger = await screen.findByRole("button", { name: "举报" });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "请说明举报原因" });
      expect(showModal).toHaveBeenCalledOnce();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      fireEvent.change(screen.getByLabelText("举报原因"), { target: { value: "疑似不当信息" } });
      fireEvent.click(screen.getByRole("button", { name: "确认举报" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        "/api/greetings/00000000-0000-4000-8000-000000000001?realm=parent",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "report", reason: "疑似不当信息" }),
        }),
      ));

      fireEvent.click(trigger);
      const reopened = screen.getByRole("dialog", { name: "请说明举报原因" });
      fireEvent(reopened, new Event("cancel", { cancelable: true }));
      expect(close).toHaveBeenCalled();
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(screen.queryByRole("dialog", { name: "请说明举报原因" })).not.toBeInTheDocument();
    } finally {
      if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
      else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
      if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
      else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
    }
  });
});
