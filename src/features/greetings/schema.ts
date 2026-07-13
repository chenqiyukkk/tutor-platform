import { z } from "zod";

const contactPatterns = [
  /(?:\(?\s*\+?\s*8[\s./()\-]*6\s*\)?[\s./()\-]*)?1[\s./()\-]*[3-9](?:[\s./()\-]*\d){9}/iu,
  /(?:微\s*信|微\s*xin|wei\s*xin|we\s*chat|wechat|weixin|v\s*信|v\s*x|wx\s*号)/iu,
  /(?:^|[^a-z])q\s*q(?:[^a-z]|$)/iu,
  /扣\s*扣/iu,
  /二\s*维\s*码|扫码/iu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/iu,
  /(?:https?:\/\/|www\.)\S+/iu,
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/iu,
  /(?:加\s*好友|付\s*(?:信息|中介)\s*费|外部\s*付费|转账)/iu,
  /(?:联系\s*方式|手机号|手机号码|电话号|邮箱|私聊发)/iu,
];

export const greetingNoteSchema = z.string().transform((value) => value.trim()).superRefine((value, context) => {
  const normalized = value.normalize("NFKC");
  if (Array.from(value).length > 100) {
    context.addIssue({ code: "custom", message: "补充说明最多 100 个字符" });
  }
  if (contactPatterns.some((pattern) => pattern.test(normalized))) {
    context.addIssue({ code: "custom", message: "请勿填写联系方式、外部链接或付费引导" });
  }
});

export const sendGreetingSchema = z.object({
  targetId: z.string().uuid(),
  requestId: z.string().uuid(),
  note: greetingNoteSchema.default(""),
}).strict();

export const greetingActionSchema = z.object({
  action: z.enum(["accept", "reject", "report", "block"]),
  reason: z.string().trim().min(2).max(200).optional(),
}).strict().superRefine((input, context) => {
  if ((input.action === "report" || input.action === "block") && !input.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "请填写原因" });
  }
});

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime({ offset: false, precision: 3 }),
  id: z.string().uuid(),
}).strict();

export type GreetingCursor = { createdAt: Date; id: string };

export function encodeGreetingCursor(cursor: GreetingCursor) {
  return Buffer.from(JSON.stringify({
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  }), "utf8").toString("base64url");
}

export function decodeGreetingCursor(value: string): GreetingCursor {
  if (value.length < 1 || value.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("invalid greeting cursor");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("non-canonical greeting cursor");
  const payload = cursorPayloadSchema.parse(JSON.parse(decoded.toString("utf8")));
  const createdAt = new Date(payload.createdAt);
  if (createdAt.toISOString() !== payload.createdAt) throw new Error("non-canonical greeting cursor date");
  return { createdAt, id: payload.id };
}

export const greetingInboxQuerySchema = z.object({
  box: z.enum(["sent", "received"]).default("received"),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).refine((value) => {
    try { decodeGreetingCursor(value); return true; } catch { return false; }
  }, "分页游标无效").optional(),
}).strict();

export type SendGreetingInput = z.infer<typeof sendGreetingSchema>;
export type GreetingActionInput = z.infer<typeof greetingActionSchema>;
