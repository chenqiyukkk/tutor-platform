import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: "举报这张往来卡" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "屏蔽对方" })).toBeInTheDocument();
  });

  it("keeps pending reporting on the atomic greeting workflow without duplicate generic actions", () => {
    render(<GreetingCard item={{ ...baseItem, card: { legacy: true } }} onAction={vi.fn()} realm="parent" />);
    expect(screen.getAllByRole("button", { name: "举报" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "举报这张往来卡" })).not.toBeInTheDocument();
  });

  it("does not offer generic historical actions on cards sent by the current user", () => {
    render(<GreetingCard item={{ ...baseItem, direction: "sent", status: "ACCEPTED", card: { legacy: true } }} onAction={vi.fn()} realm="parent" />);
    expect(screen.queryByRole("button", { name: "举报这张往来卡" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "屏蔽对方" })).not.toBeInTheDocument();
  });

  it.each(["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"])("reports historical %s cards through the generic endpoint", async (status) => {
    const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json({ reportId: "safe", status: "PENDING" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<GreetingCard item={{ ...baseItem, status, card: { legacy: true } }} onAction={vi.fn()} realm="parent" />);
      fireEvent.click(screen.getByRole("button", { name: "举报这张往来卡" }));
      const dialog = screen.getByRole("dialog", { name: "举报这张往来卡" });
      fireEvent.change(within(dialog).getByLabelText("举报原因"), { target: { value: "历史内容不当" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "确认举报" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        "/api/reports?realm=parent",
        expect.objectContaining({ body: expect.stringContaining(`\"greetingId\":\"${baseItem.id}\"`) }),
      ));
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/greetings/"))).toBe(false);
      if (status === "ACCEPTED") expect(screen.getByRole("link", { name: "前往站内消息" })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
      else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
      if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
      else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
    }
  });
});
