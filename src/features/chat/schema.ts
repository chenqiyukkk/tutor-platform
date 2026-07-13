import { z } from "zod";

const canonicalTimestampSchema = z.string().datetime({ offset: false, precision: 3 });
const cursorIdSchema = z.string().uuid();

function encodeCursor(timestampKey: string, at: Date, id: string) {
  return Buffer.from(JSON.stringify({ [timestampKey]: at.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(value: string, timestampKey: "sentAt" | "activityAt") {
  if (value.length < 1 || value.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid chat cursor");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("non-canonical chat cursor");
  const payload = z.object({ [timestampKey]: canonicalTimestampSchema, id: cursorIdSchema }).strict()
    .parse(JSON.parse(decoded.toString("utf8"))) as Record<typeof timestampKey | "id", string>;
  const at = new Date(payload[timestampKey]);
  if (at.toISOString() !== payload[timestampKey]) throw new Error("non-canonical chat cursor date");
  return { at, id: payload.id };
}

export type MessageCursor = { sentAt: Date; id: string };
export type ConversationCursor = { activityAt: Date; id: string };

export function encodeMessageCursor(cursor: MessageCursor) {
  return encodeCursor("sentAt", cursor.sentAt, cursor.id);
}

export function decodeMessageCursor(value: string): MessageCursor {
  const decoded = decodeCursor(value, "sentAt");
  return { sentAt: decoded.at, id: decoded.id };
}

export function encodeConversationCursor(cursor: ConversationCursor) {
  return encodeCursor("activityAt", cursor.activityAt, cursor.id);
}

export function decodeConversationCursor(value: string): ConversationCursor {
  const decoded = decodeCursor(value, "activityAt");
  return { activityAt: decoded.at, id: decoded.id };
}

const cursorString = (decode: (value: string) => unknown) => z.string().min(1).max(256).refine((value) => {
  try { decode(value); return true; } catch { return false; }
}, "分页游标无效");

export const sendMessageSchema = z.object({
  clientMessageId: z.string().uuid(),
  body: z.string().transform((value) => value.trim()).superRefine((value, context) => {
    const length = Array.from(value).length;
    if (length < 1) context.addIssue({ code: "custom", message: "消息不能为空" });
    if (length > 1_000) context.addIssue({ code: "custom", message: "消息最多 1000 个字符" });
  }),
}).strict();

export const messageListQuerySchema = z.object({
  before: cursorString(decodeMessageCursor).optional(),
  after: cursorString(decodeMessageCursor).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().superRefine((query, context) => {
  if (query.before && query.after) context.addIssue({ code: "custom", message: "不能同时使用 before 与 after" });
});

export const conversationListQuerySchema = z.object({
  cursor: cursorString(decodeConversationCursor).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
