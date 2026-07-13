import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GreetingCard } from "./greeting-card";

const baseItem = {
  id: "greeting-1",
  direction: "received" as const,
  status: "PENDING",
  note: "希望进一步沟通",
  createdAt: "2026-07-13T06:00:00.000Z",
};

describe("GreetingCard", () => {
  it("runtime-validates and renders the complete safe snapshot", () => {
    render(<GreetingCard item={{ ...baseItem, card: {
      teacher: {
        id: crypto.randomUUID(), publicNickname: "林老师", identityType: "FULL_TIME_TEACHER",
        headline: "把数学讲清楚", yearsExperience: 5, rateMinCents: 10000, rateMaxCents: 15000,
        online: true, verified: true,
        subjects: [{ id: crypto.randomUUID(), name: "数学" }],
        serviceAreas: [{ id: crypto.randomUUID(), name: "朝阳区", isPrimary: true }],
      },
      request: {
        id: crypto.randomUUID(), title: "初二数学巩固", studentAlias: "小树", gradeLevel: "GRADE_8",
        budgetMinCents: 8000, budgetMaxCents: 12000, teachingMode: "BOTH", scheduleText: "周末下午",
        region: { id: crypto.randomUUID(), name: "朝阳区" },
        subjects: [{ id: crypto.randomUUID(), name: "数学" }],
      },
    } }} onAction={vi.fn()} realm="parent" />);

    for (const value of ["林老师", "把数学讲清楚", "5 年经验", "已认证", "数学", "朝阳区", "周末下午", "线上 / 线下均可", "¥80–¥120/小时"]) {
      expect(screen.getAllByText(value).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/小树.*初二/u)).toBeInTheDocument();
  });

  it.each([
    [{ legacy: true }, "历史联系卡片"],
    [{ unexpected: { evidence: "private-file-path" } }, "资料快照暂不可读"],
    [null, "资料快照暂不可读"],
  ])("gracefully renders legacy or unknown snapshots", (card, expected) => {
    render(<GreetingCard item={{ ...baseItem, card }} onAction={vi.fn()} realm="parent" />);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText("private-file-path")).not.toBeInTheDocument();
  });

  it.each(["parent", "teacher"] as const)("links accepted cards to the %s in-app conversation entry", (realm) => {
    render(<GreetingCard
      item={{ ...baseItem, status: "ACCEPTED", card: { legacy: true } }}
      onAction={vi.fn()}
      realm={realm}
    />);

    expect(screen.queryByText(/下一阶段开放/u)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往站内消息" })).toHaveAttribute("href", `/${realm}/messages`);
  });
});
