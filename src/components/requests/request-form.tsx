"use client";

import { useMemo, useRef, useState } from "react";

import { RegionPicker, type FetchRegions } from "@/components/forms/region-picker";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import type { Student, TeachingMode, TutoringRequestDto } from "@/features/requests/service";
import { RequestCard } from "./request-card";

type SubjectOption = { id: string; name: string };
type Props = {
  initialRequest: TutoringRequestDto | null;
  students: Student[];
  subjects: SubjectOption[];
  fetchRegions?: FetchRegions;
  fetcher?: typeof fetch;
};

function yuan(cents: number | null) { return cents === null ? "" : String(cents / 100); }
function cents(value: string) { return value.trim() === "" ? null : Math.round(Number(value) * 100); }

export function RequestForm({ initialRequest, students, subjects, fetchRegions, fetcher = fetch }: Props) {
  const [request, setRequest] = useState(initialRequest);
  const [studentId, setStudentId] = useState(initialRequest?.studentProfileId ?? "");
  const [subjectIds, setSubjectIds] = useState(initialRequest?.subjects.map(({ id }) => id) ?? []);
  const [regionId, setRegionId] = useState(initialRequest?.regionId ?? "");
  const [regionName, setRegionName] = useState(initialRequest?.region?.name ?? "");
  const [mode, setMode] = useState<TeachingMode | "">(initialRequest?.teachingMode ?? "");
  const [budgetMin, setBudgetMin] = useState(yuan(initialRequest?.budgetMinCents ?? null));
  const [budgetMax, setBudgetMax] = useState(yuan(initialRequest?.budgetMaxCents ?? null));
  const [schedule, setSchedule] = useState(initialRequest?.scheduleText ?? "");
  const [location, setLocation] = useState(initialRequest?.publicLocationNote ?? "");
  const [description, setDescription] = useState(initialRequest?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const selectedStudent = students.find(({ id }) => id === studentId) ?? null;
  const selectedSubjects = subjects.filter(({ id }) => subjectIds.includes(id));
  const preview = useMemo<TutoringRequestDto>(() => ({
    id: request?.id ?? "preview", studentProfileId: studentId || null, regionId: regionId || null,
    budgetMinCents: cents(budgetMin), budgetMaxCents: cents(budgetMax), teachingMode: mode || null,
    scheduleText: schedule || null, publicLocationNote: location || null, description: description || null,
    status: request?.status ?? "DRAFT", publishedAt: request?.publishedAt ?? null, closedAt: request?.closedAt ?? null,
    student: selectedStudent, subjects: selectedSubjects.map((subject) => ({ ...subject, isActive: true })),
    region: regionId ? { id: regionId, name: regionName || "已选区县", level: 3, isActive: true } : null,
  }), [budgetMax, budgetMin, description, location, mode, regionId, regionName, request, schedule, selectedStudent, selectedSubjects, studentId]);

  function payload() {
    return { studentId: studentId || null, subjectIds, regionId: regionId || null, budgetMinCents: cents(budgetMin), budgetMaxCents: cents(budgetMax), teachingMode: mode || null, scheduleText: schedule || null, publicLocationNote: location || null, description: description || null };
  }

  async function read(response: Response) {
    const body = await response.json();
    if (!response.ok) {
      setErrors(body.fieldErrors ?? {});
      throw new Error(body.error ?? "操作失败，请稍后重试");
    }
    return body.request as TutoringRequestDto;
  }

  async function save(signal: AbortSignal) {
    const id = request?.id;
    const response = await fetcher(id ? `/api/parent/requests/${id}` : "/api/parent/requests", {
      method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()), signal,
    });
    return read(response);
  }

  async function mutate(operation: (signal: AbortSignal) => Promise<{ result: TutoringRequestDto; message: string }>) {
    if (busy) return;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const currentSequence = ++sequence.current;
    setBusy(true); setNotice(null); setErrors({});
    try {
      const { result, message } = await operation(nextController.signal);
      if (sequence.current !== currentSequence) return;
      setRequest(result); setNotice(message);
      if (!initialRequest && result.id && window.location.pathname.endsWith("/new")) window.history.replaceState(null, "", `/parent/requests/${result.id}/edit`);
    } catch (error) {
      if (sequence.current === currentSequence && !nextController.signal.aborted) setNotice(error instanceof Error ? error.message : "操作失败，请稍后重试");
    } finally {
      if (sequence.current === currentSequence) setBusy(false);
    }
  }

  async function saveDraft() { await mutate(async (signal) => ({ result: await save(signal), message: "草稿已保存" })); }
  async function publish() {
    await mutate(async (signal) => {
      const draft = await save(signal);
      const response = await fetcher(`/api/parent/requests/${draft.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish" }), signal });
      return { result: await read(response), message: "需求已发布，教师现在可以看到它" };
    });
  }
  async function close() {
    if (!request?.id) return;
    await mutate(async (signal) => {
      const response = await fetcher(`/api/parent/requests/${request.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close" }), signal });
      return { result: await read(response), message: "需求已关闭" };
    });
  }

  return (
    <div className="request-workspace">
      <form className="parent-request-form" aria-busy={busy} noValidate onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
        {request?.status === "PUBLISHED" ? <p className="request-form-warning">编辑并保存后，需求会回到草稿；确认无误后请重新发布。</p> : null}
        {request?.status === "CLOSED" ? <p className="request-form-warning">该需求已关闭，首版不支持重新开启或编辑。</p> : null}
        <section className="request-form-section">
          <div><p className="eyebrow">01 · 学习目标</p><h2>为谁寻找老师？</h2></div>
          <FormField htmlFor="request-student" label="学生档案" required error={errors.studentId?.[0]}>
            <select disabled={busy || request?.status === "CLOSED"} value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">请选择学生</option>{students.map((item) => <option key={item.id} value={item.id}>{item.publicAlias}</option>)}</select>
          </FormField>
          <fieldset className="request-subjects"><legend>辅导科目（1–3 项）</legend>
            {subjects.length === 0 ? <p role="alert">暂无可选科目，请联系平台管理员启用科目后再创建需求。</p> : subjects.map((subject) => <label key={subject.id}><input checked={subjectIds.includes(subject.id)} disabled={busy || request?.status === "CLOSED" || (!subjectIds.includes(subject.id) && subjectIds.length >= 3)} type="checkbox" onChange={(event) => setSubjectIds(event.target.checked ? [...subjectIds, subject.id] : subjectIds.filter((id) => id !== subject.id))} /> <span>{subject.name}</span></label>)}
          </fieldset>
        </section>
        <section className="request-form-section">
          <div><p className="eyebrow">02 · 授课安排</p><h2>把边界说清楚</h2></div>
          <FormField htmlFor="request-mode" label="授课方式" required error={errors.teachingMode?.[0]}><select disabled={busy || request?.status === "CLOSED"} value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="">请选择方式</option><option value="OFFLINE">线下</option><option value="ONLINE">线上</option><option value="BOTH">线上 / 线下均可</option></select></FormField>
          <div className="request-form-grid"><FormField htmlFor="budget-min" label="最低预算（元/小时）" error={errors.budgetMinCents?.[0]}><input disabled={busy || request?.status === "CLOSED"} min="0" max="1000" step="0.01" type="number" value={budgetMin} onChange={(event) => setBudgetMin(event.target.value)} /></FormField><FormField htmlFor="budget-max" label="最高预算（元/小时）" error={errors.budgetMaxCents?.[0]}><input disabled={busy || request?.status === "CLOSED"} min="0" max="1000" step="0.01" type="number" value={budgetMax} onChange={(event) => setBudgetMax(event.target.value)} /></FormField></div>
          <FormField htmlFor="request-schedule" label="可授课时间" required error={errors.scheduleText?.[0]}><textarea disabled={busy || request?.status === "CLOSED"} maxLength={500} rows={3} value={schedule} onChange={(event) => setSchedule(event.target.value)} /></FormField>
        </section>
        <section className="request-form-section">
          <div><p className="eyebrow">03 · 区域与说明</p><h2>只公开必要的信息</h2></div>
          {regionName ? <p className="selected-region">当前区县：<strong>{regionName}</strong></p> : null}
          <RegionPicker disabled={busy || request?.status === "CLOSED"} {...(fetchRegions ? { fetchRegions } : {})} onChange={(id, district) => { setRegionId(id ?? ""); setRegionName(district?.name ?? ""); }} />
          {errors.regionId ? <p role="alert">{errors.regionId[0]}</p> : null}
          <FormField htmlFor="request-location" label="大致位置" required hint="例如“天河公园附近”。不要填写门牌、学校全称、手机号或精确住址。" error={errors.publicLocationNote?.[0]}><input disabled={busy || request?.status === "CLOSED"} maxLength={100} value={location} onChange={(event) => setLocation(event.target.value)} /></FormField>
          <FormField htmlFor="request-description" label="需求说明（可选）" error={errors.description?.[0]}><textarea disabled={busy || request?.status === "CLOSED"} maxLength={2000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></FormField>
        </section>
        {notice ? <p className="request-form-notice" role="status">{notice}</p> : null}
        <div className="request-form-actions">
          <Button disabled={busy || subjects.length === 0 || request?.status === "CLOSED"} type="submit">{busy ? "处理中…" : "保存草稿"}</Button>
          <Button disabled={busy || subjects.length === 0 || request?.status === "CLOSED"} onClick={() => void publish()} variant="secondary">发布需求</Button>
          {request?.id && request.status !== "CLOSED" ? <Button disabled={busy} onClick={() => void close()} variant="quiet">关闭需求</Button> : null}
        </div>
      </form>
      <aside className="request-preview-panel" aria-label="需求预览"><p className="eyebrow">公开预览</p><RequestCard request={preview} /></aside>
    </div>
  );
}
