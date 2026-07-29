import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EvidenceAccessDialog } from "./evidence-access-dialog";

function installDialog() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
}

describe("EvidenceAccessDialog", () => {
  it("keeps the active download URL inside a two-step native dialog", () => {
    installDialog();
    const { container } = render(<EvidenceAccessDialog verificationId="40000000-0000-4000-8000-000000000001" />);
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    expect(within(dialog).getByRole("heading", { name: "调阅敏感认证材料", hidden: true })).toBeInTheDocument();
    const link = within(dialog).getByRole("link", { name: "确认并下载证据", hidden: true });
    expect(link).toHaveAttribute("href", "/api/admin/verifications/40000000-0000-4000-8000-000000000001/evidence");
    expect(link).toHaveAttribute("download");
    expect(link.closest("dialog")).toBe(dialog);
    expect(container.querySelectorAll(`a[href*="/evidence"]`)).toHaveLength(1);
    expect(within(dialog).getByText(/每次调阅都会重新鉴权并写入审计/u)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toMatch(/sha256|evidenceKey|storage|private\\|mimeType/i);
  });

  it("opens, focuses the safe cancel action, and restores focus after cancellation", async () => {
    installDialog();
    render(<EvidenceAccessDialog verificationId="40000000-0000-4000-8000-000000000001" />);
    const trigger = screen.getByRole("button", { name: "查看材料入口" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "调阅敏感认证材料" });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
