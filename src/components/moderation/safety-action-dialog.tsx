"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { ModerationTarget } from "@/features/moderation/schema";

type SafetyAction = "report" | "block";

const labels = {
  report: { trigger: "举报此内容", title: "举报此内容", reason: "举报原因", confirm: "确认举报", retry: "重试举报" },
  block: { trigger: "屏蔽对方", title: "屏蔽对方", reason: "屏蔽原因", confirm: "确认屏蔽", retry: "重试屏蔽" },
} as const;

const reportStatuses = new Set(["PENDING", "REVIEWING", "RESOLVED", "DISMISSED"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function SafetyActionDialog({
  actions = ["report", "block"],
  blockLabel = "屏蔽对方",
  realm,
  reportLabel = "举报此内容",
  target,
}: {
  actions?: SafetyAction[];
  blockLabel?: string;
  realm: "parent" | "teacher";
  reportLabel?: string;
  target: ModerationTarget;
}) {
  const [action, setAction] = useState<SafetyAction | null>(null);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const reasonInput = useRef<HTMLTextAreaElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const actionLabel = action === "report" ? reportLabel : action === "block" ? blockLabel : "安全操作";
  const reasonLength = Array.from(reason.trim()).length;
  const valid = reasonLength >= 2 && reasonLength <= 200 && Array.from(details.trim()).length <= 1000;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (action) {
      if (!element.open) element.showModal();
      reasonInput.current?.focus();
    } else if (element.open) {
      element.close();
    }
  }, [action]);

  function open(nextAction: SafetyAction, event: React.MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    setAction(nextAction);
    setReason("");
    setDetails("");
    setError(null);
    setAnnouncement("");
    setClientRequestId(null);
  }

  function changeReason(value: string) {
    if (value !== reason) {
      setError(null);
      setClientRequestId(null);
    }
    setReason(value);
  }

  function changeDetails(value: string) {
    if (value !== details) {
      setError(null);
      setClientRequestId(null);
    }
    setDetails(value);
  }

  function close() {
    if (!busy) dialog.current?.close();
  }

  async function submit() {
    if (!action || !valid || busy) return;
    const currentAction = action;
    const requestId = currentAction === "report" ? (clientRequestId ?? crypto.randomUUID()) : null;
    if (currentAction === "report" && !clientRequestId) setClientRequestId(requestId);
    const body = currentAction === "report"
      ? { target, clientRequestId: requestId, reason: reason.trim(), ...(details.trim() ? { details: details.trim() } : {}) }
      : { target, reason: reason.trim() };
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/${currentAction === "report" ? "reports" : "blocks"}?realm=${realm}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : "操作失败，请重试";
        throw new Error(message);
      }
      const validPayload = currentAction === "report"
        ? isRecord(payload) && typeof payload.reportId === "string" && reportStatuses.has(String(payload.status))
        : isRecord(payload) && payload.blocked === true;
      if (!validPayload) throw new Error("服务响应无效，请重试");
      setAnnouncement(currentAction === "report" ? "举报已提交，屏蔽需另行确认。" : "已屏蔽对方，已有记录仍会保留。");
      dialog.current?.close();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="safety-actions">
      <div className="safety-actions__triggers" aria-label="安全操作">
        {actions.map((item) => <button className="text-button" key={item} onClick={(event) => open(item, event)} type="button">{item === "report" ? reportLabel : blockLabel}</button>)}
      </div>
      {announcement ? <p aria-live="polite" className="safety-actions__announcement" role="status">{announcement}</p> : null}
      <dialog
        aria-labelledby={titleId}
        aria-modal="true"
        className="safety-action-dialog"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClose={() => {
          setAction(null);
          setReason("");
          setDetails("");
          setError(null);
          const element = trigger.current;
          trigger.current = null;
          element?.focus();
        }}
        ref={dialog}
      >
        {action ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <p className="eyebrow">上下文安全入口</p>
          <h2 id={titleId}>{actionLabel}</h2>
          <p>{action === "report" ? "举报会提交给平台核查，不会自动屏蔽对方。" : "屏蔽会停止双方继续联系，不会自动创建举报。"}</p>
          <label>{labels[action].reason}<textarea disabled={busy} maxLength={200} onChange={(event) => changeReason(event.target.value)} ref={reasonInput} required rows={4} value={reason} /></label>
          {action === "report" ? <label>补充说明（选填）<textarea disabled={busy} maxLength={1000} onChange={(event) => changeDetails(event.target.value)} rows={4} value={details} /></label> : null}
          {error ? <p role="alert">{error}</p> : null}
          <div className="safety-action-dialog__footer">
            <button className="button button--outline" disabled={busy} onClick={close} type="button">取消</button>
            <button className="button button--primary" disabled={!valid || busy} type="submit">{busy ? "正在提交…" : error ? labels[action].retry : labels[action].confirm}</button>
          </div>
        </form> : null}
      </dialog>
    </div>
  );
}
