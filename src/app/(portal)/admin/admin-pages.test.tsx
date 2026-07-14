import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ id: "10000000-0000-4000-8000-000000000001", role: "admin" as const })),
  dashboard: vi.fn(), users: vi.fn(), reports: vi.fn(), verifications: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/moderation/admin-page-auth", () => ({ getAuthenticatedAdmin: mocks.auth }));
vi.mock("@/features/moderation/admin-read-server", () => ({ adminReadService: {
  getDashboard: mocks.dashboard, listUsers: mocks.users, listReports: mocks.reports, listVerifications: mocks.verifications,
} }));

import AdminLayout from "./layout";
import AdminDashboardPage from "./dashboard/page";
import AdminUsersPage from "./users/page";
import AdminReportsPage from "./reports/page";
import AdminVerificationsPage from "./verifications/page";
import AdminLoading from "./loading";
import AdminError from "./error";
import { formatAdminDate } from "./admin-page-ui";

const page = { page: 1, pageSize: 20, total: 1, totalPages: 1 };
function installDialog() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
}

describe("admin console pages", () => {
  it("guards the layout and exposes desktop/mobile-friendly navigation plus logout", async () => {
    render(await AdminLayout({ children: <p>内容</p> }));
    expect(mocks.auth).toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "治理后台导航" })).toBeInTheDocument();
    for (const name of ["总览", "用户", "举报", "认证"]) expect(screen.getByRole("link", { name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });

  it("shows task counts, oldest work and audit without charts or private metadata", async () => {
    mocks.dashboard.mockResolvedValueOnce({ counts: { openReports: 2, pendingVerifications: 1 }, oldest: { report: "2026-07-14T01:00:00.000Z", verification: null }, recentAudit: [{ id: "a-1", action: "REPORT_DECISION", targetType: "REPORT", createdAt: "2026-07-14T03:00:00.000Z", result: { status: "RESOLVED" } }] });
    const view = render(await AdminDashboardPage());
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /举报/u })).toHaveAttribute("href", "/admin/reports");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(view.container.innerHTML).not.toMatch(/email|accountId|payloadHash|path|sha256/i);
  });

  it("renders safe user rows without email", async () => {
    mocks.users.mockResolvedValueOnce({ ...page, items: [{ id: "20000000-0000-4000-8000-000000000001", username: "青禾", role: "TEACHER", status: "ACTIVE", createdAt: "2026-07-14T01:00:00.000Z", updatedAt: "2026-07-14T02:00:00.000Z" }] });
    const view = render(await AdminUsersPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("青禾").length).toBeGreaterThan(0);
    expect(view.container.innerHTML).not.toMatch(/email|example\.test/i);
  });

  it("does not offer a status mutation for the signed-in admin", async () => {
    mocks.users.mockResolvedValueOnce({ ...page, items: [{ id: "10000000-0000-4000-8000-000000000001", username: "值班员", role: "ADMIN", status: "ACTIVE", createdAt: "2026-07-14T01:00:00.000Z", updatedAt: "2026-07-14T02:00:00.000Z" }] });
    render(await AdminUsersPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("当前账号").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "停用" })).not.toBeInTheDocument();
  });

  it("renders report reason and safe snapshot without account identifiers", async () => {
    mocks.reports.mockResolvedValueOnce({ ...page, items: [{ id: "30000000-0000-4000-8000-000000000001", targetType: "MESSAGE", reason: "骚扰", details: "反复催促", status: "PENDING", resolutionAction: null, reporter: "青禾", subject: "松风", snapshot: { message: "请停止联系" }, createdAt: "2026-07-14T01:00:00.000Z", updatedAt: "2026-07-14T02:00:00.000Z" }] });
    const view = render(await AdminReportsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("骚扰").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/请停止联系/u).length).toBeGreaterThan(0);
    expect(view.container.innerHTML).not.toMatch(/accountId|reportedAccountId/i);
  });

  it("does not offer content takedown for an unsupported report target", async () => {
    mocks.reports.mockResolvedValueOnce({ ...page, items: [{ id: "30000000-0000-4000-8000-000000000001", targetType: "CONVERSATION", reason: "骚扰", details: null, status: "REVIEWING", resolutionAction: null, reporter: "青禾", subject: "松风", snapshot: { counterpart: "松风" }, createdAt: "2026-07-14T01:00:00.000Z", updatedAt: "2026-07-14T02:00:00.000Z" }] });
    render(await AdminReportsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "下架" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "仅结案" }).length).toBeGreaterThan(0);
  });

  it("uses fixed suspension categories when a report resolves by account suspension", async () => {
    installDialog();
    mocks.reports.mockResolvedValueOnce({ ...page, items: [{ id: "30000000-0000-4000-8000-000000000001", targetType: "MESSAGE", reason: "骚扰", details: null, status: "REVIEWING", resolutionAction: null, reporter: "青禾", subject: "松风", snapshot: { message: "停止联系" }, canSuspendAccount: true, createdAt: "2026-07-14T01:00:00.000Z", updatedAt: "2026-07-14T02:00:00.000Z" }] });
    render(await AdminReportsPage({ searchParams: Promise.resolve({}) }));
    fireEvent.click(screen.getAllByRole("button", { name: "停用账号" })[0]);
    const dialog = screen.getByRole("dialog", { name: "停用并结案" });
    for (const category of ["虚假信息", "骚扰", "收费诈骗", "其他"]) expect(within(dialog).getByRole("option", { name: category })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("补充说明（可选）")).toBeInTheDocument();
  });

  it("hides account suspension when the safe report DTO disallows it", async () => {
    mocks.reports.mockResolvedValueOnce({ ...page, items: [{ id: "30000000-0000-4000-8000-000000000001", targetType: "MESSAGE", reason: "骚扰", details: null, status: "REVIEWING", resolutionAction: null, reporter: "青禾", subject: "已移除账号", snapshot: {}, canSuspendAccount: false, createdAt: "2026-07-14T01:00:00.000Z", updatedAt: "2026-07-14T02:00:00.000Z" }] });
    render(await AdminReportsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "停用账号" })).not.toBeInTheDocument();
  });

  it("requires an intentional evidence click and never renders evidence metadata", async () => {
    mocks.verifications.mockResolvedValueOnce({ ...page, items: [{ id: "40000000-0000-4000-8000-000000000001", applicant: "松风", type: "EDUCATION", status: "PENDING", submittedAt: "2026-07-14T01:00:00.000Z", updatedAt: "2026-07-14T02:00:00.000Z" }] });
    const view = render(await AdminVerificationsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("松风").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "查看材料入口" }).length).toBeGreaterThan(0);
    const dialog = view.container.querySelector(".evidence-access-dialog") as HTMLDialogElement;
    expect(within(dialog).getByRole("heading", { name: "调阅敏感认证材料", hidden: true })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "确认并下载证据", hidden: true })).toHaveAttribute("href", "/api/admin/verifications/40000000-0000-4000-8000-000000000001/evidence");
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.innerHTML).not.toMatch(/sha256|storage|evidenceKey|mimeType/i);
  });

  it("provides explicit loading and recoverable error states", () => {
    const { rerender } = render(<AdminLoading />);
    expect(screen.getByText("正在读取治理队列…")).toBeInTheDocument();
    rerender(<AdminError error={new Error("private D:\\secret")} reset={vi.fn()} />);
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
    expect(screen.queryByText(/private|secret/i)).not.toBeInTheDocument();
  });

  it("formats page timestamps in the platform timezone", () => {
    const format = vi.spyOn(Date.prototype, "toLocaleString");
    formatAdminDate("2026-07-14T03:00:00.000Z");
    expect(format).toHaveBeenCalledWith("zh-CN", expect.objectContaining({ timeZone: "Asia/Shanghai" }));
    format.mockRestore();
  });
});
