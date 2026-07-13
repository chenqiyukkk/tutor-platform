import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  RequestWorkflowError,
  validatePublishable,
  type DraftValues,
  type RequestRepository,
  type Student,
  type TutoringRequest,
} from "./service";

const requestInclude = {
  studentProfile: true,
  region: true,
  subjects: { include: { subject: true } },
} satisfies Prisma.TutoringRequestInclude;
type RequestRow = Prisma.TutoringRequestGetPayload<{ include: typeof requestInclude }>;
type Client = Prisma.TransactionClient | PrismaClient;

function toStudent(row: { id: string; displayName: string; gradeLevel: string | null; notes: string | null; isActive: boolean }): Student {
  return { id: row.id, publicAlias: row.displayName, grade: (row.gradeLevel ?? "OTHER") as Student["grade"], notes: row.notes, isActive: row.isActive };
}

function toRequest(row: RequestRow): TutoringRequest {
  return {
    id: row.id,
    parentProfileId: row.parentProfileId,
    studentProfileId: row.studentProfileId,
    regionId: row.regionId,
    budgetMinCents: row.budgetMin,
    budgetMaxCents: row.budgetMax,
    teachingMode: row.teachingMode,
    scheduleText: row.scheduleText,
    publicLocationNote: row.publicLocationNote,
    description: row.description || null,
    status: row.status,
    publishedAt: row.publishedAt,
    closedAt: row.closedAt,
    student: row.studentProfile ? toStudent(row.studentProfile) : null,
    subjects: row.subjects.map(({ subject }) => ({ id: subject.id, name: subject.name, isActive: subject.isActive })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    region: row.region ? { id: row.region.id, name: row.region.name, level: row.region.level, isActive: row.region.isActive } : null,
  };
}

async function parentProfile(client: Client, accountId: string) {
  const account = await client.account.findUnique({ where: { id: accountId }, select: { role: true, username: true, parentProfile: { select: { id: true } } } });
  if (!account || account.role !== "PARENT") throw new RequestWorkflowError("FORBIDDEN", "仅家长账号可管理学生与家教需求");
  if (account.parentProfile) return account.parentProfile;
  return client.parentProfile.create({ data: { accountId, displayName: account.username }, select: { id: true } });
}

async function findOwnedRequest(client: Client, accountId: string, id: string) {
  return client.tutoringRequest.findFirst({ where: { id, parentProfile: { accountId } }, include: requestInclude });
}

async function validateReferences(client: Client, parentProfileId: string, input: DraftValues) {
  if (input.studentId) {
    const student = await client.studentProfile.findFirst({ where: { id: input.studentId, parentProfileId, isActive: true }, select: { id: true } });
    if (!student) throw new RequestWorkflowError("INVALID_STUDENT", "学生档案无效或不属于当前家长", { studentId: ["请选择自己的有效学生档案"] });
  }
  if (input.subjectIds.length) {
    const subjects = await client.subject.findMany({ where: { id: { in: input.subjectIds }, isActive: true }, select: { id: true } });
    if (subjects.length !== input.subjectIds.length) throw new RequestWorkflowError("INVALID_SUBJECT", "科目无效或已停用", { subjectIds: ["请选择有效且启用的科目"] });
  }
  if (input.regionId) {
    const region = await client.region.findFirst({ where: { id: input.regionId, isActive: true, level: 3 }, select: { id: true } });
    if (!region) throw new RequestWorkflowError("INVALID_REGION", "地区无效或已停用", { regionId: ["请选择有效且启用的区县"] });
  }
}

function requestData(input: DraftValues) {
  return {
    studentProfileId: input.studentId,
    regionId: input.regionId,
    title: "家教需求",
    description: input.description ?? "",
    scheduleText: input.scheduleText,
    budgetMin: input.budgetMinCents,
    budgetMax: input.budgetMaxCents,
    teachingMode: input.teachingMode,
    publicLocationNote: input.publicLocationNote,
  };
}

export class PrismaRequestRepository implements RequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listStudents(accountId: string) {
    const rows = await this.prisma.studentProfile.findMany({ where: { parentProfile: { accountId }, isActive: true }, orderBy: { updatedAt: "desc" } });
    return rows.map(toStudent);
  }

  async createStudent(accountId: string, input: Omit<Student, "id" | "isActive">) {
    return this.prisma.$transaction(async (transaction) => {
      const parent = await parentProfile(transaction, accountId);
      return toStudent(await transaction.studentProfile.create({ data: { parentProfileId: parent.id, displayName: input.publicAlias, gradeLevel: input.grade, notes: input.notes } }));
    });
  }

  async updateStudent(accountId: string, id: string, input: Omit<Student, "id" | "isActive">) {
    const row = await this.prisma.studentProfile.findFirst({ where: { id, parentProfile: { accountId }, isActive: true }, select: { id: true } });
    if (!row) throw new RequestWorkflowError("NOT_FOUND", "学生档案不存在");
    return toStudent(await this.prisma.studentProfile.update({ where: { id }, data: { displayName: input.publicAlias, gradeLevel: input.grade, notes: input.notes } }));
  }

  async deactivateStudent(accountId: string, id: string) {
    const result = await this.prisma.studentProfile.updateMany({ where: { id, parentProfile: { accountId }, isActive: true }, data: { isActive: false } });
    if (!result.count) throw new RequestWorkflowError("NOT_FOUND", "学生档案不存在");
  }

  async listRequests(accountId: string) {
    return (await this.prisma.tutoringRequest.findMany({ where: { parentProfile: { accountId } }, include: requestInclude, orderBy: { updatedAt: "desc" } })).map(toRequest);
  }

  async findRequest(accountId: string, id: string) {
    const row = await findOwnedRequest(this.prisma, accountId, id);
    return row ? toRequest(row) : null;
  }

  async createRequest(accountId: string, input: DraftValues) {
    return this.prisma.$transaction(async (transaction) => {
      const parent = await parentProfile(transaction, accountId);
      await validateReferences(transaction, parent.id, input);
      const row = await transaction.tutoringRequest.create({ data: {
        parentProfileId: parent.id,
        ...requestData(input),
        subjects: input.subjectIds.length ? { createMany: { data: input.subjectIds.map((subjectId) => ({ subjectId })) } } : undefined,
      }, include: requestInclude });
      return toRequest(row);
    });
  }

  async updateRequest(accountId: string, id: string, input: DraftValues) {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string; parentProfileId: string; status: string }>>`
        SELECT request."id", request."parentProfileId", request."status"::text
        FROM "TutoringRequest" request
        JOIN "ParentProfile" parent ON parent."id" = request."parentProfileId"
        WHERE request."id" = ${id}::uuid AND parent."accountId" = ${accountId}::uuid
        FOR UPDATE OF request
      `;
      const current = locked[0];
      if (!current) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      if (current.status === "CLOSED") throw new RequestWorkflowError("CONFLICT", "已关闭的需求不可编辑");
      await validateReferences(transaction, current.parentProfileId, input);
      await transaction.requestSubject.deleteMany({ where: { tutoringRequestId: id } });
      await transaction.tutoringRequest.update({ where: { id }, data: { ...requestData(input), status: "DRAFT", publishedAt: null, closedAt: null } });
      if (input.subjectIds.length) await transaction.requestSubject.createMany({ data: input.subjectIds.map((subjectId) => ({ tutoringRequestId: id, subjectId })) });
      const row = await findOwnedRequest(transaction, accountId, id);
      if (!row) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      return toRequest(row);
    });
  }

  async publishRequest(accountId: string, id: string) {
    return this.prisma.$transaction(async (transaction) => {
      const lock = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT request."id" FROM "TutoringRequest" request
        JOIN "ParentProfile" parent ON parent."id" = request."parentProfileId"
        WHERE request."id" = ${id}::uuid AND parent."accountId" = ${accountId}::uuid
        FOR UPDATE OF request
      `;
      if (!lock.length) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      let current = await findOwnedRequest(transaction, accountId, id);
      if (!current) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      if (current.status === "CLOSED") throw new RequestWorkflowError("CONFLICT", "已关闭的需求不可再次发布");
      const subjectIds = current.subjects.map(({ subjectId }) => subjectId).sort();
      if (subjectIds.length) {
        await transaction.$queryRaw`SELECT "id" FROM "Subject" WHERE "id" IN (${Prisma.join(subjectIds)}) ORDER BY "id" FOR SHARE`;
      }
      if (current.regionId) await transaction.$queryRaw`SELECT "id" FROM "Region" WHERE "id" = ${current.regionId}::uuid FOR SHARE`;
      if (current.studentProfileId) await transaction.$queryRaw`SELECT "id" FROM "StudentProfile" WHERE "id" = ${current.studentProfileId}::uuid FOR SHARE`;
      await transaction.$queryRaw`SELECT "id" FROM "ParentProfile" WHERE "id" = ${current.parentProfileId}::uuid FOR SHARE`;
      // Task 12 deactivation must use the same lock order: request(s), sorted
      // Subject IDs, Region, StudentProfile, then ParentProfile before changing
      // active flags or atomically demoting affected published requests.
      current = await findOwnedRequest(transaction, accountId, id);
      if (!current) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      const domain = toRequest(current);
      const errors = validatePublishable(domain);
      if (Object.keys(errors).length) throw new RequestWorkflowError("INCOMPLETE_REQUEST", "请完善需求后再发布", errors);
      if (!current.studentProfile || !current.studentProfile.isActive || current.studentProfile.parentProfileId !== current.parentProfileId) throw new RequestWorkflowError("INVALID_STUDENT", "学生档案无效", { studentId: ["请选择自己的有效学生档案"] });
      if (current.subjects.some(({ subject }) => !subject.isActive)) throw new RequestWorkflowError("INVALID_SUBJECT", "科目无效或已停用", { subjectIds: ["请选择有效且启用的科目"] });
      if (!current.region || !current.region.isActive || current.region.level !== 3) throw new RequestWorkflowError("INVALID_REGION", "地区无效或已停用", { regionId: ["请选择有效且启用的区县"] });
      const row = await transaction.tutoringRequest.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date(), closedAt: null }, include: requestInclude });
      return toRequest(row);
    });
  }

  async closeRequest(accountId: string, id: string) {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT request."id", request."status"::text FROM "TutoringRequest" request
        JOIN "ParentProfile" parent ON parent."id" = request."parentProfileId"
        WHERE request."id" = ${id}::uuid AND parent."accountId" = ${accountId}::uuid
        FOR UPDATE OF request
      `;
      if (!locked.length) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
      if (locked[0].status === "CLOSED") {
        const current = await findOwnedRequest(transaction, accountId, id);
        if (!current) throw new RequestWorkflowError("NOT_FOUND", "需求不存在");
        return toRequest(current);
      }
      return toRequest(await transaction.tutoringRequest.update({ where: { id }, data: { status: "CLOSED", publishedAt: null, closedAt: new Date() }, include: requestInclude }));
    });
  }
}
