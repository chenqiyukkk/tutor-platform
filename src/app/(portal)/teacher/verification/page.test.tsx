import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/teachers/auth", () => ({ getAuthenticatedTeacher: mocks.auth }));
vi.mock("@/features/verifications/server", () => ({
  verificationService: { list: mocks.list },
  verificationStorage: { enabled: false, rootDir: "D:\\private\\verification-evidence" },
}));

import { VerificationWorkflowError } from "@/features/verifications/service";

import TeacherVerificationPage from "./page";
import TeacherLayout from "../layout";

describe("teacher verification page", () => {
  it("is reachable from the teacher workspace navigation", async () => {
    mocks.auth.mockResolvedValue({ id: "safe", role: "teacher" });
    render(await TeacherLayout({ children: <p>内容</p> }));
    expect(screen.getByRole("link", { name: "自愿认证" })).toHaveAttribute("href", "/teacher/verification");
  });

  it("loads only the authenticated teacher safe DTO and never renders storage or actor internals", async () => {
    const account = { id: "11111111-1111-4111-8111-111111111111", role: "teacher" as const, username: "private-name", email: "private@example.test" };
    mocks.auth.mockResolvedValue(account);
    mocks.list.mockResolvedValue([{
      id: "22222222-2222-4222-8222-222222222222",
      type: "TEACHER_QUALIFICATION",
      status: "APPROVED",
      submittedAt: "2026-07-14T01:00:00.000Z",
      reviewedAt: "2026-07-14T02:00:00.000Z",
      expiresAt: null,
      reviewNote: null,
    }]);

    const view = render(await TeacherVerificationPage());

    expect(mocks.list).toHaveBeenCalledWith({ id: account.id, role: "teacher" });
    expect(screen.getByRole("heading", { name: "自愿认证" })).toBeInTheDocument();
    expect(screen.getByText("教师资格")).toBeInTheDocument();
    expect(screen.getByText("已通过")).toBeInTheDocument();
    expect(view.container.innerHTML).not.toMatch(/private-name|private@example|verification-evidence|accountId|profileId|requestId|sha256/i);
  });

  it("guides a teacher without a profile to complete it without exposing the workflow error", async () => {
    mocks.auth.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", role: "teacher" });
    mocks.list.mockRejectedValue(new VerificationWorkflowError(
      "PROFILE_REQUIRED",
      "private profile detail D:\\private\\verification-evidence",
    ));

    const view = render(await TeacherVerificationPage());

    expect(screen.getByRole("heading", { name: "自愿认证" })).toBeInTheDocument();
    expect(screen.getByText("请先完善教师资料")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往完善教师资料" })).toHaveAttribute("href", "/teacher/profile");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("选择认证图片")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "我的认证" })).not.toBeInTheDocument();
    expect(view.container.innerHTML).not.toMatch(/PROFILE_REQUIRED|private profile detail|verification-evidence/i);
  });

  it.each([
    new VerificationWorkflowError("CONFLICT", "private conflict detail"),
    new Error("unexpected private failure"),
  ])("does not hide non-profile failures", async (error) => {
    mocks.auth.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", role: "teacher" });
    mocks.list.mockRejectedValue(error);

    await expect(TeacherVerificationPage()).rejects.toBe(error);
  });
});
