import { useState } from "react";

const MAX_CODE_POINTS = 1_000;

export function MessageComposer({
  disabled = false,
  onSend,
}: {
  disabled?: boolean;
  onSend(body: string): void;
}) {
  const [body, setBody] = useState("");
  const normalized = body.trim();
  const length = Array.from(normalized).length;
  const remaining = MAX_CODE_POINTS - length;
  const valid = length > 0 && length <= MAX_CODE_POINTS;

  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !valid) return;
        onSend(normalized);
        setBody("");
      }}
    >
      <label htmlFor="chat-message-body">消息内容</label>
      <div className="chat-composer__field">
        <textarea
          aria-describedby="message-character-count"
          disabled={disabled}
          id="chat-message-body"
          onChange={(event) => setBody(event.target.value)}
          placeholder="把要说的话写在这里…"
          rows={3}
          value={body}
        />
        <p
          className={remaining < 0 ? "chat-character-count chat-character-count--error" : "chat-character-count"}
          id="message-character-count"
        >
          {remaining >= 0 ? `还可输入 ${remaining} 个字符` : `已超出 ${Math.abs(remaining)} 个字符`}
        </p>
      </div>
      <button className="button button--primary" disabled={disabled || !valid} type="submit">
        发送消息
      </button>
    </form>
  );
}
