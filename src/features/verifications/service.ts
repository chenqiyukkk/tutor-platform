import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { privateEvidenceSchema, verificationSubmissionFieldsSchema, type VerificationType } from "./schema";
import {
  type EvidenceUpload,
  type PrivateEvidence,
  type PrivateEvidenceStorage,
  storePrivateEvidence,
} from "./storage";

export type VerificationStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
export type VerificationCaller = { id: string; role: "teacher" | "parent" | "admin" };

export type VerificationRecord = {
  id: string;
  accountId: string;
  teacherProfileId: string | null;
  clientRequestId: string | null;
  type: string;
  status: VerificationStatus;
  evidence: PrivateEvidence | null;
  reviewNote: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  expiresAt: Date | null;
};

export type VerificationDto = {
  id: string;
  type: string;
  status: VerificationStatus;
  submittedAt: string;
  reviewedAt: string | null;
  expiresAt: string | null;
  reviewNote: string | null;
};

export type VerificationApplicant = {
  accountId: string;
  role: "TEACHER" | "PARENT" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  teacherProfileId: string | null;
};

export type NewVerificationRecord = Pick<
  VerificationRecord,
  "accountId" | "teacherProfileId" | "clientRequestId" | "type" | "evidence"
>;

export interface VerificationRepository {
  transaction<T>(operation: (repository: VerificationRepository) => Promise<T>): Promise<T>;
  getApplicant(accountId: string): Promise<VerificationApplicant | null>;
  listByAccount(accountId: string): Promise<VerificationRecord[]>;
  findByClientRequestId(accountId: string, clientRequestId: string): Promise<VerificationRecord | null>;
  findPendingByType(accountId: string, type: VerificationType): Promise<VerificationRecord | null>;
  create(input: NewVerificationRecord): Promise<VerificationRecord>;
}

export type VerificationErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "PROFILE_REQUIRED"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "DISABLED";

export class VerificationWorkflowError extends Error {
  constructor(readonly code: VerificationErrorCode, message: string) {
    super(message);
    this.name = "VerificationWorkflowError";
  }
}

function assertTeacher(caller: VerificationCaller) {
  if (caller.role !== "teacher") {
    throw new VerificationWorkflowError("FORBIDDEN", "只有老师可以提交认证材料");
  }
}

function assertApplicant(applicant: VerificationApplicant | null) {
  if (!applicant || applicant.role !== "TEACHER" || applicant.status !== "ACTIVE") {
    throw new VerificationWorkflowError("UNAUTHORIZED", "登录状态无效");
  }
  if (!applicant.teacherProfileId) {
    throw new VerificationWorkflowError("PROFILE_REQUIRED", "请先创建老师资料");
  }
  return applicant.teacherProfileId;
}

function toDto(record: VerificationRecord): VerificationDto {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    submittedAt: record.submittedAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    reviewNote: record.reviewNote,
  };
}

function sameSubmission(record: VerificationRecord, type: VerificationType, evidence: PrivateEvidence) {
  return record.type === type && record.evidence?.sha256 === evidence.sha256;
}

function prismaRace(error: unknown, code: "P2002" | "P2034") {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export type VerificationService = ReturnType<typeof createVerificationService>;

export function createVerificationService(
  repository: VerificationRepository,
  storage: PrivateEvidenceStorage,
) {
  async function requireApplicant(accountId: string) {
    return assertApplicant(await repository.getApplicant(accountId));
  }

  async function submitInTransaction(
    accountId: string,
    type: VerificationType,
    clientRequestId: string,
    evidence: PrivateEvidence,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await repository.transaction(async (transaction) => {
          const teacherProfileId = assertApplicant(await transaction.getApplicant(accountId));
          const replay = await transaction.findByClientRequestId(accountId, clientRequestId);
          if (replay) {
            if (!sameSubmission(replay, type, evidence)) {
              throw new VerificationWorkflowError("CONFLICT", "幂等请求与原提交不一致");
            }
            return { record: replay, created: false };
          }
          if (await transaction.findPendingByType(accountId, type)) {
            throw new VerificationWorkflowError("CONFLICT", "该认证类型已有待审核材料");
          }
          return {
            record: await transaction.create({
              accountId,
              teacherProfileId,
              clientRequestId,
              type,
              evidence,
            }),
            created: true,
          };
        });
      } catch (error) {
        if (prismaRace(error, "P2034") && attempt < 2) continue;
        if (prismaRace(error, "P2002") || prismaRace(error, "P2034")) {
          const existing = await repository.transaction((transaction) =>
            transaction.findByClientRequestId(accountId, clientRequestId));
          if (existing && sameSubmission(existing, type, evidence)) {
            return { record: existing, created: false };
          }
          throw new VerificationWorkflowError("CONFLICT", "认证提交发生冲突");
        }
        throw error;
      }
    }
    throw new VerificationWorkflowError("CONFLICT", "认证提交发生冲突");
  }

  return {
    async list(caller: VerificationCaller) {
      assertTeacher(caller);
      return repository.transaction(async (transaction) => {
        assertApplicant(await transaction.getApplicant(caller.id));
        return (await transaction.listByAccount(caller.id)).map(toDto);
      });
    },

    async submit(caller: VerificationCaller, rawInput: {
      type: unknown;
      clientRequestId: unknown;
      file: EvidenceUpload;
    }) {
      assertTeacher(caller);
      if (!storage.enabled) {
        throw new VerificationWorkflowError("DISABLED", "认证材料上传暂未开放");
      }
      const parsed = verificationSubmissionFieldsSchema.safeParse({
        type: rawInput.type,
        clientRequestId: rawInput.clientRequestId,
      });
      if (!parsed.success) {
        throw new VerificationWorkflowError("INVALID_INPUT", "认证提交内容无效");
      }
      await requireApplicant(caller.id);

      return storePrivateEvidence(storage, rawInput.file, async (evidence) => {
        const result = await submitInTransaction(
          caller.id,
          parsed.data.type,
          parsed.data.clientRequestId,
          evidence,
        );
        if (!result.created) await storage.remove(evidence.key);
        return toDto(result.record);
      }, async (evidence) => {
        const existing = await repository.transaction((transaction) =>
          transaction.findByClientRequestId(caller.id, parsed.data.clientRequestId));
        if (!existing) return { state: "not-committed" as const };
        if (sameSubmission(existing, parsed.data.type, evidence) && existing.evidence) {
          return {
            state: "committed" as const,
            value: toDto(existing),
            referencedKey: existing.evidence.key,
          };
        }
        return {
          state: "conflict" as const,
          error: new VerificationWorkflowError("CONFLICT", "幂等请求与原提交不一致"),
        };
      });
    },
  };
}

type Database = PrismaClient;
type ScopedDatabase = Prisma.TransactionClient | PrismaClient;

function toRecord(row: {
  id: string;
  accountId: string;
  teacherProfileId: string | null;
  clientRequestId: string | null;
  type: string;
  status: VerificationStatus;
  evidence: Prisma.JsonValue | null;
  reviewNote: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  expiresAt: Date | null;
}): VerificationRecord {
  const evidence = privateEvidenceSchema.safeParse(row.evidence);
  return { ...row, evidence: evidence.success ? evidence.data : null };
}

export function createPrismaVerificationRepository(database: Database): VerificationRepository {
  function scoped(client: ScopedDatabase, lockApplicant: boolean): VerificationRepository {
    return {
      transaction: (operation) => database.$transaction((transaction) => operation(scoped(transaction, true))),

      async getApplicant(accountId) {
        if (lockApplicant) {
          await client.$queryRaw(Prisma.sql`
            SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid FOR SHARE
          `);
          await client.$queryRaw(Prisma.sql`
            SELECT "id" FROM "TeacherProfile" WHERE "accountId" = ${accountId}::uuid FOR SHARE
          `);
        }
        const row = await client.account.findUnique({
          where: { id: accountId },
          select: {
            id: true,
            role: true,
            status: true,
            teacherProfile: { select: { id: true } },
          },
        });
        return row ? {
          accountId: row.id,
          role: row.role,
          status: row.status,
          teacherProfileId: row.teacherProfile?.id ?? null,
        } : null;
      },

      async listByAccount(accountId) {
        return (await client.verification.findMany({
          where: { accountId },
          orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
          select: {
            id: true, accountId: true, teacherProfileId: true, clientRequestId: true,
            type: true, status: true, evidence: true, reviewNote: true,
            submittedAt: true, reviewedAt: true, expiresAt: true,
          },
        })).map(toRecord);
      },

      async findByClientRequestId(accountId, clientRequestId) {
        const row = await client.verification.findFirst({
          where: { accountId, clientRequestId },
          select: {
            id: true, accountId: true, teacherProfileId: true, clientRequestId: true,
            type: true, status: true, evidence: true, reviewNote: true,
            submittedAt: true, reviewedAt: true, expiresAt: true,
          },
        });
        return row ? toRecord(row) : null;
      },

      async findPendingByType(accountId, type) {
        const row = await client.verification.findFirst({
          where: { accountId, type, status: "PENDING" },
          select: {
            id: true, accountId: true, teacherProfileId: true, clientRequestId: true,
            type: true, status: true, evidence: true, reviewNote: true,
            submittedAt: true, reviewedAt: true, expiresAt: true,
          },
        });
        return row ? toRecord(row) : null;
      },

      async create(input) {
        const row = await client.verification.create({
          data: {
            accountId: input.accountId,
            teacherProfileId: input.teacherProfileId,
            clientRequestId: input.clientRequestId,
            type: input.type,
            evidence: input.evidence as Prisma.InputJsonValue,
          },
          select: {
            id: true, accountId: true, teacherProfileId: true, clientRequestId: true,
            type: true, status: true, evidence: true, reviewNote: true,
            submittedAt: true, reviewedAt: true, expiresAt: true,
          },
        });
        return toRecord(row);
      },
    };
  }

  return scoped(database, false);
}
