import { z } from "zod";

export const moderationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("teacher_profile"), profileId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("tutoring_request"), requestId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("greeting"), greetingId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("conversation"), conversationId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("message"), messageId: z.string().uuid() }).strict(),
]);

const reasonSchema = z.string().trim().min(2).max(200);

export const createReportInputSchema = z.object({
  target: moderationTargetSchema,
  clientRequestId: z.string().uuid(),
  reason: reasonSchema,
  details: z.string().trim().min(2).max(1000).optional(),
}).strict();

export const createBlockInputSchema = z.object({
  target: moderationTargetSchema,
  reason: reasonSchema,
}).strict();

export type ModerationTarget = z.infer<typeof moderationTargetSchema>;
export type CreateReportInput = z.infer<typeof createReportInputSchema>;
export type CreateBlockInput = z.infer<typeof createBlockInputSchema>;
