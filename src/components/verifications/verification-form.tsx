"use client";

import { useRef, useState } from "react";

type VerificationStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
type VerificationDto = {
  id: string;
  type: string;
  status: VerificationStatus;
  submittedAt: string;
  reviewedAt: string | null;
  expiresAt: string | null;
  reviewNote: string | null;
};

const typeLabels: Record<string, string> = {
  STUDENT_STATUS: "在读身份",
  EDUCATION: "学历",
  TEACHER_QUALIFICATION: "教师资格",
};

const statusLabels: Record<VerificationStatus, string> = {
  PENDING: "等待审核",
  APPROVED: "已通过",
  REJECTED: "未通过",
  EXPIRED: "已过期",
};

const verificationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isNullableDateString(value: unknown): value is string | null {
  return value === null || isDateString(value);
}

function isVerificationDto(value: unknown): value is VerificationDto {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "expiresAt,id,reviewNote,reviewedAt,status,submittedAt,type") return false;
  return typeof value.id === "string"
    && verificationIdPattern.test(value.id)
    && Object.hasOwn(typeLabels, String(value.type))
    && ["PENDING", "APPROVED", "REJECTED", "EXPIRED"].includes(String(value.status))
    && isDateString(value.submittedAt)
    && isNullableDateString(value.reviewedAt)
    && isNullableDateString(value.expiresAt)
    && (value.reviewNote === null || typeof value.reviewNote === "string");
}

function verificationFromPayload(value: unknown) {
  if (!isRecord(value) || Object.keys(value).join(",") !== "verification" || !isVerificationDto(value.verification)) return null;
  return value.verification;
}

export function VerificationForm({
  initialVerifications,
  uploadEnabled,
}: {
  initialVerifications: VerificationDto[];
  uploadEnabled: boolean;
}) {
  const [records, setRecords] = useState(initialVerifications);
  const [type, setType] = useState("STUDENT_STATUS");
  const [file, setFile] = useState<File | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  function beginNewIntent(nextFile: File | null, nextType = type) {
    setFile(nextFile);
    setType(nextType);
    setIntentId(null);
    setError(null);
    setAnnouncement("");
  }

  async function submit() {
    if (!file || busy) return;
    const requestId = intentId ?? crypto.randomUUID();
    if (!intentId) setIntentId(requestId);
    const body = new FormData();
    body.set("type", type);
    body.set("clientRequestId", requestId);
    body.set("file", file);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/teacher/verifications", { method: "POST", body });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "提交失败，请重试");
      }
      const verification = verificationFromPayload(payload);
      if (!verification) throw new Error("服务响应无效，请重试");
      setRecords((current) => [verification, ...current.filter(({ id }) => id !== verification.id)]);
      setAnnouncement(`${typeLabels[verification.type] ?? "认证"}认证材料已提交`);
      setFile(null);
      setIntentId(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "提交失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="verification-workspace">
      <section className="verification-notice" aria-labelledby="verification-notice-title">
        <p className="eyebrow">公共说明</p>
        <h2 id="verification-notice-title">认证完全自愿</h2>
        <p>未认证不影响浏览、匹配或沟通，也不是付费等级。认证原件永不公开，仅供平台审核。</p>
      </section>

      {uploadEnabled ? (
        <form className="verification-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div>
            <p className="eyebrow">提交材料</p>
            <h2>选择一种认证</h2>
            <p>图片只接受 JPEG 或 PNG，最大 5 MiB。选择文件后仍需手动提交，不会自动上传。</p>
          </div>
          <label>
            认证类型
            <select disabled={busy} onChange={(event) => beginNewIntent(file, event.target.value)} value={type}>
              <option value="STUDENT_STATUS">在读身份</option>
              <option value="EDUCATION">学历</option>
              <option value="TEACHER_QUALIFICATION">教师资格</option>
            </select>
          </label>
          <label>
            选择认证图片
            <input
              accept="image/jpeg,image/png"
              disabled={busy}
              onChange={(event) => beginNewIntent(event.target.files?.[0] ?? null)}
              ref={fileInput}
              type="file"
            />
          </label>
          <button className="button button--primary" disabled={!file || busy} type="submit">
            {busy ? "正在安全提交…" : "提交认证材料"}
          </button>
          {error ? <div className="verification-form__error" role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={() => { void submit(); }} type="button">重试提交</button></div> : null}
        </form>
      ) : (
        <section className="verification-unavailable" aria-labelledby="verification-unavailable-title">
          <p className="eyebrow">材料通道</p>
          <h2 id="verification-unavailable-title">认证材料上传暂未开放</h2>
          <p>你仍可正常完善资料、浏览需求和站内沟通，开放后再自愿决定是否提交。</p>
        </section>
      )}

      <p aria-live="polite" className="verification-announcement" role="status">{announcement}</p>
      <section className="verification-history" aria-labelledby="verification-history-title">
        <header><p className="eyebrow">审核记录</p><h2 id="verification-history-title">我的认证</h2></header>
        {records.length === 0 ? <p className="verification-history__empty">还没有认证记录。</p> : (
          <ol>
            {records.map((record) => (
              <li key={record.id}>
                <div><strong>{typeLabels[record.type] ?? "认证"}</strong><span className={`verification-status verification-status--${record.status.toLowerCase()}`}>{statusLabels[record.status]}</span></div>
                <p>提交于 {dateLabel(record.submittedAt) ?? "日期未知"}{record.reviewedAt ? ` · 审核于 ${dateLabel(record.reviewedAt)}` : ""}</p>
                {record.expiresAt ? <p>有效期至 {dateLabel(record.expiresAt)}</p> : null}
                {record.reviewNote ? <p className="verification-history__note"><strong>审核说明：</strong>{record.reviewNote}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
