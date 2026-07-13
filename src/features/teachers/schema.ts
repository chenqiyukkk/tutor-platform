import { z } from "zod";

export const teacherIdentityTypes = [
  "UNIVERSITY_STUDENT",
  "FULL_TIME_TEACHER",
  "OTHER",
] as const;

const optionalTrimmedText = (maximum: number, message: string) =>
  z.string().trim().max(maximum, message).nullable().optional();

const optionalCents = z.number()
  .int("价格必须为整数分")
  .min(0, "价格不能为负数")
  .max(100_000, "价格不能超过 1000 元/小时")
  .nullable()
  .optional();

const uuid = z.string().uuid("请选择有效选项");

export const teacherProfileDraftSchema = z.object({
  publicNickname: optionalTrimmedText(40, "公开昵称不能超过 40 个字符"),
  identityType: z.enum(teacherIdentityTypes).nullable().optional(),
  bio: optionalTrimmedText(2_000, "个人简介不能超过 2000 个字符"),
  yearsExperience: z.number()
    .int("教学年限必须为整数")
    .min(0, "教学年限不能为负数")
    .max(80, "教学年限不能超过 80 年")
    .nullable()
    .optional(),
  online: z.boolean().optional(),
  rateMinCents: optionalCents,
  rateMaxCents: optionalCents,
  subjectIds: z.array(uuid).optional(),
  primaryRegionId: uuid.nullable().optional(),
  extraRegionIds: z.array(uuid).optional(),
}).strict().superRefine((value, context) => {
  if (
    value.rateMinCents != null &&
    value.rateMaxCents != null &&
    value.rateMinCents > value.rateMaxCents
  ) {
    context.addIssue({
      code: "custom",
      path: ["rateMaxCents"],
      message: "最高价格不能低于最低价格",
    });
  }

  const extras = [...new Set(value.extraRegionIds ?? [])];
  if (extras.length > 4) {
    context.addIssue({
      code: "custom",
      path: ["extraRegionIds"],
      message: "额外授课地区最多选择 4 个",
    });
  }
  if (value.primaryRegionId && extras.includes(value.primaryRegionId)) {
    context.addIssue({
      code: "custom",
      path: ["extraRegionIds"],
      message: "主授课地区不能同时作为额外地区",
    });
  }
});

export type TeacherIdentityType = (typeof teacherIdentityTypes)[number];
export type TeacherProfileDraftInput = z.input<typeof teacherProfileDraftSchema>;
