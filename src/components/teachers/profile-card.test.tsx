import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TeacherProfile } from "@/features/teachers/service";

import { ProfileCard } from "./profile-card";

const profile: TeacherProfile = {
  id: "profile-secret",
  accountId: "account-secret",
  publicNickname: "林老师",
  identityType: "FULL_TIME_TEACHER",
  bio: "十年一线教学经验，重视学习方法与思维习惯。",
  yearsExperience: 10,
  online: true,
  rateMinCents: 10000,
  rateMaxCents: 16000,
  status: "PUBLISHED",
  publishedAt: new Date(),
  subjects: [{ id: "subject-secret", name: "数学" }],
  primaryRegion: { id: "region-secret", name: "天河区" },
  extraRegions: [{ id: "extra-secret", name: "越秀区" }],
};

describe("ProfileCard", () => {
  it("renders public teaching details without internal owner identifiers", () => {
    const { container } = render(<ProfileCard profile={profile} />);
    expect(screen.getByRole("heading", { name: "林老师" })).toBeInTheDocument();
    expect(screen.getByText(/全职教师/)).toBeInTheDocument();
    expect(screen.getByText(/数学/)).toBeInTheDocument();
    expect(screen.getByText(/天河区/)).toBeInTheDocument();
    expect(screen.getByText(/100–160 元\/小时/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent("account-secret");
    expect(container).not.toHaveTextContent("profile-secret");
  });
});
