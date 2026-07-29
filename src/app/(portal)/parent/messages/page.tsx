import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata: Metadata = { title: "站内消息｜家长工作区" };

export default function ParentMessagesPage() {
  return <main className="portal-page portal-page--chat" id="main-content"><ChatWorkspace realm="parent" /></main>;
}
