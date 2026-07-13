"use client";

import { useCallback, useEffect, useState } from "react";

import { GreetingCard } from "./greeting-card";

type GreetingItem = React.ComponentProps<typeof GreetingCard>["item"];

async function fetchInbox(realm: "parent" | "teacher", box: "received" | "sent") {
  const response = await fetch(`/api/greetings?realm=${realm}&box=${box}&page=1&pageSize=20`, { cache: "no-store" });
  if (!response.ok) throw new Error("load failed");
  return response.json() as Promise<{ items: GreetingItem[] }>;
}

export function GreetingInbox({ realm }: { realm: "parent" | "teacher" }) {
  const [box, setBox] = useState<"received" | "sent">("received");
  const [items, setItems] = useState<GreetingItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const data = await fetchInbox(realm, box);
      setItems(data.items); setState("ready");
    } catch { setState("error"); }
  }, [box, realm]);

  useEffect(() => {
    let active = true;
    void fetchInbox(realm, box).then((data) => {
      if (active) { setItems(data.items); setState("ready"); }
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [box, realm]);

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
    <div className="greeting-inbox__tabs" role="tablist" aria-label="往来卡片分类"><button aria-selected={box === "received"} onClick={() => { setState("loading"); setBox("received"); }} role="tab" type="button">收到的</button><button aria-selected={box === "sent"} onClick={() => { setState("loading"); setBox("sent"); }} role="tab" type="button">发出的</button></div>
    {state === "loading" ? <div className="greeting-empty"><span aria-hidden="true">…</span><h2>正在整理往来卡片…</h2></div> : null}
    {state === "error" ? <div className="greeting-empty"><span aria-hidden="true">!</span><h2>暂时无法读取往来卡片</h2><p>网络可能开了个小差，你可以重新尝试。</p><button className="button button--outline" onClick={() => { setState("loading"); void load(); }} type="button">重新加载</button></div> : null}
    {state === "ready" && items.length === 0 ? <div className="greeting-empty"><span aria-hidden="true">信</span><h2>{box === "received" ? "还没有收到打招呼" : "还没有发出打招呼"}</h2><p>从公开名册中找到合适的老师或需求，再通过受控卡片表达意向。</p></div> : null}
    {state === "ready" && items.length > 0 ? <div className="greeting-list">{items.map((item) => <GreetingCard item={item} key={item.id} onAction={(name) => action(item.id, name)} />)}</div> : null}
  </section>;
}
