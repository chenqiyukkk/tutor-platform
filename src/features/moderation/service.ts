import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { lockAccountPair } from "@/features/interactions/account-pair-lock";

import {
  resolveModerationTarget,
  targetIdentity,
  type ModerationActor,
  type ResolvedModerationTarget,
} from "./data";
import {
  createBlockInputSchema,
  createReportInputSchema,
  type CreateBlockInput,
  type CreateReportInput,
} from "./schema";

export type ModerationErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT";

export class ModerationWorkflowError extends Error {
  constructor(readonly code: ModerationErrorCode, message: string) {
    super(message);
    this.name = "ModerationWorkflowError";
  }
}

function expectedDatabaseRole(role: string) {
  if (role === "parent") return "PARENT" as const;
  if (role === "teacher") return "TEACHER" as const;
  throw new ModerationWorkflowError("FORBIDDEN", "仅家长或老师可以使用安全功能");
}

async function assertActiveActor(
  client: PrismaClient | Prisma.TransactionClient,
  actor: ModerationActor,
) {
  const role = expectedDatabaseRole(actor.role);
  const account = await client.account.findFirst({
    where: { id: actor.id, role, status: "ACTIVE" },
    select: { id: true },
  });
  if (!account) throw new ModerationWorkflowError("UNAUTHORIZED", "登录状态无效");
}

function reportDto(row: { id: string; status: string }) {
  return { reportId: row.id, status: row.status };
}

function sameReportPayload(
  row: { targetType: string; targetId: string; reason: string; details: string | null },
  input: CreateReportInput,
) {
  const target = targetIdentity(input.target);
  return row.targetType === target.targetType
    && row.targetId === target.targetId
    && row.reason === input.reason
    && row.details === (input.details ?? null);
}

function retryableReportRace(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002" || error.code === "P2034");
}

async function lockGreetingContext(transaction: Prisma.TransactionClient, contextKey: string) {
  const key = `greeting-context:${contextKey}`;
  await transaction.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export function createModerationService(prisma: PrismaClient, now: () => Date = () => new Date()) {
  async function createReportAttempt(
    actor: ModerationActor,
    input: CreateReportInput,
    preliminaryGreeting?: ResolvedModerationTarget,
  ) {
    return prisma.$transaction(async (transaction) => {
      if (preliminaryGreeting) {
        await lockAccountPair(
          transaction,
          preliminaryGreeting.pair.teacherId,
          preliminaryGreeting.pair.parentId,
        );
        await lockGreetingContext(transaction, preliminaryGreeting.greetingContextKey!);
      }
      await assertActiveActor(transaction, actor);

      let resolved = preliminaryGreeting
        ? await resolveModerationTarget(transaction, actor, input.target, now(), "report")
        : undefined;
      if (preliminaryGreeting && (
        !resolved
        || resolved.targetType !== preliminaryGreeting.targetType
        || resolved.targetId !== preliminaryGreeting.targetId
        || resolved.reportedAccountId !== preliminaryGreeting.reportedAccountId
        || resolved.pair.teacherId !== preliminaryGreeting.pair.teacherId
        || resolved.pair.parentId !== preliminaryGreeting.pair.parentId
        || resolved.greetingContextKey !== preliminaryGreeting.greetingContextKey
      )) {
        throw new ModerationWorkflowError("NOT_FOUND", "目标不存在");
      }

      const replay = await transaction.report.findUnique({
        where: {
          reporterAccountId_clientRequestId: {
            reporterAccountId: actor.id,
            clientRequestId: input.clientRequestId,
          },
        },
        select: { id: true, status: true, targetType: true, targetId: true, reason: true, details: true },
      });
      if (replay) {
        if (!sameReportPayload(replay, input)) {
          throw new ModerationWorkflowError("CONFLICT", "clientRequestId 已用于另一项举报");
        }
        if (resolved?.pendingGreeting) {
          const updated = await transaction.greeting.updateMany({
            where: { id: resolved.greetingId, status: "PENDING" },
            data: { status: "REPORTED", respondedAt: now() },
          });
          if (updated.count !== 1) throw new ModerationWorkflowError("CONFLICT", "问候状态已发生变化");
        }
        return reportDto(replay);
      }

      resolved ??= await resolveModerationTarget(transaction, actor, input.target, now(), "report");
      if (!resolved) throw new ModerationWorkflowError("NOT_FOUND", "目标不存在");
      if (resolved.reportedAccountId === actor.id) {
        throw new ModerationWorkflowError("FORBIDDEN", "不能举报自己");
      }

      const open = await transaction.report.findFirst({
        where: {
          reporterAccountId: actor.id,
          targetType: resolved.targetType,
          targetId: resolved.targetId,
          status: { in: ["PENDING", "REVIEWING"] },
        },
        select: { id: true, status: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (open) {
        throw new ModerationWorkflowError("CONFLICT", "该目标已有待处理举报");
      }

      const created = await transaction.report.create({
        data: {
          reporterAccountId: actor.id,
          reportedAccountId: resolved.reportedAccountId,
          teacherProfileId: resolved.teacherProfileId,
          tutoringRequestId: resolved.tutoringRequestId,
          greetingId: resolved.greetingId,
          conversationId: resolved.conversationId,
          messageId: resolved.messageId,
          targetType: resolved.targetType,
          targetId: resolved.targetId,
          clientRequestId: input.clientRequestId,
          targetSnapshot: resolved.snapshot,
          reason: input.reason,
          details: input.details ?? null,
        },
        select: { id: true, status: true },
      });
      if (resolved.pendingGreeting) {
        const updated = await transaction.greeting.updateMany({
          where: { id: resolved.greetingId, status: "PENDING" },
          data: { status: "REPORTED", respondedAt: now() },
        });
        if (updated.count !== 1) throw new ModerationWorkflowError("CONFLICT", "问候状态已发生变化");
      }
      return reportDto(created);
    }, { isolationLevel: "RepeatableRead" });
  }

  return {
    async createReport(actor: ModerationActor, rawInput: CreateReportInput | unknown) {
      const input = createReportInputSchema.parse(rawInput);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          let preliminaryGreeting: ResolvedModerationTarget | undefined;
          if (input.target.kind === "greeting") {
            await assertActiveActor(prisma, actor);
            preliminaryGreeting = await resolveModerationTarget(prisma, actor, input.target, now(), "report") ?? undefined;
          }
          return await createReportAttempt(actor, input, preliminaryGreeting);
        } catch (error) {
          if (!retryableReportRace(error)) throw error;
          if (attempt === 4) {
            throw new ModerationWorkflowError("CONFLICT", "举报请求发生冲突，请重试");
          }
        }
      }
      throw new ModerationWorkflowError("CONFLICT", "举报请求发生冲突，请重试");
    },

    async createBlock(actor: ModerationActor, rawInput: CreateBlockInput | unknown) {
      const input = createBlockInputSchema.parse(rawInput);
      await assertActiveActor(prisma, actor);
      const preliminary = await resolveModerationTarget(prisma, actor, input.target, now(), "block");
      if (!preliminary) throw new ModerationWorkflowError("NOT_FOUND", "目标不存在");
      if (preliminary.reportedAccountId === actor.id) {
        throw new ModerationWorkflowError("FORBIDDEN", "不能屏蔽自己");
      }

      return prisma.$transaction(async (transaction) => {
        // This must remain the first lock in the transaction. Greeting and chat
        // sends use the same sorted advisory key before reading Block.
        await lockAccountPair(transaction, preliminary.pair.teacherId, preliminary.pair.parentId);
        await assertActiveActor(transaction, actor);
        const resolved = await resolveModerationTarget(transaction, actor, input.target, now(), "block");
        if (
          !resolved
          || resolved.targetType !== preliminary.targetType
          || resolved.targetId !== preliminary.targetId
          || resolved.reportedAccountId !== preliminary.reportedAccountId
          || resolved.pair.teacherId !== preliminary.pair.teacherId
          || resolved.pair.parentId !== preliminary.pair.parentId
        ) {
          throw new ModerationWorkflowError("NOT_FOUND", "目标不存在");
        }
        if (resolved.reportedAccountId === actor.id) {
          throw new ModerationWorkflowError("FORBIDDEN", "不能屏蔽自己");
        }
        await transaction.block.upsert({
          where: {
            blockerAccountId_blockedAccountId: {
              blockerAccountId: actor.id,
              blockedAccountId: resolved.reportedAccountId,
            },
          },
          create: {
            blockerAccountId: actor.id,
            blockedAccountId: resolved.reportedAccountId,
            reason: input.reason,
          },
          update: {},
        });
        return { blocked: true as const };
      }, { isolationLevel: "ReadCommitted" });
    },
  };
}

export type ModerationService = ReturnType<typeof createModerationService>;
