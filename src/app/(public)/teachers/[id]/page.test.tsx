import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  adjacent: vi.fn(async () => []),
  detail: vi.fn(),
  preview: vi.fn(),
  requests: vi.fn(async () => []),
}));

vi.mock("@/features/directory/personalization", () => ({
  getAdjacentRegionPairs: mocks.adjacent,
  getDirectoryAccessContext: mocks.access,
}));
vi.mock("@/features/directory/server", () => ({
  directoryRepository: {
    getTeacherDetail: mocks.detail,
    getTeacherPreview: mocks.preview,
  },
}));
vi.mock("@/features/greetings/page-data", () => ({ getParentPublishedRequestOptions: mocks.requests }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

import TeacherDetailPage from "./page";

const preview = {
  id: "11111111-1111-4111-8111-111111111111",
  publicNickname: "林老师",
  identityType: "FULL_TIME_TEACHER" as const,
  headline: "几何方法课",
  yearsExperience: 8,
  rateMinCents: 10000,
  rateMaxCents: 18000,
  online: true,
  subjects: [{ id: "subject", name: "数学" }],
  serviceAreas: [{ id: "region", name: "海淀区", isPrimary: true }],
  verified: true,
  publishedAt: "2026-07-01T00:00:00.000Z",
};

describe("teacher public detail page", () => {
  beforeEach(() => {
    mocks.access.mockReset();
    mocks.preview.mockReset();
    mocks.detail.mockReset();
  });

  it("renders only preview fields and parent login CTA anonymously", async () => {
    mocks.access.mockResolvedValue({ authenticated: false, matchingViewer: null });
    mocks.preview.mockResolvedValue(preview);
    render(await TeacherDetailPage({ params: Promise.resolve({ id: preview.id }) }));

    expect(screen.getByRole("heading", { name: "林老师" })).toBeInTheDocument();
    expect(screen.queryByText("私密教师自述")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家长登录后联系老师" })).toHaveAttribute("href", "/parent/login");
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("shows detail to an authenticated parent even without matching district", async () => {
    mocks.access.mockResolvedValue({ authenticated: true, matchingViewer: null });
    mocks.detail.mockResolvedValue({ ...preview, bio: "私密教师自述" });
    render(await TeacherDetailPage({ params: Promise.resolve({ id: preview.id }) }));

    expect(screen.getByText("私密教师自述")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /登录后/ })).not.toBeInTheDocument();
    expect(screen.getByText("先发布一条有效需求")).toBeInTheDocument();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
