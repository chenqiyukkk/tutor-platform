import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { RegionDto } from "@/features/regions/service";
import { RegionPicker, type FetchRegions } from "./region-picker";

const province = { id: "province-1", code: "440000", name: "广东省", level: 1, parentId: null };
const provinceTwo = { id: "province-2", code: "450000", name: "广西壮族自治区", level: 1, parentId: null };
const cityOne = { id: "city-1", code: "440100", name: "广州市", level: 2, parentId: province.id };
const cityTwo = { id: "city-2", code: "440300", name: "深圳市", level: 2, parentId: province.id };
const district = { id: "district-1", code: "440106", name: "天河区", level: 3, parentId: cityOne.id };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

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

  it("does not let stale province results overwrite the latest cities", async () => {
    const firstCities = deferred<RegionDto[]>();
    const secondCities = deferred<RegionDto[]>();
    const latestCity = { ...cityTwo, id: "latest-city", parentId: provinceTwo.id, name: "南宁市" };
    const fetchRegions = vi.fn(({ level, parentId }) => {
      if (level === 1) return Promise.resolve([province, provinceTwo]);
      if (parentId === province.id) return firstCities.promise;
      if (parentId === provinceTwo.id) return secondCities.promise;
      return Promise.resolve([]);
    }) as FetchRegions;
    render(<RegionPicker fetchRegions={fetchRegions} onChange={vi.fn()} />);

    const provinceSelect = await screen.findByLabelText("省份");
    await userEvent.selectOptions(provinceSelect, province.id);
    await userEvent.selectOptions(provinceSelect, provinceTwo.id);
    secondCities.resolve([latestCity]);
    await screen.findByRole("option", { name: "南宁市" });

    firstCities.resolve([cityOne]);

    await waitFor(() => expect(screen.queryByRole("option", { name: "广州市" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("城市")).toHaveDisplayValue("请选择城市");
    expect(screen.getByRole("option", { name: "南宁市" })).toBeInTheDocument();
  });

  it("does not let a stale province rejection clear current loading or set an error", async () => {
    const firstCities = deferred<RegionDto[]>();
    const secondCities = deferred<RegionDto[]>();
    const fetchRegions = vi.fn(({ level, parentId }) => {
      if (level === 1) return Promise.resolve([province, provinceTwo]);
      if (parentId === province.id) return firstCities.promise;
      if (parentId === provinceTwo.id) return secondCities.promise;
      return Promise.resolve([]);
    }) as FetchRegions;
    render(<RegionPicker fetchRegions={fetchRegions} onChange={vi.fn()} />);

    const provinceSelect = await screen.findByLabelText("省份");
    await userEvent.selectOptions(provinceSelect, province.id);
    await userEvent.selectOptions(provinceSelect, provinceTwo.id);
    firstCities.reject(new Error("stale failure"));

    await waitFor(() => expect(fetchRegions).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("status")).toHaveTextContent("正在加载城市");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    secondCities.resolve([]);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("does not let stale city results overwrite the latest districts", async () => {
    const firstDistricts = deferred<RegionDto[]>();
    const secondDistricts = deferred<RegionDto[]>();
    const latestDistrict = { ...district, id: "latest-district", parentId: cityTwo.id, name: "南山区" };
    const fetchRegions = vi.fn(({ level, parentId }) => {
      if (level === 1) return Promise.resolve([province]);
      if (level === 2) return Promise.resolve([cityOne, cityTwo]);
      if (parentId === cityOne.id) return firstDistricts.promise;
      if (parentId === cityTwo.id) return secondDistricts.promise;
      return Promise.resolve([]);
    }) as FetchRegions;
    render(<RegionPicker fetchRegions={fetchRegions} onChange={vi.fn()} />);

    await userEvent.selectOptions(await screen.findByLabelText("省份"), province.id);
    const citySelect = await screen.findByLabelText("城市");
    await userEvent.selectOptions(citySelect, cityOne.id);
    await userEvent.selectOptions(citySelect, cityTwo.id);
    secondDistricts.resolve([latestDistrict]);
    await screen.findByRole("option", { name: "南山区" });

    firstDistricts.resolve([district]);

    await waitFor(() => expect(screen.queryByRole("option", { name: "天河区" })).not.toBeInTheDocument());
    expect(screen.getByRole("option", { name: "南山区" })).toBeInTheDocument();
  });
});
