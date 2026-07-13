import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FilterBar } from "./filter-bar";

const options = {
  regions: [{ id: "region-id", name: "海淀区" }],
  subjects: [{ id: "subject-id", name: "数学" }],
};

describe("FilterBar", () => {
  it("uses a GET form so selected teacher filters remain in the URL", () => {
    render(<FilterBar kind="teachers" options={options} values={{
      district: "region-id",
      subject: "subject-id",
      identityType: "FULL_TIME_TEACHER",
      mode: "ONLINE",
      budgetMin: 10000,
      budgetMax: 20000,
    }} />);

    expect(screen.getByRole("form", { name: "筛选老师" })).toHaveAttribute("method", "get");
    expect(screen.getByRole("form", { name: "筛选老师" })).toHaveAttribute("action", "/teachers");
    expect(screen.getByLabelText("地区")).toHaveValue("region-id");
    expect(screen.getByLabelText("科目")).toHaveValue("subject-id");
    expect(screen.getByLabelText("教师身份")).toHaveValue("FULL_TIME_TEACHER");
    expect(screen.getByLabelText("上课方式")).toHaveValue("ONLINE");
    expect(screen.getByRole("link", { name: "清除筛选" })).toHaveAttribute("href", "/teachers");
  });

  it("does not offer teacher-only identity filtering for requests", () => {
    render(<FilterBar kind="requests" options={options} values={{}} />);

    expect(screen.getByRole("form", { name: "筛选家教需求" })).toHaveAttribute("action", "/requests");
    expect(screen.queryByLabelText("教师身份")).not.toBeInTheDocument();
  });

  it("submits no query entries when every native GET control is empty", () => {
    render(<FilterBar kind="teachers" options={options} values={{}} />);
    const form = screen.getByRole("form", { name: "筛选老师" }) as HTMLFormElement;

    expect([...new FormData(form).entries()]).toEqual([]);
  });

  it("submits only non-empty controls after a partial selection", async () => {
    const user = userEvent.setup();
    render(<FilterBar kind="teachers" options={options} values={{}} />);
    await user.selectOptions(screen.getByLabelText("地区"), "region-id");
    await user.type(screen.getByLabelText("预算下限（分/小时）"), "10000");
    const form = screen.getByRole("form", { name: "筛选老师" }) as HTMLFormElement;

    expect([...new FormData(form).entries()]).toEqual([
      ["district", "region-id"],
      ["budgetMin", "10000"],
    ]);
  });
});
