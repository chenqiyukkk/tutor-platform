import { ZodError } from "zod";

import { requestDraftSchema, studentInputSchema, type RequestDraftInput, type StudentInput } from "./schema";

export type TeachingMode = "OFFLINE" | "ONLINE" | "BOTH";
export type RequestStatus = "DRAFT" | "PUBLISHED" | "CLOSED";
export type Grade = "GRADE_1" | "GRADE_2" | "GRADE_3" | "GRADE_4" | "GRADE_5" | "GRADE_6" | "GRADE_7" | "GRADE_8" | "GRADE_9" | "GRADE_10" | "GRADE_11" | "GRADE_12" | "OTHER";

export type Student = { id: string; publicAlias: string; grade: Grade; notes: string | null; isActive: boolean };
export type DraftValues = {
  studentId: string | null;
  subjectIds: string[];
  regionId: string | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  teachingMode: TeachingMode | null;
  scheduleText: string | null;
  publicLocationNote: string | null;
  description: string | null;
};
export type TutoringRequest = {
  id: string; parentProfileId: string; studentProfileId: string | null; regionId: string | null;
  budgetMinCents: number | null; budgetMaxCents: number | null; teachingMode: TeachingMode | null;
  scheduleText: string | null; publicLocationNote: string | null; description: string | null;
  status: RequestStatus; publishedAt: Date | null; closedAt: Date | null;
  student: Student | null; subjects: Array<{ id: string; name: string; isActive: boolean }>;
  region: { id: string; name: string; level: number; isActive: boolean } | null;
};

export interface RequestRepository {
  listStudents(accountId: string): Promise<Student[]>;
  createStudent(accountId: string, input: Omit<Student, "id" | "isActive">): Promise<Student>;
  updateStudent(accountId: string, id: string, input: Omit<Student, "id" | "isActive">): Promise<Student>;
  deactivateStudent(accountId: string, id: string): Promise<void>;
  listRequests(accountId: string): Promise<TutoringRequest[]>;
  findRequest(accountId: string, id: string): Promise<TutoringRequest | null>;
  createRequest(accountId: string, input: DraftValues): Promise<TutoringRequest>;
  updateRequest(accountId: string, id: string, input: DraftValues): Promise<TutoringRequest>;
  publishRequest(accountId: string, id: string): Promise<TutoringRequest>;
  closeRequest(accountId: string, id: string): Promise<TutoringRequest>;
}

export type RequestErrorCode = "FORBIDDEN" | "INVALID_INPUT" | "INVALID_STUDENT" | "INVALID_SUBJECT" | "INVALID_REGION" | "INCOMPLETE_REQUEST" | "NOT_FOUND" | "CONFLICT";
export class RequestWorkflowError extends Error {
  constructor(readonly code: RequestErrorCode, message: string, readonly fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = "RequestWorkflowError";
  }
}

type Caller = { id: string; role: string };

function assertParent(caller: Caller) {
  if (caller.role !== "parent") throw new RequestWorkflowError("FORBIDDEN", "仅家长账号可管理学生与家教需求");
}

function validationError(error: ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const fields = issue.code === "unrecognized_keys" ? issue.keys : [String(issue.path[0] ?? "form")];
    for (const field of fields) {
      fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.code === "unrecognized_keys" ? "请求中包含不允许的字段" : issue.message];
    }
  }
  return new RequestWorkflowError("INVALID_INPUT", "提交内容校验失败", fieldErrors);
}

function normalizeStudent(input: StudentInput): Omit<Student, "id" | "isActive"> {
  const parsed = studentInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  return { publicAlias: parsed.data.publicAlias, grade: parsed.data.grade, notes: parsed.data.notes || null };
}

function normalizeDraft(input: RequestDraftInput): DraftValues {
  const parsed = requestDraftSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  return {
    studentId: parsed.data.studentId ?? null,
    subjectIds: parsed.data.subjectIds ?? [],
    regionId: parsed.data.regionId ?? null,
    budgetMinCents: parsed.data.budgetMinCents ?? null,
    budgetMaxCents: parsed.data.budgetMaxCents ?? null,
    teachingMode: parsed.data.teachingMode ?? null,
    scheduleText: parsed.data.scheduleText || null,
    publicLocationNote: parsed.data.publicLocationNote || null,
    description: parsed.data.description || null,
  };
}

export function validatePublishable(request: TutoringRequest) {
  const errors: Record<string, string[]> = {};
  if (!request.studentProfileId || !request.student?.isActive) errors.studentId = ["请选择有效的学生档案"];
  if (request.subjects.length < 1 || request.subjects.length > 3 || request.subjects.some((subject) => !subject.isActive)) errors.subjectIds = ["请选择 1 至 3 个有效科目"];
  if (!request.regionId || !request.region?.isActive || request.region.level !== 3) errors.regionId = ["请选择有效且启用的区县"];
  if (request.budgetMinCents === null) errors.budgetMinCents = ["请填写最低预算"];
  if (request.budgetMaxCents === null) errors.budgetMaxCents = ["请填写最高预算"];
  if (request.budgetMinCents !== null && (request.budgetMinCents < 0 || request.budgetMinCents > 100_000)) errors.budgetMinCents = ["最低预算必须在 0 到 1000 元之间"];
  if (request.budgetMaxCents !== null && (request.budgetMaxCents < 0 || request.budgetMaxCents > 100_000)) errors.budgetMaxCents = ["最高预算必须在 0 到 1000 元之间"];
  if (request.budgetMinCents !== null && request.budgetMaxCents !== null && request.budgetMinCents > request.budgetMaxCents) errors.budgetMaxCents = ["最高预算不能低于最低预算"];
  if (!request.teachingMode) errors.teachingMode = ["请选择授课方式"];
  if (!request.scheduleText?.trim()) errors.scheduleText = ["请填写可授课时间"];
  if (!request.publicLocationNote?.trim()) errors.publicLocationNote = ["请填写区县内的大致位置"];
  return errors;
}

export type StudentDto = Omit<Student, never>;
export type TutoringRequestDto = Omit<TutoringRequest, "parentProfileId">;
export function toRequestDto(request: TutoringRequest): TutoringRequestDto {
  const dto = { ...request } as Partial<TutoringRequest>;
  delete dto.parentProfileId;
  return dto as TutoringRequestDto;
}

export function createRequestService(repository: RequestRepository) {
  return {
    async listStudents(caller: Caller) { assertParent(caller); return repository.listStudents(caller.id); },
    async createStudent(caller: Caller, input: StudentInput) { assertParent(caller); return repository.createStudent(caller.id, normalizeStudent(input)); },
    async updateStudent(caller: Caller, id: string, input: StudentInput) { assertParent(caller); return repository.updateStudent(caller.id, id, normalizeStudent(input)); },
    async deactivateStudent(caller: Caller, id: string) { assertParent(caller); return repository.deactivateStudent(caller.id, id); },
    async listRequests(caller: Caller) { assertParent(caller); return repository.listRequests(caller.id); },
    async getRequest(caller: Caller, id: string) {
      assertParent(caller);
      const result = await repository.findRequest(caller.id, id);
      if (!result) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      return result;
    },
    async createDraft(caller: Caller, input: RequestDraftInput) { assertParent(caller); return repository.createRequest(caller.id, normalizeDraft(input)); },
    async updateDraft(caller: Caller, id: string, input: RequestDraftInput) { assertParent(caller); return repository.updateRequest(caller.id, id, normalizeDraft(input)); },
    async publish(caller: Caller, id: string) {
      assertParent(caller);
      const current = await repository.findRequest(caller.id, id);
      if (!current) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      if (current.status === "CLOSED") throw new RequestWorkflowError("CONFLICT", "已关闭的需求不可再次发布");
      const fieldErrors = validatePublishable(current);
      if (Object.keys(fieldErrors).length) throw new RequestWorkflowError("INCOMPLETE_REQUEST", "请完善需求后再发布", fieldErrors);
      return repository.publishRequest(caller.id, id);
    },
    async close(caller: Caller, id: string) { assertParent(caller); return repository.closeRequest(caller.id, id); },
  };
}

export type RequestService = ReturnType<typeof createRequestService>;
