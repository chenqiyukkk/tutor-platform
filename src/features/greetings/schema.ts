import { z } from "zod";
import { contactPolicyMessage, violatesContactPolicy } from "@/features/safety/contact-policy";

export const greetingNoteSchema = z.string().transform((value) => value.trim()).superRefine((value, context) => {
  if (Array.from(value).length > 100) {
    context.addIssue({ code: "custom", message: "补充说明最多 100 个字符" });
  }
  if (violatesContactPolicy(value)) {
    context.addIssue({ code: "custom", message: contactPolicyMessage });
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
