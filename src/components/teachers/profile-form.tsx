"use client";

import { useState } from "react";

import { RegionPicker } from "@/components/forms/region-picker";
import type { RegionDto } from "@/features/regions/schema";
import type { TeacherIdentityType } from "@/features/teachers/schema";
import type { TeacherProfile } from "@/features/teachers/service";

import { ProfileCard } from "./profile-card";

type SubjectOption = { id: string; name: string };
type FieldErrors = Record<string, string[]>;

type EditableProfile = {
  publicNickname: string;
  identityType: TeacherIdentityType | null;
  bio: string;
  yearsExperience: number | null;
  online: boolean;
  rateMinCents: number | null;
  rateMaxCents: number | null;
  subjectIds: string[];
  primaryRegionId: string | null;
  extraRegionIds: string[];
};

function initialValues(profile: TeacherProfile | null): EditableProfile {
  return {
    publicNickname: profile?.publicNickname ?? "",
    identityType: profile?.identityType ?? null,
    bio: profile?.bio ?? "",
    yearsExperience: profile?.yearsExperience ?? null,
    online: profile?.online ?? false,
    rateMinCents: profile?.rateMinCents ?? null,
    rateMaxCents: profile?.rateMaxCents ?? null,
    subjectIds: profile?.subjects.map(({ id }) => id) ?? [],
    primaryRegionId: profile?.primaryRegion?.id ?? null,
    extraRegionIds: profile?.extraRegions.map(({ id }) => id) ?? [],
  };
}

function centsFromInput(value: string) {
  if (!value) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function ProfileForm({
  initialProfile,
  subjects,
}: {
  initialProfile: TeacherProfile | null;
  subjects: SubjectOption[];
}) {
  const [values, setValues] = useState(() => initialValues(initialProfile));
  const [savedProfile, setSavedProfile] = useState(initialProfile);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [regionNames, setRegionNames] = useState(() => new Map([
    ...(initialProfile?.primaryRegion ? [[initialProfile.primaryRegion.id, initialProfile.primaryRegion.name] as const] : []),
    ...(initialProfile?.extraRegions.map(({ id, name }) => [id, name] as const) ?? []),
  ]));

  function rememberRegion(region?: RegionDto) {
    if (!region) return;
    setRegionNames((current) => {
      const next = new Map(current);
      next.set(region.id, region.name);
      return next;
    });
  }

  const previewProfile: TeacherProfile = {
    id: savedProfile?.id ?? "preview",
    accountId: savedProfile?.accountId ?? "preview",
    publicNickname: values.publicNickname,
    identityType: values.identityType,
    bio: values.bio || null,
    yearsExperience: values.yearsExperience,
    online: values.online,
    rateMinCents: values.rateMinCents,
    rateMaxCents: values.rateMaxCents,
    status: savedProfile?.status ?? "DRAFT",
    publishedAt: savedProfile?.publishedAt ?? null,
    subjects: subjects.filter(({ id }) => values.subjectIds.includes(id)),
    primaryRegion: values.primaryRegionId
      ? { id: values.primaryRegionId, name: regionNames.get(values.primaryRegionId) ?? "新选择区县" }
      : null,
    extraRegions: values.extraRegionIds.map((id) => ({ id, name: regionNames.get(id) ?? "新选择区县" })),
  };

  function errorFor(field: string) {
    const messages = fieldErrors[field];
    return messages?.length ? <p className="form-field__error" role="alert">{messages[0]}</p> : null;
  }

  async function saveDraft(successMessage = "草稿已保存") {
    setBusy(true);
    setNotice("");
    setFieldErrors({});
    try {
      const response = await fetch("/api/teacher/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) {
        setFieldErrors(payload.fieldErrors ?? {});
        setNotice(payload.error ?? "保存失败，请稍后重试");
        return null;
      }
      setSavedProfile(payload.profile);
      const saved = payload.profile as TeacherProfile;
      setRegionNames((current) => new Map([
        ...current,
        ...(saved.primaryRegion ? [[saved.primaryRegion.id, saved.primaryRegion.name] as const] : []),
        ...saved.extraRegions.map(({ id, name }) => [id, name] as const),
      ]));
      setNotice(successMessage);
      return saved;
    } catch {
      setNotice("网络连接异常，请稍后重试");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function changePublication(action: "publish" | "unpublish") {
    if (action === "publish" && !await saveDraft("资料已保存，正在发布")) return;
    setBusy(true);
    setFieldErrors({});
    try {
      const response = await fetch("/api/teacher/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setFieldErrors(payload.fieldErrors ?? {});
        setNotice(payload.error ?? "操作失败，请稍后重试");
        return;
      }
      setSavedProfile(payload.profile);
      setNotice(action === "publish" ? "资料已发布" : "资料已下架并转为草稿");
    } catch {
      setNotice("网络连接异常，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-workspace">
      <form className="teacher-profile-form" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
        <section className="profile-form-section">
          <div className="profile-form-section__title"><span>01</span><div><h2>公开名片</h2><p>这些信息会展示给正在寻找老师的家长。</p></div></div>
          <div className="profile-form-grid">
            <div className="form-field">
              <label htmlFor="publicNickname">公开昵称</label>
              <input id="publicNickname" maxLength={40} value={values.publicNickname} onChange={(event) => setValues({ ...values, publicNickname: event.target.value })} />
              {errorFor("publicNickname")}
            </div>
            <div className="form-field">
              <label htmlFor="identityType">身份类型</label>
              <select id="identityType" value={values.identityType ?? ""} onChange={(event) => setValues({ ...values, identityType: (event.target.value || null) as TeacherIdentityType | null })}>
                <option value="">请选择身份</option>
                <option value="UNIVERSITY_STUDENT">在校大学生</option>
                <option value="FULL_TIME_TEACHER">全职教师</option>
                <option value="OTHER">其他教育从业者</option>
              </select>
              {errorFor("identityType")}
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="bio">个人简介与教学经历</label>
            <textarea id="bio" maxLength={2000} rows={6} value={values.bio} onChange={(event) => setValues({ ...values, bio: event.target.value })} />
            <p className="form-field__hint">建议说明擅长阶段、教学方法与代表性经历，发布时至少 20 字。</p>
            {errorFor("bio")}
          </div>
          <div className="profile-form-grid profile-form-grid--three">
            <div className="form-field">
              <label htmlFor="yearsExperience">教学年限</label>
              <input id="yearsExperience" min="0" max="80" type="number" value={values.yearsExperience ?? ""} onChange={(event) => setValues({ ...values, yearsExperience: event.target.value ? Number(event.target.value) : null })} />
              {errorFor("yearsExperience")}
            </div>
            <div className="form-field">
              <label htmlFor="rateMin">最低时薪（元）</label>
              <input id="rateMin" min="0" max="1000" step="1" type="number" value={values.rateMinCents === null ? "" : values.rateMinCents / 100} onChange={(event) => setValues({ ...values, rateMinCents: centsFromInput(event.target.value) })} />
              {errorFor("rateMinCents")}
            </div>
            <div className="form-field">
              <label htmlFor="rateMax">最高时薪（元）</label>
              <input id="rateMax" min="0" max="1000" step="1" type="number" value={values.rateMaxCents === null ? "" : values.rateMaxCents / 100} onChange={(event) => setValues({ ...values, rateMaxCents: centsFromInput(event.target.value) })} />
              {errorFor("rateMaxCents")}
            </div>
          </div>
          <label className="profile-checkbox profile-checkbox--online">
            <input checked={values.online} type="checkbox" onChange={(event) => setValues({ ...values, online: event.target.checked })} />
            <span><strong>支持线上授课</strong><small>允许家长在地区之外看到你的线上服务</small></span>
          </label>
        </section>

        <section className="profile-form-section">
          <div className="profile-form-section__title"><span>02</span><div><h2>授课科目</h2><p>至少选择一个目前可授课的科目。</p></div></div>
          <div className="subject-options">
            {subjects.map((subject) => (
              <label className="profile-checkbox" key={subject.id}>
                <input checked={values.subjectIds.includes(subject.id)} type="checkbox" onChange={(event) => setValues({ ...values, subjectIds: event.target.checked ? [...values.subjectIds, subject.id] : values.subjectIds.filter((id) => id !== subject.id) })} />
                <span><strong>{subject.name}</strong></span>
              </label>
            ))}
          </div>
          {errorFor("subjectIds")}
        </section>

        <section className="profile-form-section">
          <div className="profile-form-section__title"><span>03</span><div><h2>授课地区</h2><p>选择一个主地区，可再添加最多四个额外区县。</p></div></div>
          {values.primaryRegionId ? <p className="selected-region">主地区：<strong>{regionNames.get(values.primaryRegionId) ?? "新选择区县"}</strong><button type="button" onClick={() => setValues({ ...values, primaryRegionId: null })}>移除</button></p> : null}
          <RegionPicker onChange={(primaryRegionId, region) => {
            rememberRegion(region);
            setValues({ ...values, primaryRegionId });
          }} />
          {errorFor("primaryRegionId")}
          <div className="extra-regions">
            <h3>额外地区 <span>{values.extraRegionIds.length}/4</span></h3>
            {values.extraRegionIds.map((id) => <p className="selected-region" key={id}>{regionNames.get(id) ?? "新选择区县"}<button type="button" onClick={() => setValues({ ...values, extraRegionIds: values.extraRegionIds.filter((regionId) => regionId !== id) })}>移除</button></p>)}
            {values.extraRegionIds.length < 4 ? <RegionPicker onChange={(id, region) => {
              if (id && id !== values.primaryRegionId && !values.extraRegionIds.includes(id)) {
                rememberRegion(region);
                setValues({ ...values, extraRegionIds: [...values.extraRegionIds, id] });
              }
            }} /> : null}
            {errorFor("extraRegionIds")}
          </div>
        </section>

        <div className="profile-form-actions">
          <button className="button button--outline" disabled={busy} type="submit">保存草稿</button>
          <button className="button button--ghost" disabled={busy} type="button" onClick={() => setShowPreview((visible) => !visible)}>预览公开资料</button>
          {savedProfile?.status === "PUBLISHED"
            ? <button className="button button--outline" disabled={busy} type="button" onClick={() => void changePublication("unpublish")}>下架资料</button>
            : <button className="button button--primary" disabled={busy} type="button" onClick={() => void changePublication("publish")}>发布资料</button>}
        </div>
        {notice ? <p className="profile-form-notice" role="status">{notice}</p> : null}
      </form>
      {showPreview ? <aside className="profile-preview-panel"><p className="eyebrow">家长视角预览</p><ProfileCard profile={previewProfile} /></aside> : null}
    </div>
  );
}
