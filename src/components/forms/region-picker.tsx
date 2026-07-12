"use client";

import { useEffect, useId, useState } from "react";

import type { RegionDto } from "@/features/regions/service";

export type FetchRegions = (query: {
  level?: 1 | 2 | 3;
  parentId?: string;
}) => Promise<RegionDto[]>;

async function fetchRegionsFromApi(query: Parameters<FetchRegions>[0]) {
  const searchParams = new URLSearchParams();
  if (query.level !== undefined) searchParams.set("level", String(query.level));
  if (query.parentId !== undefined) searchParams.set("parentId", query.parentId);
  const response = await fetch(`/api/regions?${searchParams.toString()}`);
  if (!response.ok) throw new Error("Failed to fetch regions");
  const regions: unknown = await response.json();
  if (!Array.isArray(regions)) throw new Error("Invalid region response");
  return regions as RegionDto[];
}

type RegionPickerProps = {
  fetchRegions?: FetchRegions;
  onChange: (districtId: string | null) => void;
};

export function RegionPicker({
  fetchRegions = fetchRegionsFromApi,
  onChange,
}: RegionPickerProps) {
  const id = useId();
  const [provinces, setProvinces] = useState<RegionDto[]>([]);
  const [cities, setCities] = useState<RegionDto[]>([]);
  const [districts, setDistricts] = useState<RegionDto[]>([]);
  const [provinceId, setProvinceId] = useState("");
  const [cityId, setCityId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [loadingLevel, setLoadingLevel] = useState<1 | 2 | 3 | null>(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchRegions({ level: 1 })
      .then((regions) => {
        if (active) setProvinces(regions);
      })
      .catch(() => {
        if (active) setError("区域加载失败，请稍后重试");
      })
      .finally(() => {
        if (active) setLoadingLevel(null);
      });
    return () => {
      active = false;
    };
  }, [fetchRegions]);

  async function loadChildren(level: 2 | 3, parentId: string) {
    setLoadingLevel(level);
    setError(null);
    try {
      const regions = await fetchRegions({ level, parentId });
      if (level === 2) setCities(regions);
      else setDistricts(regions);
    } catch {
      setError("区域加载失败，请稍后重试");
    } finally {
      setLoadingLevel(null);
    }
  }

  function changeProvince(nextProvinceId: string) {
    setProvinceId(nextProvinceId);
    setCityId("");
    setDistrictId("");
    setCities([]);
    setDistricts([]);
    onChange(null);
    if (nextProvinceId) void loadChildren(2, nextProvinceId);
  }

  function changeCity(nextCityId: string) {
    setCityId(nextCityId);
    setDistrictId("");
    setDistricts([]);
    onChange(null);
    if (nextCityId) void loadChildren(3, nextCityId);
  }

  function changeDistrict(nextDistrictId: string) {
    setDistrictId(nextDistrictId);
    onChange(nextDistrictId || null);
  }

  const loadingText = loadingLevel === 1
    ? "正在加载省份"
    : loadingLevel === 2
      ? "正在加载城市"
      : loadingLevel === 3
        ? "正在加载区县"
        : null;

  return (
    <fieldset className="region-picker">
      <legend>授课地区</legend>
      <div className="form-field">
        <label htmlFor={`${id}-province`}>省份</label>
        <select
          disabled={loadingLevel === 1 || provinces.length === 0}
          id={`${id}-province`}
          onChange={(event) => changeProvince(event.target.value)}
          value={provinceId}
        >
          <option value="">请选择省份</option>
          {provinces.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-city`}>城市</label>
        <select
          disabled={!provinceId || loadingLevel === 2 || cities.length === 0}
          id={`${id}-city`}
          onChange={(event) => changeCity(event.target.value)}
          value={cityId}
        >
          <option value="">请选择城市</option>
          {cities.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-district`}>区县</label>
        <select
          disabled={!cityId || loadingLevel === 3 || districts.length === 0}
          id={`${id}-district`}
          onChange={(event) => changeDistrict(event.target.value)}
          value={districtId}
        >
          <option value="">请选择区县</option>
          {districts.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
      </div>
      {loadingText ? <p aria-live="polite" role="status">{loadingText}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}
