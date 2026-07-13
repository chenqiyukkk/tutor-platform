import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatWorkspace } from "./chat-workspace";

const conversationA = {
  id: "00000000-0000-4000-8000-000000000001",
  counterpart: { role: "parent" as const, displayName: "陈家长" },
  request: { id: "10000000-0000-4000-8000-000000000001", title: "初二数学巩固" },
  activityAt: "2026-07-13T12:00:00.000Z",
  lastMessageAt: "2026-07-13T12:00:00.000Z",
  unreadCount: 2,
};
const conversationB = {
  id: "00000000-0000-4000-8000-000000000002",
  counterpart: { role: "parent" as const, displayName: "李家长" },
  request: { id: "10000000-0000-4000-8000-000000000002", title: "高一物理答疑" },
  activityAt: "2026-07-13T11:00:00.000Z",
  lastMessageAt: null,
  unreadCount: 0,
};
const watermark = "watermark-a";

function conversationsResponse(
  items = [conversationA, conversationB],
  nextCursor: string | null = null,
) {
  return Response.json({ items, limit: 100, nextCursor });
}

function numberedConversation(index: number) {
  return {
    ...conversationA,
    id: `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    counterpart: { role: "parent" as const, displayName: `第${index}位家长` },
    request: {
      id: `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: `第${index}项辅导需求`,
    },
    unreadCount: 0,
  };
}

function messagesResponse(
  items: Array<Record<string, unknown>> = [],
  options: { after?: string; before?: string | null; hasMore?: boolean } = {},
) {
  return Response.json({
    items,
    limit: 50,
    nextBeforeCursor: options.before ?? null,
    nextAfterCursor: options.after ?? watermark,
    hasMore: options.hasMore ?? false,
  });
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    clientMessageId: "30000000-0000-4000-8000-000000000001",
    body: "请先看看这道题",
    sentAt: "2026-07-13T12:00:00.000Z",
    readAt: null,
    mine: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ChatWorkspace", () => {
  it("renders an accessible two-pane workspace and supports the mobile list/back flow", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/conversations?")) return conversationsResponse();
      if (url.endsWith("/read?realm=teacher") && init?.method === "POST") {
        return Response.json({ readCount: 1, readAt: "2026-07-13T12:01:00.000Z" });
      }
      if (url.includes(`/${conversationA.id}/messages?`)) {
        return messagesResponse([message()], { before: "older-a" });
      }
      return messagesResponse([], { after: "watermark-b" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatWorkspace realm="teacher" />);

    expect(await screen.findByRole("heading", { name: "站内消息" })).toBeInTheDocument();
    const list = screen.getByRole("navigation", { name: "会话列表" });
    expect(within(list).getByRole("button", { name: /陈家长.*2 条未读消息/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("region", { name: "与陈家长的消息" })).toBeInTheDocument();
    expect(await screen.findByText("请先看看这道题")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加载更早消息" })).toBeInTheDocument();
    expect(screen.getByLabelText("消息内容")).toHaveAttribute("aria-describedby", "message-character-count");
    expect(screen.getByText("还可输入 1000 个字符")).toBeInTheDocument();
    expect(screen.getByTestId("chat-workspace")).toHaveAttribute("data-mobile-view", "thread");

    fireEvent.click(screen.getByRole("button", { name: "返回会话列表" }));
    expect(screen.getByTestId("chat-workspace")).toHaveAttribute("data-mobile-view", "list");
    fireEvent.click(within(list).getByRole("button", { name: /李家长/ }));
    await screen.findByRole("region", { name: "与李家长的消息" });
    expect(screen.getByTestId("chat-workspace")).toHaveAttribute("data-mobile-view", "thread");
  });

  it("aborts a superseded history request and ignores its stale response", async () => {
    const firstHistory = deferred<Response>();
    let firstSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/conversations?")) return conversationsResponse();
      if (url.includes(`/${conversationA.id}/messages?`)) {
        firstSignal = init?.signal ?? undefined;
        return firstHistory.promise;
      }
      if (url.includes(`/${conversationB.id}/messages?`)) {
        return messagesResponse([message({ id: "20000000-0000-4000-8000-000000000002", body: "物理会话消息" })], { after: "watermark-b" });
      }
      return Response.json({ readCount: 0, readAt: "2026-07-13T12:01:00.000Z" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatWorkspace realm="teacher" />);
    const list = await screen.findByRole("navigation", { name: "会话列表" });
    await waitFor(() => expect(firstSignal).toBeDefined());
    fireEvent.click(within(list).getByRole("button", { name: /李家长/ }));
    expect(firstSignal?.aborted).toBe(true);
    expect(await screen.findByText("物理会话消息")).toBeInTheDocument();

    firstHistory.resolve(messagesResponse([message({ body: "过期的数学消息" })]));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("过期的数学消息")).not.toBeInTheDocument();
  });

  it("loads and de-duplicates conversation cursor pages so the 101st conversation is reachable", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => numberedConversation(index + 1));
    const finalConversation = numberedConversation(101);
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.includes("/api/conversations?realm=teacher&limit=100&cursor=page-2")) {
        return conversationsResponse([firstPage[99], finalConversation, finalConversation]);
      }
      if (url.startsWith("/api/conversations?")) return conversationsResponse(firstPage, "page-2");
      if (url.includes("/messages?")) return messagesResponse([]);
      return Response.json({ readCount: 0, readAt: "2026-07-13T12:01:00.000Z" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatWorkspace realm="teacher" />);
    const loadMore = await screen.findByRole("button", { name: "加载更多会话" });
    expect(screen.queryByRole("button", { name: /第101位家长/ })).not.toBeInTheDocument();
    fireEvent.click(loadMore);

    expect(await screen.findByRole("button", { name: /第101位家长/ })).toBeInTheDocument();
    expect(screen.getByText("101 封已建立的往来")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加载更多会话" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations?realm=teacher&limit=100&cursor=page-2",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it("aborts and ignores a stale conversation page when the realm changes", async () => {
    const stalePage = deferred<Response>();
    const staleConversation = numberedConversation(102);
    let pageSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      if (url.includes("cursor=teacher-next")) {
        pageSignal = init?.signal ?? undefined;
        return stalePage.promise;
      }
      if (url === "/api/conversations?realm=teacher&limit=100") {
        return conversationsResponse([conversationA], "teacher-next");
      }
      if (url === "/api/conversations?realm=parent&limit=100") {
        return conversationsResponse([conversationB]);
      }
      if (url.includes("/messages?")) return messagesResponse([]);
      return Response.json({ readCount: 0, readAt: "2026-07-13T12:01:00.000Z" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<ChatWorkspace realm="teacher" />);
    fireEvent.click(await screen.findByRole("button", { name: "加载更多会话" }));
    await waitFor(() => expect(pageSignal).toBeDefined());
    view.rerender(<ChatWorkspace realm="parent" />);

    expect(pageSignal?.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: /李家长/ })).toBeInTheDocument();
    stalePage.resolve(conversationsResponse([staleConversation]));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: /第102位家长/ })).not.toBeInTheDocument();
  });

  it("polls only while visible, pulls immediately on resume, and starts retries after 2 seconds", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const pollResults: Array<Response | Error> = [
      new TypeError("offline"),
      new TypeError("still offline"),
      messagesResponse([message({ id: "20000000-0000-4000-8000-000000000009", body: "恢复后的新消息" })], { after: "watermark-new" }),
    ];
    let pollingCalls = 0;
    let pollingSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/conversations?")) return conversationsResponse();
      if (url.endsWith("/read?realm=teacher")) return Response.json({ readCount: 1, readAt: "2026-07-13T12:01:00.000Z" });
      if (url.includes("after=watermark")) {
        pollingCalls += 1;
        pollingSignal = init?.signal ?? undefined;
        const result = pollResults.shift() ?? messagesResponse([], { after: "watermark-new" });
        if (result instanceof Error) throw result;
        return result;
      }
      return messagesResponse([], { after: watermark });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatWorkspace realm="teacher" />);
    await act(async () => {
      for (let pass = 0; pass < 6; pass += 1) await Promise.resolve();
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(pollingCalls).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(pollingCalls).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(pollingCalls).toBe(2);

    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(pollingSignal?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(pollingCalls).toBe(2);

    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      for (let pass = 0; pass < 4; pass += 1) await Promise.resolve();
    });
    expect(pollingCalls).toBe(3);
    expect(screen.getByText("恢复后的新消息")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(pollingCalls).toBe(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("after=watermark-new"))).toBe(true);
  });

  it("backs failed polls off by 2/4/8/16/30 seconds, caps at 30, and resets after success", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const pollResults: Array<Response | Error> = [
      ...Array.from({ length: 6 }, (_, index) => new TypeError(`offline-${index + 1}`)),
      messagesResponse([message({
        id: "20000000-0000-4000-8000-000000000010",
        body: "退避恢复消息",
      })], { after: "watermark-reset" }),
    ];
    let pollingCalls = 0;
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/conversations?")) return conversationsResponse();
      if (url.includes("after=watermark")) {
        pollingCalls += 1;
        const result = pollResults.shift() ?? messagesResponse([], { after: "watermark-reset" });
        if (result instanceof Error) throw result;
        return result;
      }
      if (url.includes("/messages?")) return messagesResponse([], { after: watermark });
      return Response.json({ readCount: 0, readAt: "2026-07-13T12:01:00.000Z" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatWorkspace realm="teacher" />);
    await act(async () => {
      for (let pass = 0; pass < 6; pass += 1) await Promise.resolve();
    });

    const intervals = [2_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const [index, interval] of intervals.entries()) {
      await act(async () => { await vi.advanceTimersByTimeAsync(interval - 1); });
      expect(pollingCalls).toBe(index);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(pollingCalls).toBe(index + 1);
    }
    expect(screen.getByText("退避恢复消息")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(pollingCalls).toBe(7);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("after=watermark-reset"))).toBe(true);
  });

  it("reconciles optimistic messages by clientMessageId without duplicates", async () => {
    const post = deferred<Response>();
    let sentPayload: { clientMessageId: string; body: string } | undefined;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/conversations?")) return conversationsResponse();
      if (init?.method === "POST" && url.includes("/messages?")) {
        sentPayload = JSON.parse(String(init.body));
        return post.promise;
      }
      if (url.includes("/messages?")) return messagesResponse([]);
      return Response.json({ readCount: 0, readAt: "2026-07-13T12:01:00.000Z" });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("40000000-0000-4000-8000-000000000001");

    render(<ChatWorkspace realm="teacher" />);
    const input = await screen.findByLabelText("消息内容");
    fireEvent.change(input, { target: { value: "  我来讲解  " } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByText("我来讲解")).toBeInTheDocument();
    expect(screen.getByText("发送中…")).toBeInTheDocument();
    expect(sentPayload).toEqual({ clientMessageId: "40000000-0000-4000-8000-000000000001", body: "我来讲解" });
    post.resolve(Response.json({ message: message({
      id: "50000000-0000-4000-8000-000000000001",
      clientMessageId: sentPayload!.clientMessageId,
      body: sentPayload!.body,
      mine: true,
    }) }, { status: 201 }));

    await waitFor(() => expect(screen.queryByText("发送中…")).not.toBeInTheDocument());
    expect(screen.getAllByText("我来讲解")).toHaveLength(1);
  });

  it("marks a failed optimistic message and retries with the exact same id and body", async () => {
    const sentBodies: string[] = [];
    let attempt = 0;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/conversations?")) return conversationsResponse();
      if (init?.method === "POST" && url.includes("/messages?")) {
        sentBodies.push(String(init.body));
        attempt += 1;
        if (attempt === 1) throw new TypeError("offline");
        const payload = JSON.parse(String(init.body));
        return Response.json({ message: message({ id: "50000000-0000-4000-8000-000000000002", ...payload, mine: true }) }, { status: 201 });
      }
      if (url.includes("/messages?")) return messagesResponse([]);
      return Response.json({ readCount: 0, readAt: "2026-07-13T12:01:00.000Z" });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("40000000-0000-4000-8000-000000000002");

    render(<ChatWorkspace realm="parent" />);
    fireEvent.change(await screen.findByLabelText("消息内容"), { target: { value: "请继续" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    fireEvent.click(await screen.findByRole("button", { name: "重试发送“请继续”" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "重试发送“请继续”" })).not.toBeInTheDocument());
    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[1]).toBe(sentBodies[0]);
    expect(screen.getAllByText("请继续")).toHaveLength(1);
  });
});
