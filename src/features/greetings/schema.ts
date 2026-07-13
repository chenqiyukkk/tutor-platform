import { z } from "zod";

const contactPatterns = [
  /(?:\+?[\s-]*8[\s-]*6[\s-]*)?1[\s-]*[3-9](?:[\s-]*\d){9}/iu,
  /(?:微\s*信|微\s*xin|wei\s*xin|wechat|wx\s*号)/iu,
  /(?:^|[^a-z])q\s*q(?:[^a-z]|$)/iu,
  /二\s*维\s*码|扫码/iu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/iu,
  /(?:https?:\/\/|www\.)\S+/iu,
  /(?:加\s*好友|付\s*(?:信息|中介)?\s*费|外部\s*付费|转账)/iu,
  /(?:联系\s*方式|手机号|手机号码|电话号|邮箱|私聊发)/iu,
];

export const greetingNoteSchema = z.string().transform((value) => value.trim()).superRefine((value, context) => {
  if (Array.from(value).length > 100) {
    context.addIssue({ code: "custom", message: "补充说明最多 100 个字符" });
  }
  if (contactPatterns.some((pattern) => pattern.test(value))) {
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

export const greetingInboxQuerySchema = z.object({
  box: z.enum(["sent", "received"]).default("received"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export type SendGreetingInput = z.infer<typeof sendGreetingSchema>;
export type GreetingActionInput = z.infer<typeof greetingActionSchema>;
