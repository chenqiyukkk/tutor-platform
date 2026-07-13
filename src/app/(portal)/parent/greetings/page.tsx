import type { Metadata } from "next";

import { GreetingInbox } from "@/components/greetings/greeting-inbox";

export const metadata: Metadata = { title: "往来卡片｜家长工作区" };

export default function ParentGreetingsPage() {
  return <main className="portal-page greeting-page" id="main-content"><header className="greeting-page__intro"><p className="eyebrow">站内往来</p><h1>打招呼卡片</h1><p>所有首次联系都经过受控卡片。接受后只会建立一个会话，不需要支付信息费。</p></header><GreetingInbox realm="parent" /></main>;
}
