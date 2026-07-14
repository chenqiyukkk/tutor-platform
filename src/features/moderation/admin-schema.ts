import { z } from "zod";

const mutationBase = {
  clientRequestId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
};

const reviewNote = z.string().trim().min(2).max(300);

export const accountMutationSchema = z.object({
  ...mutationBase,
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: reviewNote,
}).strict();

export const reportMutationSchema = z.discriminatedUnion("decision", [
  z.object({
    ...mutationBase,
    decision: z.literal("START_REVIEW"),
  }).strict(),
  z.object({
    ...mutationBase,
    decision: z.literal("DISMISS"),
    resolutionAction: z.literal("NONE"),
    reviewNote,
  }).strict(),
  z.object({
    ...mutationBase,
    decision: z.literal("RESOLVE"),
    resolutionAction: z.enum(["NONE", "CONTENT_TAKEDOWN", "ACCOUNT_SUSPENSION"]),
    reviewNote,
  }).strict(),
]);

export const verificationMutationSchema = z.discriminatedUnion("decision", [
  z.object({
    ...mutationBase,
    decision: z.literal("APPROVE"),
  }).strict(),
  z.object({
    ...mutationBase,
    decision: z.literal("REJECT"),
    reviewNote,
  }).strict(),
]);

export const adminTargetIdSchema = z.string().uuid();

export type AccountMutationInput = z.infer<typeof accountMutationSchema>;
export type ReportMutationInput = z.infer<typeof reportMutationSchema>;
export type VerificationMutationInput = z.infer<typeof verificationMutationSchema>;
