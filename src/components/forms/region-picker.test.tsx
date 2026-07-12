import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RegionPicker, type FetchRegions } from "./region-picker";

const province = { id: "province-1", code: "440000", name: "广东省", level: 1, parentId: null };
const cityOne = { id: "city-1", code: "440100", name: "广州市", level: 2, parentId: province.id };
const cityTwo = { id: "city-2", code: "440300", name: "深圳市", level: 2, parentId: province.id };
const district = { id: "district-1", code: "440106", name: "天河区", level: 3, parentId: cityOne.id };

describe("RegionPicker", () => {
  it("loads dependent selects, emits only a district id, and clears descendants", async () => {
    const onChange = vi.fn();
    const fetchRegions = vi.fn(async ({ level, parentId }) => {
      if (level === 1) return [province];
      if (parentId === province.id) return [cityOne, cityTwo];
      if (parentId === cityOne.id) return [district];
      return [];
    }) as FetchRegions;
    render(<RegionPicker fetchRegions={fetchRegions} onChange={onChange} />);

    await userEvent.selectOptions(await screen.findByLabelText("省份"), province.id);
    await userEvent.selectOptions(await screen.findByLabelText("城市"), cityOne.id);
    await userEvent.selectOptions(await screen.findByLabelText("区县"), district.id);

    expect(onChange).toHaveBeenLastCalledWith(district.id);
    expect(screen.getByLabelText("区县")).toHaveDisplayValue("天河区");

    await userEvent.selectOptions(screen.getByLabelText("城市"), cityTwo.id);

    expect(screen.getByLabelText("区县")).toHaveValue("");
    expect(screen.getByLabelText("区县")).toBeDisabled();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("disables dependent controls while a request is loading", async () => {
    let resolveProvinces!: (regions: [typeof province]) => void;
    const fetchRegions: FetchRegions = () => new Promise((resolve) => {
      resolveProvinces = resolve as typeof resolveProvinces;
    });
    render(<RegionPicker fetchRegions={fetchRegions} onChange={vi.fn()} />);

    expect(screen.getByLabelText("省份")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载省份");

    resolveProvinces([province]);
    await waitFor(() => expect(screen.getByLabelText("省份")).toBeEnabled());
  });

  it("announces loading errors and leaves unavailable controls disabled", async () => {
    const fetchRegions: FetchRegions = async () => {
      throw new Error("network down");
    };
    render(<RegionPicker fetchRegions={fetchRegions} onChange={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("区域加载失败，请稍后重试");
    expect(screen.getByLabelText("省份")).toBeDisabled();
    expect(screen.getByLabelText("城市")).toBeDisabled();
    expect(screen.getByLabelText("区县")).toBeDisabled();
  });
});
