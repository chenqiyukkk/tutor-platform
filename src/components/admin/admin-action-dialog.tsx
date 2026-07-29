"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type UserAction = { kind: "user"; status: "ACTIVE" | "SUSPENDED" };
type ReportAction = { kind: "report"; decision: "START_REVIEW" } | { kind: "report"; decision: "DISMISS" | "RESOLVE"; resolutionAction: "NONE" | "CONTENT_TAKEDOWN" | "ACCOUNT_SUSPENSION" };
type VerificationAction = { kind: "verification"; decision: "APPROVE" | "REJECT" };
type Action = UserAction | ReportAction | VerificationAction;

function endpoint(action: Action, id: string) {
  const resource = action.kind === "user" ? "users" : action.kind === "report" ? "reports" : "verifications";
  return `/api/admin/${resource}/${id}`;
}

function isIso(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value));
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).sort().join("|") === [...keys].sort().join("|"); }
function validResult(action: Action, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  const key = action.kind === "user" ? "user" : action.kind === "report" ? "report" : "verification";
  const dto = root[key];
  if (!dto || typeof dto !== "object" || Array.isArray(dto)) return false;
  const record = dto as Record<string, unknown>;
  if (!isIso(record.updatedAt) || !exactKeys(root, [key])) return false;
  if (action.kind === "user") return exactKeys(record, ["status", "updatedAt"]) && record.status === action.status;
  if (action.kind === "report") {
    const expectedStatus = action.decision === "START_REVIEW" ? "REVIEWING" : action.decision === "DISMISS" ? "DISMISSED" : "RESOLVED";
    const expectedResolution = action.decision === "START_REVIEW" ? null : action.resolutionAction;
    return exactKeys(record, ["status", "updatedAt", "resolutionAction"]) && record.status === expectedStatus && record.resolutionAction === expectedResolution;
  }
  const expectedStatus = action.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  return exactKeys(record, ["status", "updatedAt", "reviewedAt"]) && record.status === expectedStatus && isIso(record.reviewedAt);
}

function needsText(action: Action) {
  return action.kind === "user" || (action.kind === "report" && action.decision !== "START_REVIEW") || (action.kind === "verification" && action.decision === "REJECT");
}

type AdminActionDialogProps = {
  targetId: string;
  expectedUpdatedAt: string;
  action: Action;
  title: string;
  triggerLabel: string;
  reasonOptions?: readonly string[];
  onSuccess?: () => void;
};

function AdminActionDialogInner({ targetId, expectedUpdatedAt, action, title, triggerLabel, reasonOptions = [], onSuccess }: AdminActionDialogProps) {
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const requestIdRef = useRef<{ id: string; fingerprint: string } | null>(null);
  const [category, setCategory] = useState(reasonOptions[0] ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    if (!result) return;
    const shared = document.getElementById("admin-action-result");
    if (shared) shared.textContent = result;
    (shared ?? resultRef.current)?.focus();
  }, [result]);

  function open() {
    setError(""); setResult("");
    const shared = document.getElementById("admin-action-result");
    if (shared) shared.textContent = "";
    dialogRef.current?.showModal();
    firstRef.current?.focus();
  }
  function close() { dialogRef.current?.close(); }
  function changeCategory(value: string) { requestIdRef.current = null; setError(""); setCategory(value); }
  function changeNote(value: string) { requestIdRef.current = null; setError(""); setNote(value); }
  function writeAnnouncement(message: string) {
    const shared = document.getElementById("admin-action-result");
    if (shared) shared.textContent = message;
    else setResult(message);
    return shared;
  }
  function focusAnnouncement(shared: HTMLElement | null) {
    if (shared) queueMicrotask(() => shared.focus());
  }

  async function submit() {
    if (busy) return;
    const text = [category, note.trim()].filter(Boolean).join("：").slice(0, 300);
    if (needsText(action) && text.length < 2) { setError("请填写至少 2 个字的处理原因。" ); return; }
    const intent = { targetId, expectedUpdatedAt, action, category, note: note.trim() };
    const fingerprint = JSON.stringify(intent);
    if (requestIdRef.current?.fingerprint !== fingerprint) requestIdRef.current = { id: crypto.randomUUID(), fingerprint };
    const body: Record<string, unknown> = { clientRequestId: requestIdRef.current.id, expectedUpdatedAt };
    if (action.kind === "user") { body.status = action.status; body.reason = text; }
    if (action.kind === "report") {
      body.decision = action.decision;
      if (action.decision !== "START_REVIEW") { body.resolutionAction = action.resolutionAction; body.reviewNote = text; }
    }
    if (action.kind === "verification") {
      body.decision = action.decision;
      if (action.decision === "REJECT") body.reviewNote = text;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint(action, targetId), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json: unknown = await response.json().catch(() => null);
      if (response.status === 409) {
        const message = "数据已被其他管理员更新，正在刷新列表。";
        requestIdRef.current = null;
        setError(message);
        const shared = writeAnnouncement(message);
        if (shared) dialogRef.current?.close();
        focusAnnouncement(shared);
        router.refresh();
        return;
      }
      if (!response.ok) { setError("操作未完成，请检查网络后重试。" ); return; }
      if (!validResult(action, json)) { setError("服务器返回的数据无法确认，请刷新后重试。" ); return; }
      requestIdRef.current = null;
      const shared = writeAnnouncement(`${title}已完成`);
      dialogRef.current?.close();
      focusAnnouncement(shared);
      onSuccess?.();
      router.refresh();
    } catch { setError("操作未完成，请检查网络后重试。" ); }
    finally { setBusy(false); }
  }

  return <div className="admin-action">
    <button className="admin-action__trigger" type="button" ref={triggerRef} onClick={open}>{triggerLabel}</button>
    <dialog className="admin-action-dialog" ref={dialogRef} aria-labelledby={titleId} onClose={() => { if (!result && !document.getElementById("admin-action-result")?.textContent) triggerRef.current?.focus(); }} onCancel={(event) => { if (busy) event.preventDefault(); else setError(""); }}>
      <div className="admin-action-dialog__sheet">
        <header><p className="eyebrow">需要明确确认</p><h2 id={titleId}>{title}</h2></header>
        {needsText(action) && reasonOptions.length ? <label>原因分类<select ref={firstRef as React.RefObject<HTMLSelectElement>} value={category} disabled={busy} onChange={(event) => changeCategory(event.target.value)}>{reasonOptions.map((option) => <option key={option}>{option}</option>)}</select></label> : null}
        {needsText(action) ? <label>{reasonOptions.length ? "补充说明（可选）" : "审核说明"}<textarea ref={!reasonOptions.length ? firstRef as React.RefObject<HTMLTextAreaElement> : undefined} value={note} maxLength={reasonOptions.length ? 280 : 300} required={!reasonOptions.length} disabled={busy} onChange={(event) => changeNote(event.target.value)} /></label> : <p>此操作会使用页面加载时的版本进行并发校验。</p>}
        {error ? <div role="alert"><p>{error}</p>{!error.includes("正在刷新") ? <button type="button" disabled={busy} onClick={submit}>重试</button> : null}</div> : null}
        <footer><button type="button" onClick={close} disabled={busy}>取消</button><button ref={!needsText(action) ? firstRef as React.RefObject<HTMLButtonElement> : undefined} type="button" onClick={submit} disabled={busy}>{busy ? "处理中…" : `确认${title}`}</button></footer>
      </div>
    </dialog>
    <div className="admin-action__result" aria-live="polite">{result ? <h2 ref={resultRef} tabIndex={-1}>{result}</h2> : null}</div>
  </div>;
}

export function AdminActionDialog(props: AdminActionDialogProps) {
  const scope = JSON.stringify({
    targetId: props.targetId,
    expectedUpdatedAt: props.expectedUpdatedAt,
    action: props.action,
    reasonOptions: props.reasonOptions ?? [],
  });
  return <AdminActionDialogInner key={scope} {...props} />;
}
