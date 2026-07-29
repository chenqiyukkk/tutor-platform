import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RequestCard } from "./request-card";
import type { TutoringRequestDto } from "@/features/requests/service";

const request: TutoringRequestDto = {
  id: "11111111-1111-4111-8111-111111111111", studentProfileId: "22222222-2222-4222-8222-222222222222", regionId: "33333333-3333-4333-8333-333333333333",
  budgetMinCents: 8000, budgetMaxCents: 12000, teachingMode: "BOTH", scheduleText: "周末下午", publicLocationNote: "天河公园附近",
  description: "巩固数学基础", status: "PUBLISHED", publishedAt: new Date("2026-07-13T00:00:00Z"), closedAt: null,
  student: { id: "22222222-2222-4222-8222-222222222222", publicAlias: "小树", grade: "GRADE_8", notes: "真实学校和家长电话绝不公开", isActive: true },
  subjects: [{ id: "44444444-4444-4444-8444-444444444444", name: "数学", isActive: true }],
  region: { id: "33333333-3333-4333-8333-333333333333", name: "天河区", level: 3, isActive: true },
};

describe("RequestCard", () => {
  it("shows only the public learning alias and approximate request details", () => {
    render(<RequestCard request={request} />);
    expect(screen.getByText(/小树/)).toBeInTheDocument();
    expect(screen.getByText(/天河公园附近/)).toBeInTheDocument();
    expect(screen.queryByText(/真实学校和家长电话/)).not.toBeInTheDocument();
  });
});
