"use client";

type GreetingItem = {
  id: string;
  direction: "sent" | "received";
  status: string;
  note: string;
  card: unknown;
  createdAt: string;
};

const labels: Record<string, string> = { PENDING: "等待回应", ACCEPTED: "已接受", REJECTED: "已婉拒", EXPIRED: "已过期", REPORTED: "已举报", BLOCKED: "已屏蔽", CANCELLED: "已取消" };

function cardSummary(card: unknown) {
  if (!card || typeof card !== "object") return { title: "公开联系卡片", context: "资料快照已保留" };
  const value = card as { teacher?: { publicNickname?: unknown }; request?: { title?: unknown } };
  return {
    title: typeof value.request?.title === "string" ? value.request.title : "家教需求",
    context: typeof value.teacher?.publicNickname === "string" ? value.teacher.publicNickname : "教师资料",
  };
}

export function GreetingCard({ item, onAction }: { item: GreetingItem; onAction(action: "accept" | "reject" | "report" | "block"): Promise<void> }) {
  const summary = cardSummary(item.card);
  return <article className="greeting-card">
    <header><div><p className="eyebrow">{item.direction === "sent" ? "我发出的卡片" : "我收到的卡片"}</p><h2>{summary.title}</h2><p>{summary.context}</p></div><span className={`greeting-status greeting-status--${item.status.toLowerCase()}`}>{labels[item.status] ?? item.status}</span></header>
    {item.note ? <blockquote>{item.note}</blockquote> : <p className="greeting-card__quiet">对方没有填写补充说明</p>}
    <footer><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</time>
      {item.direction === "received" && item.status === "PENDING" ? <div className="greeting-card__actions"><button className="button button--primary button--small" onClick={() => onAction("accept")} type="button">接受</button><button className="button button--outline button--small" onClick={() => onAction("reject")} type="button">婉拒</button><button className="text-button" onClick={() => onAction("report")} type="button">举报</button><button className="text-button" onClick={() => onAction("block")} type="button">屏蔽</button></div> : null}
    </footer>
    {item.status === "ACCEPTED" ? <p className="conversation-notice">会话已建立，消息功能下一阶段开放。</p> : null}
  </article>;
}
