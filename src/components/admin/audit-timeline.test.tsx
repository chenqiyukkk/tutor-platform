import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuditTimeline } from "./audit-timeline";

describe("AuditTimeline", () => {
  it("renders only allowlisted result labels", () => {
    const { container } = render(<AuditTimeline entries={[{
      id: "audit-safe", action: "REPORT_DECISION", targetType: "REPORT", createdAt: "2026-07-14T03:00:00.000Z",
      result: { status: "RESOLVED", resolutionAction: "NONE", email: "private@example.test", accountId: "secret" },
    }]} />);
    expect(screen.getByText("举报处理")).toBeInTheDocument();
    expect(screen.getByText(/已解决/u)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/private|accountId|secret|email/i);
  });

  it("uses the real evidence audit action label", () => {
    render(<AuditTimeline entries={[{ id: "audit-evidence", action: "VERIFICATION_EVIDENCE_VIEW", targetType: "VERIFICATION", createdAt: "2026-07-14T03:00:00.000Z", result: { mimeType: "image/png" } }]} />);
    expect(screen.getByText("认证证据调阅")).toBeInTheDocument();
  });

  it("formats audit timestamps in the platform timezone", () => {
    const format = vi.spyOn(Date.prototype, "toLocaleString");
    render(<AuditTimeline entries={[{ id: "audit-timezone", action: "REPORT_DECISION", targetType: "REPORT", createdAt: "2026-07-14T03:00:00.000Z", result: {} }]} />);
    expect(format).toHaveBeenCalledWith("zh-CN", expect.objectContaining({ timeZone: "Asia/Shanghai" }));
    format.mockRestore();
  });
});
