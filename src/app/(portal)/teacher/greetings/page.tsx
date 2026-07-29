import type { Metadata } from "next";

import { GreetingInbox } from "@/components/greetings/greeting-inbox";

export const metadata: Metadata = { title: "往来卡片｜教师工作区" };

export default function TeacherGreetingsPage() {
  return <main className="portal-page greeting-page" id="main-content"><header className="greeting-page__intro"><p className="eyebrow">站内往来</p><h1>打招呼卡片</h1><p>在公开需求中表达意向，对方接受后建立唯一会话。联系方式始终不会出现在卡片里。</p></header><GreetingInbox realm="teacher" /></main>;
}
