import { z } from "zod";

const namedIdSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
}).strict();

const serviceAreaSchema = namedIdSchema.extend({
  isPrimary: z.boolean(),
}).strict();

const teacherCardSchema = z.object({
  id: z.string().uuid(),
  publicNickname: z.string().min(1).max(80),
  identityType: z.enum(["UNIVERSITY_STUDENT", "FULL_TIME_TEACHER", "OTHER"]),
  headline: z.string().min(1).max(160),
  yearsExperience: z.number().int().min(0).max(80),
  rateMinCents: z.number().int().min(0),
  rateMaxCents: z.number().int().min(0),
  online: z.boolean(),
  verified: z.boolean(),
  subjects: z.array(namedIdSchema).min(1),
  serviceAreas: z.array(serviceAreaSchema).min(1),
}).strict();

const requestCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
  studentAlias: z.string().min(1).max(80),
  gradeLevel: z.string().min(1).max(40).nullable(),
  budgetMinCents: z.number().int().min(0).nullable(),
  budgetMaxCents: z.number().int().min(0).nullable(),
  teachingMode: z.enum(["ONLINE", "OFFLINE", "BOTH"]),
  scheduleText: z.string().max(500).nullable(),
  region: namedIdSchema,
  subjects: z.array(namedIdSchema).min(1),
}).strict();

export const currentGreetingCardSnapshotSchema = z.object({
  teacher: teacherCardSchema,
  request: requestCardSchema,
}).strict();

export const legacyGreetingCardSnapshotSchema = z.object({ legacy: z.literal(true) }).strict();

export const greetingCardSnapshotSchema = z.union([
  currentGreetingCardSnapshotSchema,
  legacyGreetingCardSnapshotSchema,
]);

export type CurrentGreetingCardSnapshot = z.infer<typeof currentGreetingCardSnapshotSchema>;
