import type { Ref } from "react";

import type { ConversationItem, DisplayMessage } from "./types";

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function MessageThread({
  beforeCursor,
  conversation,
  loading,
  loadingOlder,
  olderError,
  messages,
  onBack,
  onBlock,
  onLoadOlder,
  onRetry,
  blockTriggerRef,
  headingRef,
}: {
  beforeCursor: string | null;
  conversation: ConversationItem;
  loading: boolean;
  loadingOlder: boolean;
  olderError: boolean;
  messages: DisplayMessage[];
  onBack(): void;
  onBlock(): void;
  onLoadOlder(): void;
  onRetry(message: DisplayMessage): void;
  blockTriggerRef: Ref<HTMLButtonElement>;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <section
      aria-label={`与${conversation.counterpart.displayName}的消息`}
      className="chat-thread"
      role="region"
    >
      <header className="chat-thread__header">
        <button aria-label="返回会话列表" className="chat-thread__back" onClick={onBack} type="button">
          <span aria-hidden="true">←</span> 会话列表
        </button>
        <div>
          <p className="eyebrow">受控站内往来</p>
          <h2 ref={headingRef} tabIndex={-1}>{conversation.counterpart.displayName}</h2>
          <p>{conversation.request.title}</p>
        </div>
        <div>
          <span aria-label="隐私保护已开启" className="chat-thread__privacy">仅站内</span>
          <button
            aria-label={conversation.blocked ? "已屏蔽" : "屏蔽对方"}
            aria-disabled={conversation.blocked ? "true" : undefined}
            className="text-button"
            onClick={() => { if (!conversation.blocked) onBlock(); }}
            ref={blockTriggerRef}
            type="button"
          >
            {conversation.blocked ? "已屏蔽" : "屏蔽对方"}
          </button>
        </div>
      </header>

      <div className="chat-thread__paper">
        {beforeCursor ? (
          <button
            className="chat-load-older"
            disabled={loadingOlder}
            onClick={onLoadOlder}
            type="button"
          >
            {loadingOlder ? "正在加载…" : "加载更早消息"}
          </button>
        ) : null}
        {olderError ? <p className="chat-thread__error" role="alert">更早消息加载失败，请重试。</p> : null}
        {loading ? (
          <div className="chat-thread__notice" role="status">正在打开信笺…</div>
        ) : messages.length === 0 ? (
          <div className="chat-thread__empty">
            <span aria-hidden="true">始</span>
            <h3>从第一句话开始</h3>
            <p>双方确认后可自主交换联系方式；严禁收取信息费、中介费或引导站外付费。</p>
          </div>
        ) : (
          <ol aria-label="消息记录" aria-live="polite" className="chat-message-list" role="log">
            {messages.map((message) => (
              <li className={message.mine ? "chat-message chat-message--mine" : "chat-message"} key={message.clientMessageId}>
                <article>
                  <p>{message.body}</p>
                  <footer>
                    <time dateTime={message.sentAt}>{timeLabel(message.sentAt)}</time>
                    {message.delivery === "sending" ? <span>发送中…</span> : null}
                    {message.delivery === "failed" ? (
                      <button
                        aria-label={`重试发送“${message.body}”`}
                        onClick={() => onRetry(message)}
                        type="button"
                      >
                        发送失败，重试
                      </button>
                    ) : null}
                    {!message.delivery && message.mine ? <span>{message.readAt ? "已读" : "已送达"}</span> : null}
                  </footer>
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
