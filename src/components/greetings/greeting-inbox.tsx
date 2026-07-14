"use client";

import { useEffect, useRef, useState } from "react";

import { GreetingCard } from "./greeting-card";

type GreetingItem = React.ComponentProps<typeof GreetingCard>["item"];

async function fetchInbox(realm: "parent" | "teacher", box: "received" | "sent", cursor: string | null, signal: AbortSignal) {
  const query = `/api/greetings?realm=${realm}&box=${box}&pageSize=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const response = await fetch(query, { cache: "no-store", signal });
  if (!response.ok) throw new Error("load failed");
  return response.json() as Promise<{ items: GreetingItem[]; nextCursor?: string | null }>;
}

export function GreetingInbox({ realm }: { realm: "parent" | "teacher" }) {
  const [box, setBox] = useState<"received" | "sent">("received");
  const [items, setItems] = useState<GreetingItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [reasonRequest, setReasonRequest] = useState<{ id: string; action: "report" | "block" } | null>(null);
  const [reason, setReason] = useState("");
  const generation = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const reasonDialog = useRef<HTMLDialogElement | null>(null);
  const reasonInput = useRef<HTMLTextAreaElement | null>(null);
  const reasonTrigger = useRef<HTMLElement | null>(null);
  const cursor = cursorHistory[cursorIndex] ?? null;

  useEffect(() => {
    const currentGeneration = ++generation.current;
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    void fetchInbox(realm, box, cursor, controller.signal).then((data) => {
      if (currentGeneration === generation.current) {
        setItems(data.items); setNextCursor(data.nextCursor ?? null); setState("ready");
      }
    }).catch((error: unknown) => {
      if (currentGeneration === generation.current && !(error instanceof DOMException && error.name === "AbortError")) {
        setState("error");
      }
    });
    return () => controller.abort();
  }, [box, cursor, realm, reloadToken]);

  useEffect(() => {
    const dialog = reasonDialog.current;
    if (!dialog) return;
    if (reasonRequest) {
      if (!dialog.open) dialog.showModal();
      reasonInput.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [reasonRequest]);

  function invalidateView() {
    generation.current += 1;
    activeController.current?.abort();
  }

  function switchBox(value: "received" | "sent") {
    if (value === box) return;
    invalidateView();
    reasonTrigger.current = null;
    setReasonRequest(null); setReason("");
    setState("loading"); setItems([]); setNextCursor(null);
    setCursorHistory([null]); setCursorIndex(0); setBox(value);
  }

  function nextPage() {
    if (!nextCursor) return;
    invalidateView();
    setState("loading");
    setCursorHistory((history) => [...history.slice(0, cursorIndex + 1), nextCursor]);
    setCursorIndex((index) => index + 1);
  }

  function previousPage() {
    if (cursorIndex === 0) return;
    invalidateView();
    setState("loading"); setCursorIndex((index) => index - 1);
  }

  async function action(id: string, actionName: "accept" | "reject" | "report" | "block", actionReason?: string) {
    const actionGeneration = generation.current;
    setActionBusy(id);
    try {
      const response = await fetch(`/api/greetings/${id}?realm=${realm}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName, ...(actionReason ? { reason: actionReason } : {}) }) });
      if (actionGeneration !== generation.current) return;
      if (response.ok) setReloadToken((token) => token + 1);
      else setState("error");
    } catch {
      if (actionGeneration === generation.current) setState("error");
    } finally {
      setActionBusy((current) => current === id ? null : current);
    }
  }

  function requestAction(id: string, actionName: "accept" | "reject" | "report" | "block") {
    if (actionName === "report" || actionName === "block") {
      reasonTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setReason("");
      setReasonRequest({ id, action: actionName });
      return;
    }
    void action(id, actionName);
  }

  function closeReasonDialog() {
    reasonDialog.current?.close();
  }

  function handleReasonClose() {
    setReasonRequest(null);
    setReason("");
    const trigger = reasonTrigger.current;
    reasonTrigger.current = null;
    trigger?.focus();
  }

  return <section className="greeting-inbox" aria-live="polite">
    <div className="greeting-inbox__tabs" role="tablist" aria-label="往来卡片分类"><button aria-selected={box === "received"} onClick={() => switchBox("received")} role="tab" type="button">收到的</button><button aria-selected={box === "sent"} onClick={() => switchBox("sent")} role="tab" type="button">发出的</button></div>
    {state === "loading" ? <div className="greeting-empty"><span aria-hidden="true">…</span><h2>正在整理往来卡片…</h2></div> : null}
    {state === "error" ? <div className="greeting-empty"><span aria-hidden="true">!</span><h2>暂时无法读取往来卡片</h2><p>网络可能开了个小差，你可以重新尝试。</p><button className="button button--outline" onClick={() => { setState("loading"); setReloadToken((token) => token + 1); }} type="button">重新加载</button></div> : null}
    {state === "ready" && items.length === 0 ? <div className="greeting-empty"><span aria-hidden="true">信</span><h2>{box === "received" ? "还没有收到打招呼" : "还没有发出打招呼"}</h2><p>从公开名册中找到合适的老师或需求，再通过受控卡片表达意向。</p></div> : null}
    {state === "ready" && items.length > 0 ? <div className="greeting-list">{items.map((item) => <GreetingCard busy={actionBusy === item.id} item={item} key={item.id} onAction={async (name) => requestAction(item.id, name)} realm={realm} />)}</div> : null}
    {state === "ready" ? <nav className="greeting-inbox__pagination" aria-label="往来卡片分页"><button className="button button--outline button--small" disabled={cursorIndex === 0} onClick={previousPage} type="button">上一页</button><button className="button button--outline button--small" disabled={!nextCursor} onClick={nextPage} type="button">下一页</button></nav> : null}
    <dialog
      aria-labelledby="greeting-reason-title"
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); closeReasonDialog(); }}
      onClose={handleReasonClose}
      ref={reasonDialog}
    >
      {reasonRequest ? <form onSubmit={(event) => {
        event.preventDefault();
        const trimmed = reason.trim();
        if (!trimmed) return;
        const request = reasonRequest;
        closeReasonDialog();
        void action(request.id, request.action, trimmed);
      }}>
        <h2 id="greeting-reason-title">{reasonRequest.action === "report" ? "请说明举报原因" : "请说明屏蔽原因"}</h2>
        <p>{reasonRequest.action === "report" ? "举报不会自动屏蔽对方；如需停止联系，请另行选择屏蔽。" : "屏蔽不会自动创建举报；如需平台核查，请另行举报。"}</p>
        <label>{reasonRequest.action === "report" ? "举报原因" : "屏蔽原因"}<textarea maxLength={200} onChange={(event) => setReason(event.target.value)} ref={reasonInput} required rows={4} value={reason} /></label>
        <div className="greeting-card__actions">
          <button className="button button--outline" onClick={closeReasonDialog} type="button">取消</button>
          <button className="button button--primary" disabled={!reason.trim()} type="submit">{reasonRequest.action === "report" ? "确认举报" : "确认屏蔽"}</button>
        </div>
      </form> : null}
    </dialog>
  </section>;
}
