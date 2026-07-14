import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SafetyActionDialog } from "./safety-action-dialog";

const target = { kind: "teacher_profile" as const, profileId: "11111111-1111-4111-8111-111111111111" };

function installDialog() {
  const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
  return () => {
    if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SafetyActionDialog", () => {
  it("keeps the chat report trigger at least 44px tall", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.chat-message:not\([^)]*\) \.safety-actions__triggers \.text-button\s*\{[^}]*min-height:\s*44px/u);
  });

  it("keeps report and block independent and sends only the public locator", async () => {
    const restore = installDialog();
    const requestId = "22222222-2222-4222-8222-222222222222";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return String(input).startsWith("/api/reports")
        ? Response.json({ reportId: "safe-report", status: "PENDING" }, { status: 201 })
        : Response.json({ blocked: true });
    }));
    try {
      const view = render(<SafetyActionDialog realm="parent" target={target} />);
      fireEvent.click(screen.getByRole("button", { name: "举报此内容" }));
      let dialog = screen.getByRole("dialog", { name: "举报此内容" });
      fireEvent.change(within(dialog).getByLabelText("举报原因"), { target: { value: "疑似虚假资料" } });
      fireEvent.change(within(dialog).getByLabelText("补充说明（选填）"), { target: { value: "公开描述前后矛盾" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "确认举报" }));
      expect(await screen.findByRole("status")).toHaveTextContent("举报已提交");

      fireEvent.click(screen.getByRole("button", { name: "屏蔽对方" }));
      dialog = screen.getByRole("dialog", { name: "屏蔽对方" });
      fireEvent.change(within(dialog).getByLabelText("屏蔽原因"), { target: { value: "不希望继续联系" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "确认屏蔽" }));
      await waitFor(() => expect(calls).toHaveLength(2));

      expect(calls).toEqual([
        { url: "/api/reports?realm=parent", body: { target, clientRequestId: requestId, reason: "疑似虚假资料", details: "公开描述前后矛盾" } },
        { url: "/api/blocks?realm=parent", body: { target, reason: "不希望继续联系" } },
      ]);
      expect(view.container.innerHTML).not.toMatch(/accountId|private-file|sha256/i);
    } finally { restore(); }
  });

  it("uses a native dialog and restores trigger focus after cancel or Escape", async () => {
    const restore = installDialog();
    try {
      render(<SafetyActionDialog actions={["report"]} realm="teacher" target={{ kind: "message", messageId: "33333333-3333-4333-8333-333333333333" }} />);
      const trigger = screen.getByRole("button", { name: "举报此内容" });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "举报此内容" }) as HTMLDialogElement;
      expect(dialog.tagName).toBe("DIALOG");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(within(dialog).getByLabelText("举报原因")).toHaveFocus();
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally { restore(); }
  });

  it("disables a busy submission and retries a report with the same client request id", async () => {
    const restore = installDialog();
    const requestId = "44444444-4444-4444-8444-444444444444";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
    const bodies: unknown[] = [];
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      attempt += 1;
      return attempt === 1
        ? Response.json({ error: "服务暂时不可用" }, { status: 503 })
        : Response.json({ reportId: "safe-report", status: "PENDING" }, { status: 201 });
    }));
    try {
      render(<SafetyActionDialog actions={["report"]} realm="teacher" target={{ kind: "greeting", greetingId: "55555555-5555-4555-8555-555555555555" }} />);
      fireEvent.click(screen.getByRole("button", { name: "举报此内容" }));
      const dialog = screen.getByRole("dialog", { name: "举报此内容" });
      fireEvent.change(within(dialog).getByLabelText("举报原因"), { target: { value: "包含不当内容" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "确认举报" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("服务暂时不可用");
      fireEvent.click(within(dialog).getByRole("button", { name: "重试举报" }));
      expect(await screen.findByRole("status")).toHaveTextContent("举报已提交");
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toEqual(bodies[0]);
    } finally { restore(); }
  });

  it.each(["reason", "details"] as const)("starts a new report intent after the user edits failed %s", async (field) => {
    const restore = installDialog();
    const firstId = "66666666-6666-4666-8666-666666666666";
    const secondId = "77777777-7777-4777-8777-777777777777";
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(firstId).mockReturnValueOnce(secondId);
    const bodies: Array<{ clientRequestId: string; reason: string; details?: string }> = [];
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      attempt += 1;
      return attempt === 1
        ? Response.json({ error: "响应丢失" }, { status: 503 })
        : Response.json({ reportId: "safe-report", status: "PENDING" }, { status: 201 });
    }));
    try {
      render(<SafetyActionDialog actions={["report"]} realm="parent" target={target} />);
      fireEvent.click(screen.getByRole("button", { name: "举报此内容" }));
      const dialog = screen.getByRole("dialog", { name: "举报此内容" });
      const reason = within(dialog).getByLabelText("举报原因");
      fireEvent.change(reason, { target: { value: "第一次原因" } });
      const details = within(dialog).getByLabelText("补充说明（选填）");
      fireEvent.change(details, { target: { value: "第一次说明" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "确认举报" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("响应丢失");

      fireEvent.change(field === "reason" ? reason : details, { target: { value: field === "reason" ? "修改后的新原因" : "修改后的新说明" } });
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "确认举报" })).toBeEnabled();
      fireEvent.click(within(dialog).getByRole("button", { name: "确认举报" }));

      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies.map(({ clientRequestId }) => clientRequestId)).toEqual([firstId, secondId]);
      expect(bodies[1][field]).toBe(field === "reason" ? "修改后的新原因" : "修改后的新说明");
    } finally { restore(); }
  });

  it.each([
    ["report", {}],
    ["report", { reportId: 42, status: "PENDING" }],
    ["block", { blocked: false }],
  ] as const)("keeps an invalid %s success payload retryable", async (action, payload) => {
    const restore = installDialog();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
    try {
      render(<SafetyActionDialog actions={[action]} realm="parent" target={target} />);
      fireEvent.click(screen.getByRole("button", { name: action === "report" ? "举报此内容" : "屏蔽对方" }));
      const dialog = screen.getByRole("dialog", { name: action === "report" ? "举报此内容" : "屏蔽对方" });
      fireEvent.change(within(dialog).getByLabelText(action === "report" ? "举报原因" : "屏蔽原因"), { target: { value: "内容不符合约定" } });
      fireEvent.click(within(dialog).getByRole("button", { name: action === "report" ? "确认举报" : "确认屏蔽" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("服务响应无效，请重试");
      expect(within(dialog).getByRole("button", { name: action === "report" ? "重试举报" : "重试屏蔽" })).toBeEnabled();
    } finally { restore(); }
  });

  it.each(["PENDING", "REVIEWING", "RESOLVED", "DISMISSED"] as const)("accepts report route status %s", async (status) => {
    const restore = installDialog();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ reportId: "safe-report", status }, { status: 201 })));
    try {
      render(<SafetyActionDialog actions={["report"]} realm="parent" target={target} />);
      fireEvent.click(screen.getByRole("button", { name: "举报此内容" }));
      const dialog = screen.getByRole("dialog", { name: "举报此内容" });
      fireEvent.change(within(dialog).getByLabelText("举报原因"), { target: { value: "需要平台核查" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "确认举报" }));
      expect(await screen.findByRole("status")).toHaveTextContent("举报已提交");
    } finally { restore(); }
  });
});
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
