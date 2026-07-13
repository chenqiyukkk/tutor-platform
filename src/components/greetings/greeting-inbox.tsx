"use client";

import { useCallback, useEffect, useState } from "react";

import { GreetingCard } from "./greeting-card";

type GreetingItem = React.ComponentProps<typeof GreetingCard>["item"];

async function fetchInbox(realm: "parent" | "teacher", box: "received" | "sent", cursor: string | null) {
  const query = `/api/greetings?realm=${realm}&box=${box}&pageSize=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const response = await fetch(query, { cache: "no-store" });
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
  const cursor = cursorHistory[cursorIndex] ?? null;

  const load = useCallback(async () => {
    try {
      const data = await fetchInbox(realm, box, cursor);
      setItems(data.items); setNextCursor(data.nextCursor ?? null); setState("ready");
    } catch { setState("error"); }
  }, [box, cursor, realm]);

  useEffect(() => {
    let active = true;
    void fetchInbox(realm, box, cursor).then((data) => {
      if (active) { setItems(data.items); setNextCursor(data.nextCursor ?? null); setState("ready"); }
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [box, cursor, realm]);

  function switchBox(value: "received" | "sent") {
    if (value === box) return;
    setState("loading"); setItems([]); setNextCursor(null);
    setCursorHistory([null]); setCursorIndex(0); setBox(value);
  }

  function nextPage() {
    if (!nextCursor) return;
    setState("loading");
    setCursorHistory((history) => [...history.slice(0, cursorIndex + 1), nextCursor]);
    setCursorIndex((index) => index + 1);
  }

  function previousPage() {
    if (cursorIndex === 0) return;
    setState("loading"); setCursorIndex((index) => index - 1);
  }

  async function action(id: string, actionName: "accept" | "reject" | "report" | "block") {
    let reason: string | undefined;
    if (actionName === "report" || actionName === "block") {
      reason = window.prompt(actionName === "report" ? "请简要说明举报原因" : "请简要说明屏蔽原因")?.trim();
      if (!reason) return;
    }
    const response = await fetch(`/api/greetings/${id}?realm=${realm}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName, ...(reason ? { reason } : {}) }) });
    if (response.ok) await load(); else setState("error");
  }

  return <section className="greeting-inbox" aria-live="polite">
    <div className="greeting-inbox__tabs" role="tablist" aria-label="往来卡片分类"><button aria-selected={box === "received"} onClick={() => switchBox("received")} role="tab" type="button">收到的</button><button aria-selected={box === "sent"} onClick={() => switchBox("sent")} role="tab" type="button">发出的</button></div>
    {state === "loading" ? <div className="greeting-empty"><span aria-hidden="true">…</span><h2>正在整理往来卡片…</h2></div> : null}
    {state === "error" ? <div className="greeting-empty"><span aria-hidden="true">!</span><h2>暂时无法读取往来卡片</h2><p>网络可能开了个小差，你可以重新尝试。</p><button className="button button--outline" onClick={() => { setState("loading"); void load(); }} type="button">重新加载</button></div> : null}
    {state === "ready" && items.length === 0 ? <div className="greeting-empty"><span aria-hidden="true">信</span><h2>{box === "received" ? "还没有收到打招呼" : "还没有发出打招呼"}</h2><p>从公开名册中找到合适的老师或需求，再通过受控卡片表达意向。</p></div> : null}
    {state === "ready" && items.length > 0 ? <div className="greeting-list">{items.map((item) => <GreetingCard item={item} key={item.id} onAction={(name) => action(item.id, name)} />)}</div> : null}
    {state === "ready" ? <nav className="greeting-inbox__pagination" aria-label="往来卡片分页"><button className="button button--outline button--small" disabled={cursorIndex === 0} onClick={previousPage} type="button">上一页</button><button className="button button--outline button--small" disabled={!nextCursor} onClick={nextPage} type="button">下一页</button></nav> : null}
  </section>;
}
