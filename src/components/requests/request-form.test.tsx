import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RequestForm } from "./request-form";

const student = { id: "22222222-2222-4222-8222-222222222222", publicAlias: "小树", grade: "GRADE_8" as const, notes: null, isActive: true };

describe("RequestForm", () => {
  it("gives an explicit blocking message when there are no active subjects", () => {
    render(<RequestForm initialRequest={null} students={[student]} subjects={[]} fetchRegions={async () => []} />);
    expect(screen.getByRole("alert")).toHaveTextContent("暂无可选科目");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });

  it("locks mutations while a save is pending", async () => {
    const user = userEvent.setup();
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetcher = vi.fn(() => pending);
    render(<RequestForm initialRequest={null} students={[student]} subjects={[{ id: "44444444-4444-4444-8444-444444444444", name: "数学" }]} fetchRegions={async () => []} fetcher={fetcher} />);
    const save = screen.getByRole("button", { name: "保存草稿" });
    await user.click(save);
    await user.click(save);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    resolve(new Response(JSON.stringify({ request: { id: "11111111-1111-4111-8111-111111111111", status: "DRAFT" } }), { status: 201, headers: { "content-type": "application/json" } }));
  });
});
