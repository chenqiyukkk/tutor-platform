"use client";

import { useEffect, useRef, useState } from "react";

export function BlockConversationDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(reason: string): void;
}) {
  const [reason, setReason] = useState("");
  const input = useRef<HTMLTextAreaElement | null>(null);
  const length = Array.from(reason.trim()).length;
  const valid = length >= 2 && length <= 200;

  useEffect(() => { input.current?.focus(); }, []);
  return (
    <div
      aria-labelledby="chat-block-title"
      aria-modal="true"
      className="chat-block-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
      role="dialog"
    >
      <form onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onConfirm(reason.trim());
      }}>
        <h2 id="chat-block-title">屏蔽对方</h2>
        <p>屏蔽后双方都不能继续发送消息，既有历史仍会保留。</p>
        <label>
          屏蔽原因
          <textarea
            onChange={(event) => setReason(event.target.value)}
            ref={input}
            required
            rows={4}
            value={reason}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="greeting-card__actions">
          <button className="button button--outline" disabled={busy} onClick={onCancel} type="button">取消</button>
          <button className="button button--primary" disabled={!valid || busy} type="submit">
            {busy ? "正在屏蔽…" : "确认屏蔽"}
          </button>
        </div>
      </form>
    </div>
  );
}
