import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata: Metadata = { title: "站内消息｜教师工作区" };

export default function TeacherMessagesPage() {
  return <main className="portal-page portal-page--chat" id="main-content"><ChatWorkspace realm="teacher" /></main>;
}
