import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RequestForm } from "./request-form";

const student = { id: "22222222-2222-4222-8222-222222222222", publicAlias: "小树", grade: "GRADE_8" as const, notes: null, isActive: true };
const subject = { id: "44444444-4444-4444-8444-444444444444", name: "数学" };
const savedDraft = {
  id: "11111111-1111-4111-8111-111111111111", studentProfileId: student.id, regionId: null,
  budgetMinCents: null, budgetMaxCents: null, teachingMode: null, scheduleText: null,
  publicLocationNote: null, description: "新数据", status: "DRAFT" as const,
  publishedAt: null, closedAt: null, student, subjects: [{ ...subject, isActive: true }], region: null,
};
const published = { ...savedDraft, status: "PUBLISHED" as const, publishedAt: new Date("2026-07-13T00:00:00Z") };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("RequestForm", () => {
  it("gives an explicit blocking message when there are no active subjects", () => {
    render(<RequestForm initialRequest={null} students={[student]} subjects={[]} fetchRegions={async () => []} />);
    expect(screen.getByRole("alert")).toHaveTextContent("暂无可选科目");
    expect(screen.getByText(/启发式拦截不能覆盖所有写法/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });

  it("locks mutations while a save is pending", async () => {
    const user = userEvent.setup();
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetcher = vi.fn(() => pending);
    render(<RequestForm initialRequest={null} students={[student]} subjects={[subject]} fetchRegions={async () => []} fetcher={fetcher} />);
    const save = screen.getByRole("button", { name: "保存草稿" });
    await user.click(save);
    await user.click(save);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    resolve(new Response(JSON.stringify({ request: { id: "11111111-1111-4111-8111-111111111111", status: "DRAFT" } }), { status: 201, headers: { "content-type": "application/json" } }));
  });

  it("synchronously admits only one save when two submits occur in the same tick", () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    const { container } = render(<RequestForm initialRequest={null} students={[student]} subjects={[subject]} fetchRegions={async () => []} fetcher={fetcher} />);
    const form = container.querySelector("form")!;
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps a newly-created draft when publish fails and reuses its id on retry", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ request: savedDraft }, 201))
      .mockResolvedValueOnce(json({ error: "发布校验失败", fieldErrors: { subjectIds: ["科目已停用"] } }, 400))
      .mockResolvedValueOnce(json({ request: savedDraft }))
      .mockResolvedValueOnce(json({ request: published }));
    render(<RequestForm initialRequest={null} students={[student]} subjects={[subject]} fetchRegions={async () => []} fetcher={fetcher} />);

    await user.click(screen.getByRole("button", { name: "发布需求" }));
    expect(await screen.findByText("草稿已保存但发布失败：发布校验失败")).toBeInTheDocument();
    expect(screen.getByText("草稿")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "发布需求" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(fetcher.mock.calls[0][0]).toBe("/api/parent/requests");
    expect(fetcher.mock.calls[2][0]).toBe(`/api/parent/requests/${savedDraft.id}`);
  });

  it("shows an edited published request as a saved draft when republish fails", async () => {
    const user = userEvent.setup();
    const editedDraft = { ...savedDraft, description: "已保存的新说明" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ request: editedDraft }))
      .mockResolvedValueOnce(json({ error: "发布失败" }, 409));
    render(<RequestForm initialRequest={published} students={[student]} subjects={[subject]} fetchRegions={async () => []} fetcher={fetcher} />);

    await user.click(screen.getByRole("button", { name: "发布需求" }));
    expect(await screen.findByText("草稿已保存但发布失败：发布失败")).toBeInTheDocument();
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.queryByText(/编辑并保存后/)).not.toBeInTheDocument();
  });

  it("releases the synchronous lock after its owner fails so a later save can succeed", async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveNew = resolve; }));
    const { container } = render(<RequestForm initialRequest={null} students={[student]} subjects={[subject]} fetchRegions={async () => []} fetcher={fetcher} />);
    const form = container.querySelector("form")!;
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => { resolveOld(json({ error: "旧错误", fieldErrors: { subjectIds: ["旧科目错误"] } }, 400)); });
    expect(await screen.findByText("旧科目错误")).toBeInTheDocument();
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { resolveNew(json({ request: savedDraft }, 201)); });
    expect(screen.queryByText("旧科目错误")).not.toBeInTheDocument();
    expect(screen.getByText("草稿已保存")).toBeInTheDocument();
  });

  it("releases the synchronous lock after its owner succeeds", async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveNew = resolve; }));
    const { container } = render(<RequestForm initialRequest={null} students={[student]} subjects={[subject]} fetchRegions={async () => []} fetcher={fetcher} />);
    const form = container.querySelector("form")!;
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => { resolveOld(json({ request: published }, 201)); });
    expect(screen.getByText("招募中")).toBeInTheDocument();
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { resolveNew(json({ request: savedDraft }, 201)); });
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.queryByText("招募中")).not.toBeInTheDocument();
  });

  it("associates subject field errors with the subject group", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue(json({ error: "科目无效", fieldErrors: { subjectIds: ["请选择有效科目"] } }, 400));
    render(<RequestForm initialRequest={null} students={[student]} subjects={[subject]} fetchRegions={async () => []} fetcher={fetcher} />);
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    const group = screen.getByRole("group", { name: /辅导科目/ });
    expect(group).toHaveAttribute("aria-invalid", "true");
    const describedBy = group.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("请选择有效科目");
    expect(document.getElementById(describedBy!)).toHaveAttribute("role", "alert");
  });
});
