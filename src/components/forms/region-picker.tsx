"use client";

import { useEffect, useId, useRef, useState } from "react";

import { regionDtoListSchema, type RegionDto } from "@/features/regions/schema";

type FetchRegionOptions = {
  signal?: AbortSignal;
};

export type FetchRegions = (query: {
  level?: 1 | 2 | 3;
  parentId?: string;
}, options?: FetchRegionOptions) => Promise<RegionDto[]>;

async function fetchRegionsFromApi(
  query: Parameters<FetchRegions>[0],
  options?: FetchRegionOptions,
) {
  const searchParams = new URLSearchParams();
  if (query.level !== undefined) searchParams.set("level", String(query.level));
  if (query.parentId !== undefined) searchParams.set("parentId", query.parentId);
  const response = await fetch(`/api/regions?${searchParams.toString()}`, {
    signal: options?.signal,
  });
  if (!response.ok) throw new Error("Failed to fetch regions");
  const regions: unknown = await response.json();
  return regionDtoListSchema.parse(regions);
}

type RegionPickerProps = {
  fetchRegions?: FetchRegions;
  onChange: (districtId: string | null, district?: RegionDto) => void;
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
  const requestSequence = useRef<Record<2 | 3, number>>({ 2: 0, 3: 0 });
  const controllers = useRef<Partial<Record<1 | 2 | 3, AbortController>>>({});

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    controllers.current[1] = controller;
    fetchRegions({ level: 1 }, { signal: controller.signal })
      .then((regions) => {
        if (active) setProvinces(regions);
      })
      .catch(() => {
        if (active) setError("区域加载失败，请稍后重试");
      })
      .finally(() => {
        if (active && controllers.current[1] === controller) {
          controllers.current[1] = undefined;
          setLoadingLevel(null);
        }
      });
    return () => {
      active = false;
      for (const pendingController of Object.values(controllers.current)) {
        pendingController?.abort();
      }
      controllers.current = {};
    };
  }, [fetchRegions]);

  async function loadChildren(level: 2 | 3, parentId: string) {
    controllers.current[level]?.abort();
    const controller = new AbortController();
    controllers.current[level] = controller;
    const sequence = ++requestSequence.current[level];
    setLoadingLevel(level);
    setError(null);
    try {
      const regions = await fetchRegions({ level, parentId }, { signal: controller.signal });
      if (requestSequence.current[level] !== sequence) return;
      if (level === 2) setCities(regions);
      else setDistricts(regions);
    } catch {
      if (requestSequence.current[level] !== sequence) return;
      setError("区域加载失败，请稍后重试");
    } finally {
      if (
        requestSequence.current[level] === sequence &&
        controllers.current[level] === controller
      ) {
        controllers.current[level] = undefined;
        setLoadingLevel(null);
      }
    }
  }

  function changeProvince(nextProvinceId: string) {
    controllers.current[2]?.abort();
    controllers.current[3]?.abort();
    controllers.current[2] = undefined;
    controllers.current[3] = undefined;
    requestSequence.current[2] += 1;
    requestSequence.current[3] += 1;
    setProvinceId(nextProvinceId);
    setCityId("");
    setDistrictId("");
    setCities([]);
    setDistricts([]);
    setLoadingLevel(null);
    setError(null);
    onChange(null);
    if (nextProvinceId) void loadChildren(2, nextProvinceId);
  }

  function changeCity(nextCityId: string) {
    controllers.current[3]?.abort();
    controllers.current[3] = undefined;
    requestSequence.current[3] += 1;
    setCityId(nextCityId);
    setDistrictId("");
    setDistricts([]);
    setLoadingLevel(null);
    setError(null);
    onChange(null);
    if (nextCityId) void loadChildren(3, nextCityId);
  }

  function changeDistrict(nextDistrictId: string) {
    setDistrictId(nextDistrictId);
    onChange(
      nextDistrictId || null,
      districts.find((district) => district.id === nextDistrictId),
    );
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
