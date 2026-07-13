"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Props = {
  realm: "parent" | "teacher";
  targetId: string;
  requestId?: string;
  requestOptions?: Array<{ id: string; label: string }>;
};

async function responseMessage(response: Response) {
  try {
    const data = await response.json() as { error?: string };
    return data.error ?? "操作没有完成，请稍后再试";
  } catch { return "操作没有完成，请稍后再试"; }
}

export function GreetingComposer({ realm, targetId, requestId, requestOptions = [] }: Props) {
  const [selectedRequestId, setSelectedRequestId] = useState(requestId ?? requestOptions[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(true);
  const remaining = useMemo(() => 100 - Array.from(note).length, [note]);
  const targetType = realm === "parent" ? "teacher" : "request";

  useEffect(() => {
    let active = true;
    void fetch(`/api/favorites?realm=${realm}&targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        const data = await response.json() as { favorite?: unknown };
        if (typeof data.favorite !== "boolean") throw new Error("收藏状态返回格式不正确");
        if (active) setFavorite(data.favorite);
      })
      .catch((error: unknown) => {
        if (active) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "收藏状态读取失败");
        }
      })
      .finally(() => { if (active) setFavoriteBusy(false); });
    return () => { active = false; };
  }, [realm, targetId, targetType]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending"); setMessage("");
    const response = await fetch(`/api/greetings?realm=${realm}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetId, requestId: selectedRequestId, note }),
    });
    if (response.ok) { setStatus("sent"); setMessage("打招呼已发送，请等待对方回应。"); return; }
    setStatus("error"); setMessage(await responseMessage(response));
  }

  async function toggleFavorite() {
    if (favorite === null) return;
    setFavoriteBusy(true);
    const response = await fetch(`/api/favorites?realm=${realm}`, {
      method: favorite ? "DELETE" : "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType, targetId }),
    });
    if (response.ok) setFavorite((current) => current === null ? current : !current);
    else { setStatus("error"); setMessage(await responseMessage(response)); }
    setFavoriteBusy(false);
  }

  return <aside className="directory-contact greeting-composer" aria-label="站内打招呼">
    <p className="eyebrow">免费 · 受控联系</p>
    {realm === "parent" && requestOptions.length === 0 ? <section className="greeting-composer--empty" aria-label="发送打招呼前置条件">
      <h2>先发布一条有效需求</h2>
      <p>打招呼会附上你选择的公开需求；收藏老师不受影响。</p>
      <Link className="button button--primary" href="/parent/requests/new">去发布需求</Link>
    </section> : <>
      <h2>{realm === "parent" ? "向这位老师打招呼" : "向这位家长打招呼"}</h2>
      <p>姓名、角色与公开卡片由平台生成。请勿填写联系方式、链接或站外付费引导。</p>
      <form onSubmit={submit}>
      {realm === "parent" ? <label>选择一条公开需求<select value={selectedRequestId} onChange={(event) => setSelectedRequestId(event.target.value)}>{requestOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : null}
      <label>补充说明（选填）<textarea aria-describedby="greeting-note-help" maxLength={200} rows={4} value={note} onChange={(event) => setNote(Array.from(event.target.value).slice(0, 100).join(""))} /></label>
      <small id="greeting-note-help">还可填写 {remaining} 个字符；联系方式会被服务端拒绝。</small>
      <button className="button button--primary" disabled={status === "sending" || status === "sent" || !selectedRequestId} type="submit">{status === "sending" ? "正在发送…" : status === "sent" ? "已发送" : "发送打招呼"}</button>
      </form>
    </>}
    <button className="button button--outline" disabled={favoriteBusy || favorite === null} onClick={toggleFavorite} type="button">{favoriteBusy || favorite === null ? "正在读取收藏…" : favorite ? "取消收藏" : "收藏这条资料"}</button>
    {message ? <p className={`greeting-feedback greeting-feedback--${status}`} role={status === "error" ? "alert" : "status"}>{message}</p> : null}
    <small>对方接受后将建立唯一站内会话；消息功能下一阶段开放。</small>
  </aside>;
}
