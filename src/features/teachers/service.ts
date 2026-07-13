import { ZodError } from "zod";

import {
  teacherProfileDraftSchema,
  type TeacherIdentityType,
  type TeacherProfileDraftInput,
} from "./schema";

export type TeacherProfileStatus = "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "REJECTED";

export type TeacherProfile = {
  id: string;
  accountId: string;
  publicNickname: string;
  identityType: TeacherIdentityType | null;
  bio: string | null;
  yearsExperience: number | null;
  online: boolean;
  rateMinCents: number | null;
  rateMaxCents: number | null;
  status: TeacherProfileStatus;
  publishedAt: Date | null;
  subjects: Array<{ id: string; name: string }>;
  primaryRegion: { id: string; name: string } | null;
  extraRegions: Array<{ id: string; name: string }>;
};

export type SavedTeacherProfile = {
  publicNickname: string;
  identityType: TeacherIdentityType | null;
  bio: string | null;
  yearsExperience: number | null;
  online: boolean;
  rateMinCents: number | null;
  rateMaxCents: number | null;
  subjectIds: string[];
  primaryRegionId: string | null;
  extraRegionIds: string[];
};

export interface TeacherProfileRepository {
  findOwned(accountId: string): Promise<TeacherProfile | null>;
  saveOwned(accountId: string, input: SavedTeacherProfile): Promise<TeacherProfile>;
  setPublished(accountId: string, published: boolean): Promise<TeacherProfile>;
}

export type TeacherProfileErrorCode =
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INVALID_SUBJECT"
  | "INVALID_REGION"
  | "INCOMPLETE_PROFILE"
  | "NOT_FOUND";

export class TeacherProfileError extends Error {
  constructor(
    readonly code: TeacherProfileErrorCode,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "TeacherProfileError";
  }
}

type Caller = { id: string; role: string };

function assertTeacher(account: Caller) {
  if (account.role !== "teacher") {
    throw new TeacherProfileError("FORBIDDEN", "仅教师账号可管理教师资料");
  }
}

function validationError(error: ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const fields = issue.code === "unrecognized_keys"
      ? issue.keys
      : [String(issue.path[0] ?? "form")];
    for (const field of fields) {
      const message = issue.code === "unrecognized_keys"
        ? "请求中包含不允许的字段"
        : issue.message;
      fieldErrors[field] = [...(fieldErrors[field] ?? []), message];
    }
  }
  return new TeacherProfileError("INVALID_INPUT", "教师资料校验失败", fieldErrors);
}

function normalizeDraft(input: TeacherProfileDraftInput): SavedTeacherProfile {
  const parsed = teacherProfileDraftSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  return {
    publicNickname: parsed.data.publicNickname ?? "",
    identityType: parsed.data.identityType ?? null,
    bio: parsed.data.bio || null,
    yearsExperience: parsed.data.yearsExperience ?? null,
    online: parsed.data.online ?? false,
    rateMinCents: parsed.data.rateMinCents ?? null,
    rateMaxCents: parsed.data.rateMaxCents ?? null,
    subjectIds: [...new Set(parsed.data.subjectIds ?? [])],
    primaryRegionId: parsed.data.primaryRegionId ?? null,
    extraRegionIds: [...new Set(parsed.data.extraRegionIds ?? [])],
  };
}

const completionItems = [
  ["publicNickname", "公开昵称", (profile: TeacherProfile) => profile.publicNickname.trim().length >= 2],
  ["identityType", "身份类型", (profile: TeacherProfile) => profile.identityType !== null],
  ["bio", "个人简介", (profile: TeacherProfile) => (profile.bio?.trim().length ?? 0) >= 20],
  ["yearsExperience", "教学年限", (profile: TeacherProfile) => profile.yearsExperience !== null],
  ["rateMinCents", "授课价格", (profile: TeacherProfile) =>
    profile.rateMinCents !== null && profile.rateMaxCents !== null],
  ["subjectIds", "授课科目", (profile: TeacherProfile) => profile.subjects.length > 0],
  ["primaryRegionId", "主授课地区", (profile: TeacherProfile) => profile.primaryRegion !== null],
] as const;

export function calculateProfileCompletion(profile: TeacherProfile) {
  const incomplete = completionItems.filter(([, , isComplete]) => !isComplete(profile));
  return {
    percentage: Math.round(((completionItems.length - incomplete.length) / completionItems.length) * 100),
    missingItems: incomplete.map(([, label]) => label),
  };
}

function publicationFieldErrors(profile: TeacherProfile) {
  const errors: Record<string, string[]> = {};
  for (const [field, label, isComplete] of completionItems) {
    if (!isComplete(profile)) errors[field] = [`请完善${label}`];
  }
  return errors;
}

export function createTeacherProfileService(repository: TeacherProfileRepository) {
  async function findRequired(account: Caller) {
    assertTeacher(account);
    const profile = await repository.findOwned(account.id);
    if (!profile) throw new TeacherProfileError("NOT_FOUND", "教师资料不存在");
    return profile;
  }

  return {
    async get(account: Caller) {
      assertTeacher(account);
      return repository.findOwned(account.id);
    },

    async saveDraft(account: Caller, input: TeacherProfileDraftInput) {
      assertTeacher(account);
      return repository.saveOwned(account.id, normalizeDraft(input));
    },

    async preview(account: Caller) {
      return findRequired(account);
    },

    async publish(account: Caller) {
      const profile = await findRequired(account);
      const fieldErrors = publicationFieldErrors(profile);
      if (Object.keys(fieldErrors).length) {
        throw new TeacherProfileError(
          "INCOMPLETE_PROFILE",
          "请先完善教师资料再发布",
          fieldErrors,
        );
      }
      return repository.setPublished(account.id, true);
    },

    async unpublish(account: Caller) {
      await findRequired(account);
      return repository.setPublished(account.id, false);
    },
  };
}

export type TeacherProfileService = ReturnType<typeof createTeacherProfileService>;
