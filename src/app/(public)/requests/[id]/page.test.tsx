import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), adjacent: vi.fn(async () => []), detail: vi.fn(), preview: vi.fn() }));
vi.mock("@/features/directory/personalization", () => ({ getAdjacentRegionPairs: mocks.adjacent, getDirectoryAccessContext: mocks.access }));
vi.mock("@/features/directory/server", () => ({ directoryRepository: { getRequestDetail: mocks.detail, getRequestPreview: mocks.preview } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

import RequestDetailPage from "./page";

const preview = {
  id: "22222222-2222-4222-8222-222222222222", title: "初二数学巩固", studentAlias: "小树", gradeLevel: "GRADE_8",
  budgetMinCents: 10000, budgetMaxCents: 16000, teachingMode: "BOTH" as const, scheduleText: "周六下午",
  region: { id: "region", name: "海淀区" }, subjects: [{ id: "subject", name: "数学" }], publishedAt: "2026-07-01T00:00:00.000Z",
};

describe("request public detail page", () => {
  beforeEach(() => { mocks.access.mockReset(); mocks.preview.mockReset(); mocks.detail.mockReset(); });

  it("does not render description or location note anonymously", async () => {
    mocks.access.mockResolvedValue({ authenticated: false, matchingViewer: null });
    mocks.preview.mockResolvedValue(preview);
    render(await RequestDetailPage({ params: Promise.resolve({ id: preview.id }) }));

    expect(screen.getByRole("heading", { name: "初二数学巩固" })).toBeInTheDocument();
    expect(screen.queryByText("认证教师可见的需求描述")).not.toBeInTheDocument();
    expect(screen.queryByText(/五道口商圈附近/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "老师登录后回应需求" })).toHaveAttribute("href", "/teacher/login");
    expect(screen.queryByRole("button", { name: "举报此内容" })).not.toBeInTheDocument();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("shows full detail to an authenticated teacher without requiring a district", async () => {
    mocks.access.mockResolvedValue({ authenticated: true, matchingViewer: null });
    mocks.detail.mockResolvedValue({ ...preview, description: "认证教师可见的需求描述", publicLocationNote: "五道口商圈附近" });
    render(await RequestDetailPage({ params: Promise.resolve({ id: preview.id }) }));

    expect(screen.getByText("认证教师可见的需求描述")).toBeInTheDocument();
    expect(screen.getByText(/五道口商圈附近/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /登录后/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "举报此内容" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "屏蔽对方" })).toBeInTheDocument();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
