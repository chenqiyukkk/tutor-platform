import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AdminActionDialog } from "./admin-action-dialog";

function installDialog() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
}

describe("AdminActionDialog", () => {
  it("moves focus into the native dialog, cancels, and restores the trigger", async () => {
    installDialog();
    render(<AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "user", status: "SUSPENDED" }} title="停用用户" triggerLabel="停用" reasonOptions={["虚假信息", "骚扰"]} />);
    const trigger = screen.getByRole("button", { name: "停用" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "停用用户" })).toHaveAttribute("open");
    expect(screen.getByLabelText("原因分类")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("composes a bounded categorized reason and reuses the request id on retry", async () => {
    installDialog();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: "INTERNAL_ERROR", error: "服务暂时不可用" }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ user: { status: "SUSPENDED", updatedAt: "2026-07-14T04:00:00.000Z" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "user", status: "SUSPENDED" }} title="停用用户" triggerLabel="停用" reasonOptions={["虚假信息", "骚扰", "收费诈骗", "其他"]} />);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.change(screen.getByLabelText("原因分类"), { target: { value: "收费诈骗" } });
    fireEvent.change(screen.getByLabelText("补充说明（可选）"), { target: { value: "诱导站外付款" } });
    fireEvent.click(screen.getByRole("button", { name: "确认停用用户" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[0].reason).toBe("收费诈骗：诱导站外付款");
    expect(bodies[0].clientRequestId).toBe(bodies[1].clientRequestId);
    vi.unstubAllGlobals();
  });

  it("announces 409 conflicts and refreshes without trusting malformed success data", async () => {
    installDialog();
    refresh.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "CONFLICT", error: "冲突" }, { status: 409 })));
    render(<AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "report", decision: "START_REVIEW" }} title="开始审核" triggerLabel="接手" />);
    fireEvent.click(screen.getByRole("button", { name: "接手" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认开始审核" }));
    expect((await screen.findAllByText("数据已被其他管理员更新，正在刷新列表。" )).length).toBeGreaterThan(0);
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects a non-minimal success DTO at runtime", async () => {
    installDialog();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: { status: "SUSPENDED", updatedAt: "2026-07-14T04:00:00.000Z", email: "private@example.test" } })));
    render(<AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "user", status: "SUSPENDED" }} title="停用用户" triggerLabel="停用" reasonOptions={["虚假信息"]} />);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用用户" }));
    expect(await screen.findByText("服务器返回的数据无法确认，请刷新后重试。" )).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    vi.unstubAllGlobals();
  });

  it.each(["2026", "July 14, 2026"])("rejects a non-ISO timestamp in a malicious 2xx response: %s", async (updatedAt) => {
    installDialog();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: { status: "SUSPENDED", updatedAt } })));
    render(<AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "user", status: "SUSPENDED" }} title="停用用户" triggerLabel="停用" reasonOptions={["虚假信息"]} />);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用用户" }));
    expect(await screen.findByText("服务器返回的数据无法确认，请刷新后重试。" )).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("uses a new request id after editing a failed payload", async () => {
    installDialog();
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json({ code: "INTERNAL_ERROR" }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "user", status: "SUSPENDED" }} title="停用用户" triggerLabel="停用" reasonOptions={["虚假信息"]} />);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用用户" }));
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("补充说明（可选）"), { target: { value: "新增事实" } });
    fireEvent.click(screen.getByRole("button", { name: "确认停用用户" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const ids = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).clientRequestId);
    expect(ids[0]).not.toBe(ids[1]);
    vi.unstubAllGlobals();
  });

  it("binds the request id to the complete intent across a prop rerender", async () => {
    installDialog();
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json({ code: "INTERNAL_ERROR" }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const common = { targetId: "20000000-0000-4000-8000-000000000001", action: { kind: "user", status: "SUSPENDED" } as const, title: "停用用户", triggerLabel: "停用", reasonOptions: ["虚假信息"] };
    const view = render(<AdminActionDialog {...common} expectedUpdatedAt="2026-07-14T02:00:00.000Z" />);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用用户" }));
    await screen.findByRole("alert");
    view.rerender(<AdminActionDialog {...common} expectedUpdatedAt="2026-07-14T03:00:00.000Z" />);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用用户" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const requests = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(requests[0].clientRequestId).not.toBe(requests[1].clientRequestId);
    expect(requests[1].expectedUpdatedAt).toBe("2026-07-14T03:00:00.000Z");
    vi.unstubAllGlobals();
  });

  it("resets form state when a rerender changes from suspension to restoration", async () => {
    installDialog();
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json({ code: "INTERNAL_ERROR" }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "user", status: "SUSPENDED" }} title="停用用户" triggerLabel="停用" reasonOptions={["虚假信息", "骚扰"]} />);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.change(screen.getByLabelText("原因分类"), { target: { value: "骚扰" } });
    fireEvent.change(screen.getByLabelText("补充说明（可选）"), { target: { value: "旧备注" } });
    view.rerender(<AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T03:00:00.000Z" action={{ kind: "user", status: "ACTIVE" }} title="恢复用户" triggerLabel="恢复" reasonOptions={["申诉通过", "误停用", "人工复核", "其他"]} />);
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(screen.getByLabelText("原因分类")).toHaveValue("申诉通过");
    expect(screen.getByLabelText("补充说明（可选）")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "确认恢复用户" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).reason).toBe("申诉通过");
    vi.unstubAllGlobals();
  });

  it("prevents ESC cancellation while a request is busy", async () => {
    installDialog();
    let finish!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    render(<AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "report", decision: "START_REVIEW" }} title="开始审核" triggerLabel="接手" />);
    fireEvent.click(screen.getByRole("button", { name: "接手" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "确认开始审核" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "处理中…" })).toBeDisabled());
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(dialog).toHaveAttribute("open");
    finish(Response.json({ report: { status: "REVIEWING", updatedAt: "2026-07-14T04:00:00.000Z", resolutionAction: null } }));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    vi.unstubAllGlobals();
  });

  it("keeps the result announcement and focus when a successful row is removed", async () => {
    installDialog();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: { status: "SUSPENDED", updatedAt: "2026-07-14T04:00:00.000Z" } })));
    function Harness() {
      const [visible, setVisible] = useState(true);
      return <><h2 id="admin-action-result" tabIndex={-1} aria-live="polite" />{visible ? <AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "user", status: "SUSPENDED" }} title="停用用户" triggerLabel="停用" reasonOptions={["虚假信息"]} onSuccess={() => setVisible(false)} /> : null}</>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用用户" }));
    const result = await screen.findByRole("heading", { name: "停用用户已完成" });
    expect(screen.queryByRole("button", { name: "停用" })).not.toBeInTheDocument();
    expect(result).toHaveFocus();
    vi.unstubAllGlobals();
  });

  it.each([
    ["success", 200, { user: { status: "SUSPENDED", updatedAt: "2026-07-14T04:00:00.000Z" } }],
    ["conflict", 409, { code: "CONFLICT", error: "冲突" }],
  ])("closes the modal before focusing the persistent result on %s", async (_case, status, body) => {
    installDialog();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
    render(<><h2 id="admin-action-result" tabIndex={-1} aria-live="polite" /><AdminActionDialog targetId="20000000-0000-4000-8000-000000000001" expectedUpdatedAt="2026-07-14T02:00:00.000Z" action={{ kind: "user", status: "SUSPENDED" }} title="停用用户" triggerLabel="停用" reasonOptions={["虚假信息"]} /></>);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    const dialog = screen.getByRole("dialog");
    const result = document.getElementById("admin-action-result") as HTMLElement;
    const order: string[] = [];
    Object.defineProperty(dialog, "close", { configurable: true, value: () => { order.push("close"); dialog.removeAttribute("open"); dialog.dispatchEvent(new Event("close")); } });
    result.addEventListener("focus", () => order.push("focus"));
    fireEvent.click(screen.getByRole("button", { name: "确认停用用户" }));
    await waitFor(() => expect(result).toHaveFocus());
    expect(order).toEqual(["close", "focus"]);
    vi.unstubAllGlobals();
  });
});
