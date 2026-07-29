import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { lockAccountPair } from "@/features/interactions/account-pair-lock";
import { privateEvidenceSchema } from "@/features/verifications/schema";
import type { PrivateEvidenceStorage } from "@/features/verifications/storage";

import {
  accountMutationSchema,
  reportMutationSchema,
  verificationMutationSchema,
  type AccountMutationInput,
  type ReportMutationInput,
  type VerificationMutationInput,
} from "./admin-schema";

export type AdminActor = { id: string; role: string };
export type AdminModerationErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_EVIDENCE";

export class AdminModerationError extends Error {
  constructor(readonly code: AdminModerationErrorCode, message: string) {
    super(message);
    this.name = "AdminModerationError";
  }
}

type Transaction = Prisma.TransactionClient;

function assertAdminRole(actor: AdminActor) {
  if (actor.role !== "admin") {
    throw new AdminModerationError("FORBIDDEN", "仅管理员可以执行该操作");
  }
}

async function assertActiveAdmin(client: PrismaClient | Transaction, actor: AdminActor) {
  const account = await client.account.findFirst({
    where: { id: actor.id, role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  if (!account) throw new AdminModerationError("UNAUTHORIZED", "管理员登录状态无效");
}

function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type AuditMetadata = {
  payloadHash: string;
  result: Record<string, string | null>;
};

function auditMetadata(value: Prisma.JsonValue | null): AuditMetadata | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const hash = value.payloadHash;
  const result = value.result;
  if (typeof hash !== "string" || !result || Array.isArray(result) || typeof result !== "object") return null;
  const safe: Record<string, string | null> = {};
  for (const [key, entry] of Object.entries(result)) {
    if (typeof entry !== "string" && entry !== null) return null;
    safe[key] = entry;
  }
  return { payloadHash: hash, result: safe };
}

async function replay(
  transaction: Transaction,
  actor: AdminActor,
  requestId: string,
  action: string,
  targetType: string,
  targetId: string,
  hash: string,
) {
  const existing = await transaction.adminAuditLog.findUnique({
    where: { requestId },
    select: {
      adminAccountId: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
    },
  });
  if (!existing) return null;
  const metadata = auditMetadata(existing.metadata);
  if (
    existing.adminAccountId !== actor.id
    || existing.action !== action
    || existing.targetType !== targetType
    || existing.targetId !== targetId
    || metadata?.payloadHash !== hash
  ) {
    throw new AdminModerationError("CONFLICT", "clientRequestId 已用于另一项管理员操作");
  }
  return true;
}

async function writeAudit(
  transaction: Transaction,
  actor: AdminActor,
  requestId: string,
  action: string,
  targetType: string,
  targetId: string,
  hash: string,
  result: Record<string, string | null>,
) {
  await transaction.adminAuditLog.create({
    data: {
      adminAccountId: actor.id,
      requestId,
      action,
      targetType,
      targetId,
      metadata: { payloadHash: hash, result },
    },
  });
}

function sameInstant(left: Date, expected: string) {
  return left.getTime() === new Date(expected).getTime();
}

async function lockAccounts(transaction: Transaction, accountIds: string[]) {
  const sorted = [...new Set(accountIds)].sort();
  if (!sorted.length) return;
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Account"
    WHERE "id" IN (${Prisma.join(sorted)})
    ORDER BY "id" FOR UPDATE
  `);
}

async function suspendAccount(
  transaction: Transaction,
  accountId: string,
  status: "ACTIVE" | "SUSPENDED",
  at: Date,
) {
  await transaction.account.update({ where: { id: accountId }, data: { status, updatedAt: at } });
  if (status === "SUSPENDED") {
    await transaction.session.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: at },
    });
    await transaction.teacherProfile.updateMany({
      where: { accountId, status: "PUBLISHED" },
      data: { status: "DRAFT", publishedAt: null, publicContentSafetyVersion: 0 },
    });
    await transaction.tutoringRequest.updateMany({
      where: { parentProfile: { accountId }, status: "PUBLISHED" },
      data: { status: "DRAFT", publishedAt: null, closedAt: null, publicContentSafetyVersion: 0 },
    });
  }
}

function retryableConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2002" || error.code === "P2034") return true;
  if (error.code !== "P2010" || !error.meta || typeof error.meta !== "object") return false;
  const adapter = "driverAdapterError" in error.meta ? error.meta.driverAdapterError : null;
  if (!adapter || typeof adapter !== "object" || !("cause" in adapter)) return false;
  const cause = adapter.cause;
  return !!cause && typeof cause === "object" && "originalCode" in cause
    && ["40001", "40P01", "23505"].includes(String(cause.originalCode));
}

function retryableTransaction(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || !error.meta || typeof error.meta !== "object") return false;
  const adapter = "driverAdapterError" in error.meta ? error.meta.driverAdapterError : null;
  if (!adapter || typeof adapter !== "object" || !("cause" in adapter)) return false;
  const cause = adapter.cause;
  return !!cause && typeof cause === "object" && "originalCode" in cause
    && ["40001", "40P01"].includes(String(cause.originalCode));
}

export function createAdminModerationService(
  prisma: PrismaClient,
  storage: PrivateEvidenceStorage,
  now: () => Date = () => new Date(),
) {
  async function safely<T>(operation: () => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (retryableTransaction(error) && attempt < 2) continue;
        if (retryableConflict(error)) {
          throw new AdminModerationError("CONFLICT", "管理员操作发生冲突");
        }
        throw error;
      }
    }
    throw new AdminModerationError("CONFLICT", "管理员操作发生冲突");
  }

  return {
    async updateAccount(actor: AdminActor, accountId: string, rawInput: AccountMutationInput | unknown) {
      assertAdminRole(actor);
      const input = accountMutationSchema.parse(rawInput);
      const hash = payloadHash(input);
      return safely(() => prisma.$transaction(async (transaction) => {
        await lockAccounts(transaction, [actor.id, accountId]);
        await assertActiveAdmin(transaction, actor);
        if (accountId === actor.id) throw new AdminModerationError("FORBIDDEN", "不能修改自己的管理员状态");
        const repeated = await replay(transaction, actor, input.clientRequestId, "USER_STATUS", "ACCOUNT", accountId, hash);
        if (repeated) {
          const current = await transaction.account.findUnique({
            where: { id: accountId }, select: { status: true, updatedAt: true },
          });
          if (!current) throw new AdminModerationError("NOT_FOUND", "用户不存在");
          return { status: current.status, updatedAt: current.updatedAt.toISOString() };
        }
        const target = await transaction.account.findUnique({
          where: { id: accountId },
          select: { id: true, status: true, updatedAt: true },
        });
        if (!target) throw new AdminModerationError("NOT_FOUND", "用户不存在");
        if (!sameInstant(target.updatedAt, input.expectedUpdatedAt)) {
          throw new AdminModerationError("CONFLICT", "用户状态已发生变化");
        }
        const at = now();
        await suspendAccount(transaction, accountId, input.status, at);
        const result = { status: input.status, updatedAt: at.toISOString() };
        await writeAudit(transaction, actor, input.clientRequestId, "USER_STATUS", "ACCOUNT", accountId, hash, result);
        return result;
      }, { isolationLevel: "Serializable" }));
    },

    async decideReport(actor: AdminActor, reportId: string, rawInput: ReportMutationInput | unknown) {
      assertAdminRole(actor);
      const input = reportMutationSchema.parse(rawInput);
      const hash = payloadHash(input);
      await assertActiveAdmin(prisma, actor);
      const preliminary = await prisma.report.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          targetType: true,
          message: { select: { conversation: { select: { teacherId: true, parentId: true } } } },
        },
      });
      if (!preliminary) throw new AdminModerationError("NOT_FOUND", "举报不存在");
      const pair = preliminary.message?.conversation ?? null;
      return safely(() => prisma.$transaction(async (transaction) => {
        if (pair) await lockAccountPair(transaction, pair.teacherId, pair.parentId);
        await assertActiveAdmin(transaction, actor);
        const repeated = await replay(transaction, actor, input.clientRequestId, "REPORT_DECISION", "REPORT", reportId, hash);
        if (repeated) {
          const current = await transaction.report.findUnique({
            where: { id: reportId }, select: { status: true, updatedAt: true, resolutionAction: true },
          });
          if (!current) throw new AdminModerationError("NOT_FOUND", "举报不存在");
          return {
            status: current.status,
            updatedAt: current.updatedAt.toISOString(),
            resolutionAction: current.resolutionAction,
          };
        }
        await transaction.$queryRaw`SELECT "id" FROM "Report" WHERE "id" = ${reportId}::uuid FOR UPDATE`;
        const report = await transaction.report.findUnique({
          where: { id: reportId },
          select: {
            id: true, status: true, updatedAt: true, targetType: true,
            reportedAccountId: true, teacherProfileId: true, tutoringRequestId: true,
            messageId: true,
            message: { select: { conversationId: true, conversation: { select: { teacherId: true, parentId: true } } } },
          },
        });
        if (!report) throw new AdminModerationError("NOT_FOUND", "举报不存在");
        if (!sameInstant(report.updatedAt, input.expectedUpdatedAt)) {
          throw new AdminModerationError("CONFLICT", "举报已被其他管理员处理");
        }
        if (report.status !== "PENDING" && report.status !== "REVIEWING") {
          throw new AdminModerationError("CONFLICT", "举报已结束");
        }
        if (input.decision === "START_REVIEW" && report.status !== "PENDING") {
          throw new AdminModerationError("CONFLICT", "举报已进入审核流程");
        }
        if (pair && (
          report.message?.conversation.teacherId !== pair.teacherId
          || report.message.conversation.parentId !== pair.parentId
        )) throw new AdminModerationError("CONFLICT", "举报上下文已发生变化");

        const at = now();
        let status: "REVIEWING" | "RESOLVED" | "DISMISSED";
        let resolutionAction: "NONE" | "CONTENT_TAKEDOWN" | "ACCOUNT_SUSPENSION" | null = null;
        let resolution: string | null = null;
        if (input.decision === "START_REVIEW") {
          status = "REVIEWING";
        } else {
          status = input.decision === "DISMISS" ? "DISMISSED" : "RESOLVED";
          resolutionAction = input.resolutionAction;
          resolution = input.reviewNote;
          if (input.resolutionAction === "ACCOUNT_SUSPENSION") {
            if (!report.reportedAccountId || report.reportedAccountId === actor.id) {
              throw new AdminModerationError("CONFLICT", "举报没有可停用的目标账号");
            }
            await lockAccounts(transaction, [report.reportedAccountId]);
            const account = await transaction.account.findUnique({ where: { id: report.reportedAccountId }, select: { id: true } });
            if (!account) throw new AdminModerationError("CONFLICT", "目标账号不存在");
            await suspendAccount(transaction, report.reportedAccountId, "SUSPENDED", at);
          }
          if (input.resolutionAction === "CONTENT_TAKEDOWN") {
            if (report.targetType === "TEACHER_PROFILE" && report.teacherProfileId) {
              await transaction.$queryRaw`SELECT "id" FROM "TeacherProfile" WHERE "id" = ${report.teacherProfileId}::uuid FOR UPDATE`;
              await transaction.teacherProfile.update({ where: { id: report.teacherProfileId }, data: {
                status: "DRAFT", publishedAt: null, publicContentSafetyVersion: 0,
                moderationRejectedAt: at, moderationReason: input.reviewNote,
              } });
            } else if (report.targetType === "TUTORING_REQUEST" && report.tutoringRequestId) {
              await transaction.$queryRaw`SELECT "id" FROM "TutoringRequest" WHERE "id" = ${report.tutoringRequestId}::uuid FOR UPDATE`;
              await transaction.tutoringRequest.update({ where: { id: report.tutoringRequestId }, data: {
                status: "DRAFT", publishedAt: null, closedAt: null, publicContentSafetyVersion: 0,
                moderationRejectedAt: at, moderationReason: input.reviewNote,
              } });
            } else if (report.targetType === "MESSAGE" && report.messageId) {
              await transaction.$queryRaw`SELECT "id" FROM "Message" WHERE "id" = ${report.messageId}::uuid FOR UPDATE`;
              await transaction.message.update({ where: { id: report.messageId }, data: { deletedAt: at, updatedAt: at } });
            } else {
              throw new AdminModerationError("CONFLICT", "该举报目标不支持内容下架");
            }
          }
        }
        const updated = await transaction.report.update({
          where: { id: reportId },
          data: {
            status,
            reviewerAccountId: actor.id,
            reviewedAt: input.decision === "START_REVIEW" ? null : at,
            resolution,
            resolutionAction,
          },
          select: { status: true, updatedAt: true, resolutionAction: true },
        });
        const result = {
          status: updated.status,
          updatedAt: updated.updatedAt.toISOString(),
          resolutionAction: updated.resolutionAction,
        };
        await writeAudit(transaction, actor, input.clientRequestId, "REPORT_DECISION", "REPORT", reportId, hash, result);
        return result;
      }, { isolationLevel: "Serializable" }));
    },

    async decideVerification(actor: AdminActor, verificationId: string, rawInput: VerificationMutationInput | unknown) {
      assertAdminRole(actor);
      const input = verificationMutationSchema.parse(rawInput);
      const hash = payloadHash(input);
      return safely(() => prisma.$transaction(async (transaction) => {
        await assertActiveAdmin(transaction, actor);
        const repeated = await replay(transaction, actor, input.clientRequestId, "VERIFICATION_DECISION", "VERIFICATION", verificationId, hash);
        if (repeated) {
          const current = await transaction.verification.findUnique({
            where: { id: verificationId }, select: { status: true, updatedAt: true, reviewedAt: true },
          });
          if (!current) throw new AdminModerationError("NOT_FOUND", "认证申请不存在");
          return {
            status: current.status,
            updatedAt: current.updatedAt.toISOString(),
            reviewedAt: current.reviewedAt?.toISOString() ?? null,
          };
        }
        await transaction.$queryRaw`SELECT "id" FROM "Verification" WHERE "id" = ${verificationId}::uuid FOR UPDATE`;
        const verification = await transaction.verification.findUnique({
          where: { id: verificationId },
          select: { id: true, accountId: true, teacherProfileId: true, type: true, status: true, updatedAt: true },
        });
        if (!verification) throw new AdminModerationError("NOT_FOUND", "认证申请不存在");
        if (!sameInstant(verification.updatedAt, input.expectedUpdatedAt) || verification.status !== "PENDING") {
          throw new AdminModerationError("CONFLICT", "认证申请已被其他管理员处理");
        }
        const at = now();
        if (input.decision === "APPROVE") {
          await lockAccounts(transaction, [verification.accountId]);
          const applicant = await transaction.account.findFirst({
            where: { id: verification.accountId, role: "TEACHER", status: "ACTIVE" },
            select: { teacherProfile: { select: { id: true } } },
          });
          if (!applicant?.teacherProfile || applicant.teacherProfile.id !== verification.teacherProfileId) {
            throw new AdminModerationError("CONFLICT", "老师账号或资料已失效");
          }
          await transaction.verification.updateMany({
            where: {
              id: { not: verification.id }, accountId: verification.accountId,
              type: verification.type, status: "APPROVED",
            },
            data: { status: "EXPIRED", expiresAt: at },
          });
        }
        const updated = await transaction.verification.update({
          where: { id: verificationId },
          data: {
            status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
            reviewerAccountId: actor.id,
            reviewedAt: at,
            reviewNote: input.decision === "REJECT" ? input.reviewNote : null,
          },
          select: { status: true, updatedAt: true, reviewedAt: true },
        });
        const result = {
          status: updated.status,
          updatedAt: updated.updatedAt.toISOString(),
          reviewedAt: updated.reviewedAt?.toISOString() ?? null,
        };
        await writeAudit(transaction, actor, input.clientRequestId, "VERIFICATION_DECISION", "VERIFICATION", verificationId, hash, result);
        return result;
      }, { isolationLevel: "Serializable" }));
    },

    async readVerificationEvidence(actor: AdminActor, verificationId: string) {
      assertAdminRole(actor);
      const loaded = await prisma.$transaction(async (transaction) => {
        await assertActiveAdmin(transaction, actor);
        const verification = await transaction.verification.findUnique({
          where: { id: verificationId },
          select: { evidence: true },
        });
        if (!verification) throw new AdminModerationError("NOT_FOUND", "认证申请不存在");
        const evidence = privateEvidenceSchema.safeParse(verification.evidence);
        if (!evidence.success) throw new AdminModerationError("INVALID_EVIDENCE", "认证材料不可用");
        return evidence.data;
      }, { isolationLevel: "ReadCommitted" });
      const bytes = await storage.read(loaded.key);
      await prisma.$transaction(async (transaction) => {
        await assertActiveAdmin(transaction, actor);
        const verification = await transaction.verification.findUnique({
          where: { id: verificationId },
          select: { evidence: true },
        });
        const current = privateEvidenceSchema.safeParse(verification?.evidence);
        if (!current.success || payloadHash(current.data) !== payloadHash(loaded)) {
          throw new AdminModerationError("CONFLICT", "认证材料已发生变化");
        }
        await transaction.adminAuditLog.create({
          data: {
            adminAccountId: actor.id,
            requestId: randomUUID(),
            action: "VERIFICATION_EVIDENCE_VIEW",
            targetType: "VERIFICATION",
            targetId: verificationId,
            metadata: { result: { mimeType: loaded.mimeType } },
          },
        });
      }, { isolationLevel: "ReadCommitted" });
      return { bytes, mimeType: loaded.mimeType };
    },
  };
}

export type AdminModerationService = ReturnType<typeof createAdminModerationService>;
