"use client";

import Link from "next/link";
import { useState } from "react";

type Option = { id: string; name: string };
type Values = {
  district?: string;
  subject?: string;
  identityType?: "UNIVERSITY_STUDENT" | "FULL_TIME_TEACHER" | "OTHER";
  mode?: "ONLINE" | "OFFLINE";
  budgetMin?: number;
  budgetMax?: number;
};

export function FilterBar({
  kind,
  options,
  values,
}: {
  kind: "teachers" | "requests";
  options: { regions: Option[]; subjects: Option[] };
  values: Values;
}) {
  const teachers = kind === "teachers";
  const action = teachers ? "/teachers" : "/requests";
  const [district, setDistrict] = useState(values.district ?? "");
  const [subject, setSubject] = useState(values.subject ?? "");
  const [identityType, setIdentityType] = useState(values.identityType ?? "");
  const [mode, setMode] = useState(values.mode ?? "");
  const [budgetMin, setBudgetMin] = useState(values.budgetMin?.toString() ?? "");
  const [budgetMax, setBudgetMax] = useState(values.budgetMax?.toString() ?? "");
  return (
    <form
      action={action}
      aria-label={teachers ? "筛选老师" : "筛选家教需求"}
      className="directory-filter"
      method="get"
    >
      <label>
        <span>地区</span>
        <select name={district ? "district" : undefined} onChange={(event) => setDistrict(event.target.value)} value={district}>
          <option value="">全部区县</option>
          {options.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
      </label>
      <label>
        <span>科目</span>
        <select name={subject ? "subject" : undefined} onChange={(event) => setSubject(event.target.value)} value={subject}>
          <option value="">全部科目</option>
          {options.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
      </label>
      {teachers ? (
        <label>
          <span>教师身份</span>
          <select name={identityType ? "identityType" : undefined} onChange={(event) => setIdentityType(event.target.value as typeof identityType)} value={identityType}>
            <option value="">全部身份</option>
            <option value="UNIVERSITY_STUDENT">在校大学生</option>
            <option value="FULL_TIME_TEACHER">全职教师</option>
            <option value="OTHER">其他教育从业者</option>
          </select>
        </label>
      ) : null}
      <label>
        <span>上课方式</span>
        <select name={mode ? "mode" : undefined} onChange={(event) => setMode(event.target.value as typeof mode)} value={mode}>
          <option value="">线上或线下</option>
          <option value="OFFLINE">支持线下</option>
          <option value="ONLINE">支持线上</option>
        </select>
      </label>
      <label>
        <span>预算下限（分/小时）</span>
        <input min="0" name={budgetMin ? "budgetMin" : undefined} onChange={(event) => setBudgetMin(event.target.value)} placeholder="如 10000" step="100" type="number" value={budgetMin} />
      </label>
      <label>
        <span>预算上限（分/小时）</span>
        <input min="0" name={budgetMax ? "budgetMax" : undefined} onChange={(event) => setBudgetMax(event.target.value)} placeholder="如 20000" step="100" type="number" value={budgetMax} />
      </label>
      <div className="directory-filter__actions">
        <button className="button button--primary" type="submit">应用筛选</button>
        <Link className="text-link" href={action}>清除筛选</Link>
      </div>
    </form>
  );
}
