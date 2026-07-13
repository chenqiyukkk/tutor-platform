import { z } from "zod";

const paginationShape = {
  page: z.number().int().min(1).max(100).default(1),
  pageSize: z.number().int().min(1).max(24).default(12),
};

const commonShape = {
  district: z.string().uuid().optional(),
  subject: z.string().uuid().optional(),
  mode: z.enum(["ONLINE", "OFFLINE"]).optional(),
  budgetMin: z.number().int().min(0).max(100_000_000).optional(),
  budgetMax: z.number().int().min(0).max(100_000_000).optional(),
  ...paginationShape,
};

const teacherSchema = z.object({
  ...commonShape,
  identityType: z.enum(["UNIVERSITY_STUDENT", "FULL_TIME_TEACHER", "OTHER"]).optional(),
}).strict().refine(
  ({ budgetMin, budgetMax }) => budgetMin === undefined || budgetMax === undefined || budgetMin <= budgetMax,
  { message: "最低预算不能高于最高预算" },
);

const requestSchema = z.object(commonShape).strict().refine(
  ({ budgetMin, budgetMax }) => budgetMin === undefined || budgetMax === undefined || budgetMin <= budgetMax,
  { message: "最低预算不能高于最高预算" },
);

export class DirectoryQueryError extends Error {
  readonly code = "INVALID_QUERY";

  constructor(message = "筛选条件格式不正确") {
    super(message);
    this.name = "DirectoryQueryError";
  }
}

function parseInteger(name: string, value: string) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new DirectoryQueryError(`${name} 必须是非负整数`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new DirectoryQueryError(`${name} 超出有效范围`);
  }
  return parsed;
}

function paramsObject(searchParams: URLSearchParams, allowed: ReadonlySet<string>) {
  const result: Record<string, string | number> = {};
  for (const key of new Set(searchParams.keys())) {
    if (!allowed.has(key)) throw new DirectoryQueryError(`不支持筛选参数 ${key}`);
    const values = searchParams.getAll(key);
    if (values.length !== 1) throw new DirectoryQueryError(`${key} 不能重复`);
    const value = values[0];
    if (!value) throw new DirectoryQueryError(`${key} 不能为空`);
    result[key] = ["page", "pageSize", "budgetMin", "budgetMax"].includes(key)
      ? parseInteger(key, value)
      : value;
  }
  return result;
}

function parseWith<T>(
  searchParams: URLSearchParams,
  allowed: readonly string[],
  schema: z.ZodType<T>,
) {
  try {
    return schema.parse(paramsObject(searchParams, new Set(allowed)));
  } catch (error) {
    if (error instanceof DirectoryQueryError) throw error;
    throw new DirectoryQueryError();
  }
}

const commonKeys = ["district", "subject", "mode", "budgetMin", "budgetMax", "page", "pageSize"];

export function parseTeacherDirectoryQuery(searchParams: URLSearchParams) {
  return parseWith(searchParams, [...commonKeys, "identityType"], teacherSchema);
}

export function parseRequestDirectoryQuery(searchParams: URLSearchParams) {
  return parseWith(searchParams, commonKeys, requestSchema);
}

export type TeacherDirectoryQuery = ReturnType<typeof parseTeacherDirectoryQuery>;
export type RequestDirectoryQuery = ReturnType<typeof parseRequestDirectoryQuery>;

const filterKeyFields = [
  "district",
  "subject",
  "identityType",
  "mode",
  "budgetMin",
  "budgetMax",
] as const;

export function directoryFilterKey(query: TeacherDirectoryQuery | RequestDirectoryQuery) {
  const params = new URLSearchParams();
  for (const field of filterKeyFields) {
    const value = field in query ? query[field as keyof typeof query] : undefined;
    if (value !== undefined) params.set(field, String(value));
  }
  return params.toString();
}
