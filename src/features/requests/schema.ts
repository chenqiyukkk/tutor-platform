import { z } from "zod";

export const teachingModes = ["OFFLINE", "ONLINE", "BOTH"] as const;
export const grades = [
  "GRADE_1", "GRADE_2", "GRADE_3", "GRADE_4", "GRADE_5", "GRADE_6",
  "GRADE_7", "GRADE_8", "GRADE_9", "GRADE_10", "GRADE_11", "GRADE_12", "OTHER",
] as const;

const uuid = z.string().uuid("请选择有效选项");
const optionalText = (max: number, message: string) => z.string().trim().max(max, message).nullable().optional();
const optionalCents = z.number().int("预算必须为整数分").min(0, "预算不能为负数").max(100_000, "预算不能超过 1000 元/小时").nullable().optional();

export const studentInputSchema = z.object({
  publicAlias: z.string().trim().min(2, "学习昵称至少 2 个字符").max(30, "学习昵称不能超过 30 个字符"),
  grade: z.enum(grades, "请选择有效年级"),
  notes: optionalText(500, "学习备注不能超过 500 个字符"),
}).strict();

export const requestDraftSchema = z.object({
  studentId: uuid.nullable().optional(),
  subjectIds: z.array(uuid).max(3, "最多选择 3 个科目").optional(),
  regionId: uuid.nullable().optional(),
  budgetMinCents: optionalCents,
  budgetMaxCents: optionalCents,
  teachingMode: z.enum(teachingModes).nullable().optional(),
  scheduleText: optionalText(500, "时间安排不能超过 500 个字符"),
  publicLocationNote: optionalText(100, "公开位置说明不能超过 100 个字符"),
  description: optionalText(2_000, "需求说明不能超过 2000 个字符"),
}).strict().superRefine((value, context) => {
  if (value.subjectIds && new Set(value.subjectIds).size !== value.subjectIds.length) {
    context.addIssue({ code: "custom", path: ["subjectIds"], message: "科目不能重复选择" });
  }
  if (value.budgetMinCents != null && value.budgetMaxCents != null && value.budgetMinCents > value.budgetMaxCents) {
    context.addIssue({ code: "custom", path: ["budgetMaxCents"], message: "最高预算不能低于最低预算" });
  }
  if (value.publicLocationNote && /(?:\d+\s*(?:号|栋|幢|单元|室|楼)|1[3-9]\d{9}|门牌|房间|宿舍)/.test(value.publicLocationNote)) {
    context.addIssue({ code: "custom", path: ["publicLocationNote"], message: "只能填写区县内的大致位置，请勿填写门牌、房间或手机号" });
  }
});

export type StudentInput = z.input<typeof studentInputSchema>;
export type RequestDraftInput = z.input<typeof requestDraftSchema>;
