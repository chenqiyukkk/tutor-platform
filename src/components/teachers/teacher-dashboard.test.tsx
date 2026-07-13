import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TeacherProfile } from "@/features/teachers/service";

import { TeacherDashboard } from "./teacher-dashboard";

const profile: TeacherProfile = {
  id: "profile",
  accountId: "account",
  publicNickname: "林老师",
  identityType: "FULL_TIME_TEACHER",
  bio: "十年一线教学经验，重视学习方法与思维习惯。",
  yearsExperience: 10,
  online: true,
  rateMinCents: 10000,
  rateMaxCents: 16000,
  status: "PUBLISHED",
  publishedAt: new Date(),
  subjects: [{ id: "subject", name: "数学" }],
  primaryRegion: { id: "main", name: "天河区" },
  extraRegions: [{ id: "extra", name: "越秀区" }],
};

describe("TeacherDashboard", () => {
  it("shows completion, publication status, districts and honest future-feature empty states", () => {
    render(<TeacherDashboard profile={profile} username="teacher-a" />);
    expect(screen.getByRole("heading", { name: /林老师/ })).toBeInTheDocument();
    expect(screen.getByText("100%")) .toBeInTheDocument();
    expect(screen.getByText("已发布")).toBeInTheDocument();
    expect(screen.getByText(/天河区/)).toBeInTheDocument();
    expect(screen.getByText(/越秀区/)).toBeInTheDocument();
    expect(screen.getAllByText("功能即将开放")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /管理教师资料/ })).toHaveAttribute("href", "/teacher/profile");
  });
});
