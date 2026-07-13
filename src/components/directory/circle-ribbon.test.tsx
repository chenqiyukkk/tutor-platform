import { render, screen } from "@testing-library/react";

import { CircleRibbon } from "./circle-ribbon";

describe("CircleRibbon", () => {
  it("does not invent personalized proximity for logged-out visitors", () => {
    render(<CircleRibbon />);

    expect(screen.getByText("登录后可查看你的地区圈层")).toBeInTheDocument();
    expect(screen.queryByText("同区匹配")).not.toBeInTheDocument();
    expect(screen.queryByText("邻区匹配")).not.toBeInTheDocument();
    expect(screen.queryByText("线上匹配")).not.toBeInTheDocument();
  });

  it.each([
    ["SAME_DISTRICT", "同区匹配"],
    ["ADJACENT_DISTRICT", "邻区匹配"],
    ["ONLINE", "线上匹配"],
  ] as const)("renders the deterministic %s label", (tier, label) => {
    render(<CircleRibbon tier={tier} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("distinguishes an authenticated account without a matching district", () => {
    render(<CircleRibbon authenticated />);

    expect(screen.getByText("完善地区后可查看你的圈层")).toBeInTheDocument();
    expect(screen.queryByText("登录后可查看你的地区圈层")).not.toBeInTheDocument();
  });
});
