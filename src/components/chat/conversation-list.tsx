import type { ConversationItem } from "./types";

function activityLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ConversationList({
  conversations,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  selectedId,
}: {
  conversations: ConversationItem[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore(): void;
  onSelect(id: string): void;
  selectedId: string | null;
}) {
  return (
    <nav aria-label="会话列表" className="chat-conversation-index">
      <header className="chat-conversation-index__header">
        <p className="eyebrow">往来索引</p>
        <h2>会话列表</h2>
        <p>{conversations.length} 封已建立的往来</p>
      </header>
      {conversations.length === 0 ? (
        <div className="chat-conversation-index__empty">
          <span aria-hidden="true">信</span>
          <p>还没有可用会话</p>
          <small>对方接受打招呼后，会话会出现在这里。</small>
        </div>
      ) : (
        <ol className="chat-conversation-list">
          {conversations.map((conversation, index) => {
            const unread = conversation.unreadCount > 0
              ? `${conversation.unreadCount} 条未读消息`
              : "";
            return (
              <li key={conversation.id}>
                <button
                  aria-current={selectedId === conversation.id ? "true" : undefined}
                  aria-label={`${conversation.counterpart.displayName}，${conversation.request.title}${unread ? `，${unread}` : ""}`}
                  data-conversation-id={conversation.id}
                  onClick={() => onSelect(conversation.id)}
                  type="button"
                >
                  <span aria-hidden="true" className="chat-conversation-list__number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="chat-conversation-list__copy">
                    <strong>{conversation.counterpart.displayName}</strong>
                    <span>{conversation.request.title}</span>
                    <time dateTime={conversation.activityAt}>{activityLabel(conversation.activityAt)}</time>
                  </span>
                  {conversation.unreadCount > 0 ? (
                    <span aria-hidden="true" className="chat-unread-count">{conversation.unreadCount}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {hasMore ? (
        <button
          className="chat-conversation-index__more"
          disabled={loadingMore}
          onClick={onLoadMore}
          type="button"
        >
          {loadingMore ? "正在加载更多会话…" : "加载更多会话"}
        </button>
      ) : null}
    </nav>
  );
}
