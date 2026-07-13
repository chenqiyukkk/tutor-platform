"use client";

import { useEffect, useRef, useState } from "react";

export function BlockConversationDialog({
  busy,
  error,
  onClose,
  onConfirm,
  open,
}: {
  busy: boolean;
  error: string | null;
  onClose(): void;
  onConfirm(reason: string): void;
  open: boolean;
}) {
  const [reason, setReason] = useState("");
  const input = useRef<HTMLTextAreaElement | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const length = Array.from(reason.trim()).length;
  const valid = length >= 2 && length <= 200;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (!element.open) element.showModal();
      input.current?.focus();
    } else if (element.open) {
      element.close();
    }
  }, [open]);

  function close() {
    if (!busy) dialog.current?.close();
  }

  return (
    <dialog
      aria-labelledby="chat-block-title"
      className="chat-block-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        setReason("");
        onClose();
      }}
      ref={dialog}
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
          <button className="button button--outline" disabled={busy} onClick={close} type="button">取消</button>
          <button className="button button--primary" disabled={!valid || busy} type="submit">
            {busy ? "正在屏蔽…" : "确认屏蔽"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
