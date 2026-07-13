"use client";

import Link from "next/link";

import { greetingCardSnapshotSchema, type CurrentGreetingCardSnapshot } from "@/features/greetings/card-schema";

type GreetingItem = {
  id: string;
  direction: "sent" | "received";
  status: string;
  note: string;
  card: unknown;
  createdAt: string;
};

const labels: Record<string, string> = { PENDING: "等待回应", ACCEPTED: "已接受", REJECTED: "已婉拒", EXPIRED: "已过期", REPORTED: "已举报", BLOCKED: "已屏蔽", CANCELLED: "已取消" };

const gradeLabels: Record<string, string> = {
  GRADE_1: "一年级", GRADE_2: "二年级", GRADE_3: "三年级", GRADE_4: "四年级",
  GRADE_5: "五年级", GRADE_6: "六年级", GRADE_7: "初一", GRADE_8: "初二",
  GRADE_9: "初三", GRADE_10: "高一", GRADE_11: "高二", GRADE_12: "高三", OTHER: "其他阶段",
};
const modeLabels = { ONLINE: "线上", OFFLINE: "线下", BOTH: "线上 / 线下均可" } as const;

function money(min: number | null, max: number | null) {
  if (min === null || max === null) return "预算面议";
  return `¥${min / 100}–¥${max / 100}/小时`;
}

function SnapshotDetails({ snapshot }: { snapshot: CurrentGreetingCardSnapshot }) {
  const { teacher, request } = snapshot;
  return <div className="greeting-card__snapshot">
    <section aria-label="老师公开资料快照">
      <h3>{teacher.publicNickname}</h3>
      <p>{teacher.headline}</p>
      <ul className="directory-tags">
        <li>{teacher.yearsExperience} 年经验</li>
        <li>{money(teacher.rateMinCents, teacher.rateMaxCents)}</li>
        <li>{teacher.online ? "支持线上" : "仅线下"}</li>
        <li>{teacher.verified ? "已认证" : "未认证"}</li>
        {teacher.subjects.map((subject) => <li key={subject.id}>{subject.name}</li>)}
        {teacher.serviceAreas.map((area) => <li key={area.id}>{area.name}</li>)}
      </ul>
    </section>
    <section aria-label="家教需求快照">
      <h3>{request.title}</h3>
      <p>{request.studentAlias} · {request.gradeLevel ? gradeLabels[request.gradeLevel] ?? request.gradeLevel : "学习阶段待确认"}</p>
      <ul className="directory-tags">
        <li>{money(request.budgetMinCents, request.budgetMaxCents)}</li>
        <li>{modeLabels[request.teachingMode]}</li>
        <li>{request.scheduleText ?? "时间待商量"}</li>
        <li>{request.region.name}</li>
        {request.subjects.map((subject) => <li key={subject.id}>{subject.name}</li>)}
      </ul>
    </section>
  </div>;
}

export function GreetingCard({ item, onAction, realm, busy = false }: { item: GreetingItem; onAction(action: "accept" | "reject" | "report" | "block"): Promise<void>; realm: "parent" | "teacher"; busy?: boolean }) {
  const parsed = greetingCardSnapshotSchema.safeParse(item.card);
  const current = parsed.success && !("legacy" in parsed.data) ? parsed.data : null;
  const title = current?.request.title ?? (parsed.success ? "历史联系卡片" : "资料快照暂不可读");
  const context = current?.teacher.publicNickname ?? (parsed.success ? "旧版资料已安全保留" : "无法展示未知格式中的内容");
  return <article className="greeting-card">
    <header><div><p className="eyebrow">{item.direction === "sent" ? "我发出的卡片" : "我收到的卡片"}</p><h2>{title}</h2><p>{context}</p></div><span className={`greeting-status greeting-status--${item.status.toLowerCase()}`}>{labels[item.status] ?? item.status}</span></header>
    {current ? <SnapshotDetails snapshot={current} /> : null}
    {item.note ? <blockquote>{item.note}</blockquote> : <p className="greeting-card__quiet">对方没有填写补充说明</p>}
    <footer><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</time>
      {item.direction === "received" && item.status === "PENDING" ? <div className="greeting-card__actions"><button className="button button--primary button--small" disabled={busy} onClick={() => onAction("accept")} type="button">接受</button><button className="button button--outline button--small" disabled={busy} onClick={() => onAction("reject")} type="button">婉拒</button><button className="text-button" disabled={busy} onClick={() => onAction("report")} type="button">举报</button><button className="text-button" disabled={busy} onClick={() => onAction("block")} type="button">屏蔽</button></div> : null}
    </footer>
    {item.status === "ACCEPTED" ? <p className="conversation-notice">会话已建立。<Link href={`/${realm}/messages`}>前往站内消息</Link></p> : null}
  </article>;
}
