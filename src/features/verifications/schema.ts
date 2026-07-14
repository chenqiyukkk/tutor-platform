import { z } from "zod";

export const verificationTypes = [
  "STUDENT_STATUS",
  "EDUCATION",
  "TEACHER_QUALIFICATION",
] as const;

export const verificationTypeSchema = z.enum(verificationTypes);

export const verificationSubmissionFieldsSchema = z.object({
  type: verificationTypeSchema,
  clientRequestId: z.string().uuid(),
}).strict();

export const privateEvidenceSchema = z.object({
  provider: z.literal("local-private"),
  key: z.string().regex(/^[a-f0-9]{64}\.(?:jpg|png)$/),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type VerificationType = z.infer<typeof verificationTypeSchema>;
