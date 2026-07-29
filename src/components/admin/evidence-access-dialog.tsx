"use client";

import { useId, useRef } from "react";

export function EvidenceAccessDialog({ verificationId }: { verificationId: string }) {
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function open() {
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  return <div className="evidence-access">
    <button className="admin-action__trigger" ref={triggerRef} type="button" onClick={open}>查看材料入口</button>
    <dialog className="admin-action-dialog evidence-access-dialog" ref={dialogRef} aria-labelledby={titleId} onClose={() => triggerRef.current?.focus()}>
      <div className="admin-action-dialog__sheet">
        <header><p className="eyebrow">敏感材料 · 主动调阅</p><h2 id={titleId}>调阅敏感认证材料</h2></header>
        <p>认证原件可能包含个人身份信息，不会在列表中显示、预览或生成缩略图。</p>
        <p className="evidence-access__audit">每次调阅都会重新鉴权并写入审计。请仅在审核确有需要时继续。</p>
        <footer><button ref={cancelRef} type="button" onClick={() => dialogRef.current?.close()}>取消</button><a className="admin-evidence-link" href={`/api/admin/verifications/${verificationId}/evidence`} download>确认并下载证据</a></footer>
      </div>
    </dialog>
  </div>;
}
