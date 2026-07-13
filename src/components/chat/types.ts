export type ChatRealm = "parent" | "teacher";

export type ConversationItem = {
  id: string;
  counterpart: { role: ChatRealm; displayName: string };
  request: { id: string; title: string };
  activityAt: string;
  lastMessageAt: string | null;
  unreadCount: number;
};

export type ChatMessage = {
  id: string;
  clientMessageId: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  mine: boolean;
};

export type DisplayMessage = ChatMessage & {
  delivery?: "sending" | "failed";
};

export type ConversationPage = {
  items: ConversationItem[];
  limit: number;
  nextCursor: string | null;
};

export type MessagePage = {
  items: ChatMessage[];
  limit: number;
  nextBeforeCursor: string | null;
  nextAfterCursor: string | null;
  hasMore: boolean;
};
