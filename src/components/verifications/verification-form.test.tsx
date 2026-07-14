import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VerificationForm } from "./verification-form";

const record = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "STUDENT_STATUS",
  status: "REJECTED" as const,
  submittedAt: "2026-07-14T01:00:00.000Z",
  reviewedAt: "2026-07-14T02:00:00.000Z",
  expiresAt: null,
  reviewNote: "图片边缘不完整，请重新拍摄。",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("VerificationForm", () => {
  it("explains that verification is voluntary and keeps disabled uploads free of private file controls", () => {
    const view = render(<VerificationForm initialVerifications={[record]} uploadEnabled={false} />);

    expect(screen.getByText(/完全自愿/u)).toBeInTheDocument();
    expect(screen.getByText(/不影响浏览、匹配或沟通/u)).toBeInTheDocument();
    expect(screen.getByText(/不是付费等级/u)).toBeInTheDocument();
    expect(screen.getByText(/原件永不公开/u)).toBeInTheDocument();
    expect(screen.getByText("认证材料上传暂未开放")).toBeInTheDocument();
    expect(screen.queryByLabelText("选择认证图片")).not.toBeInTheDocument();
    expect(screen.getByText("在读身份")).toBeInTheDocument();
    expect(screen.getByText("未通过")).toBeInTheDocument();
    expect(screen.getByText(record.reviewNote)).toBeInTheDocument();
    expect(view.container.innerHTML).not.toMatch(/private-file|sha256|accountId|profileId|requestId/i);
  });

  it("uploads only after an explicit file choice, retries with one stable intent id, then resets safely", async () => {
    const requestId = "22222222-2222-4222-8222-222222222222";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
    const submissions: FormData[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      submissions.push(init?.body as FormData);
      if (submissions.length === 1) {
        return Response.json({ code: "INTERNAL_ERROR", error: "服务暂时不可用" }, { status: 500 });
      }
      return Response.json({ verification: {
        ...record,
        id: "33333333-3333-4333-8333-333333333333",
        type: "EDUCATION",
        status: "PENDING",
        reviewNote: null,
        reviewedAt: null,
      } }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VerificationForm initialVerifications={[]} uploadEnabled />);

    expect(screen.getByLabelText("认证类型")).toHaveValue("STUDENT_STATUS");
    expect(screen.getByText(/JPEG 或 PNG.*5 MiB/u)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "提交认证材料" });
    expect(submit).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("认证类型"), { target: { value: "EDUCATION" } });
    const fileInput = screen.getByLabelText("选择认证图片") as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "degree.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent("服务暂时不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试提交" }));

    expect(await screen.findByRole("status")).toHaveTextContent("学历认证材料已提交");
    expect(screen.getByText("等待审核")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const body of submissions) {
      expect(body.get("type")).toBe("EDUCATION");
      expect(body.get("clientRequestId")).toBe(requestId);
      expect(body.get("file")).toBeInstanceOf(File);
      expect([...body.keys()]).toEqual(["type", "clientRequestId", "file"]);
    }
    await waitFor(() => expect(fileInput).toHaveValue(""));
  });

  it.each([400, 409, 413, 503, 500])("keeps status %s failures retryable", async (status) => {
    const fetchMock = vi.fn(async () => Response.json({ error: `错误 ${status}` }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    render(<VerificationForm initialVerifications={[]} uploadEnabled />);
    fireEvent.change(screen.getByLabelText("选择认证图片"), {
      target: { files: [new File(["image"], "proof.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交认证材料" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "重试提交" })).toBeEnabled();
  });

  it.each([
    { verification: { ...record, status: "UNKNOWN" } },
    { verification: { ...record, id: "not-a-verification-id" } },
    {},
  ])("rejects malformed successful DTOs without rendering unsafe state", async (payload) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload, { status: 201 })));
    render(<VerificationForm initialVerifications={[]} uploadEnabled />);
    fireEvent.change(screen.getByLabelText("选择认证图片"), {
      target: { files: [new File(["image"], "proof.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交认证材料" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("服务响应无效，请重试");
    expect(screen.getByRole("button", { name: "重试提交" })).toBeEnabled();
    expect(screen.getByText("还没有认证记录。")).toBeInTheDocument();
  });

  it("formats record dates in Asia/Shanghai explicitly", () => {
    const formatter = vi.spyOn(Date.prototype, "toLocaleDateString");
    render(<VerificationForm initialVerifications={[record]} uploadEnabled={false} />);
    expect(formatter).toHaveBeenCalledWith("zh-CN", { timeZone: "Asia/Shanghai" });
  });
});
