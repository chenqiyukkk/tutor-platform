import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createBlockInputSchema,
  createReportInputSchema,
  moderationTargetSchema,
} from "./schema";
import { createModerationService } from "./service";

const ids = {
  profileId: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  greetingId: "33333333-3333-4333-8333-333333333333",
  conversationId: "44444444-4444-4444-8444-444444444444",
  messageId: "55555555-5555-4555-8555-555555555555",
  clientRequestId: "66666666-6666-4666-8666-666666666666",
  accountId: "77777777-7777-4777-8777-777777777777",
  targetAccountId: "88888888-8888-4888-8888-888888888888",
};

const targets = [
  { kind: "teacher_profile", profileId: ids.profileId },
  { kind: "tutoring_request", requestId: ids.requestId },
  { kind: "greeting", greetingId: ids.greetingId },
  { kind: "conversation", conversationId: ids.conversationId },
  { kind: "message", messageId: ids.messageId },
] as const;

describe("moderation public input schemas", () => {
  it.each(targets)("accepts only the canonical $kind locator", (target) => {
    expect(moderationTargetSchema.parse(target)).toEqual(target);
    expect(() => moderationTargetSchema.parse({ ...target, accountId: ids.accountId })).toThrow();
  });

  it.each(["reportedAccountId", "blockedAccountId", "accountId"] as const)(
    "rejects client-controlled %s at the report and block roots",
    (field) => {
      expect(() => createReportInputSchema.parse({
        target: targets[0],
        clientRequestId: ids.clientRequestId,
        reason: "公开资料疑似不实",
        [field]: ids.accountId,
      })).toThrow();
      expect(() => createBlockInputSchema.parse({
        target: targets[0],
        reason: "不希望继续互动",
        [field]: ids.accountId,
      })).toThrow();
    },
  );

  it("requires a UUID idempotency key and bounded trimmed report text", () => {
    const parsed = createReportInputSchema.parse({
      target: targets[4],
      clientRequestId: ids.clientRequestId,
      reason: "  消息存在骚扰内容  ",
      details: "  请结合上下文复核  ",
    });
    expect(parsed).toMatchObject({ reason: "消息存在骚扰内容", details: "请结合上下文复核" });
    expect(() => createReportInputSchema.parse({
      target: targets[4], clientRequestId: "not-a-uuid", reason: "消息存在骚扰内容",
    })).toThrow();
    expect(() => createReportInputSchema.parse({
      target: targets[4], clientRequestId: ids.clientRequestId, reason: "一",
    })).toThrow();
    expect(() => createReportInputSchema.parse({
      target: targets[4], clientRequestId: ids.clientRequestId, reason: "原因", details: "详".repeat(1001),
    })).toThrow();
  });

  it("requires a bounded trimmed block reason", () => {
    expect(createBlockInputSchema.parse({ target: targets[2], reason: "  不希望继续互动  " }).reason)
      .toBe("不希望继续互动");
    expect(() => createBlockInputSchema.parse({ target: targets[2], reason: "一" })).toThrow();
    expect(() => createBlockInputSchema.parse({ target: targets[2], reason: "原".repeat(201) })).toThrow();
  });
});

describe("moderation report race handling", () => {
  const input = {
    target: { kind: "teacher_profile" as const, profileId: ids.profileId },
    clientRequestId: ids.clientRequestId,
    reason: "公开资料疑似不实",
  };

  it("maps exhausted Prisma transaction retries to a domain conflict", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("transaction conflict", {
      code: "P2034",
      clientVersion: Prisma.prismaVersion.client,
    });
    const transaction = vi.fn().mockRejectedValue(race);
    const service = createModerationService({ $transaction: transaction } as unknown as PrismaClient);
    await expect(service.createReport({ id: ids.accountId, role: "parent" }, input))
      .rejects.toMatchObject({ name: "ModerationWorkflowError", code: "CONFLICT" });
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it("does not disguise a non-retryable repository failure as a domain conflict", async () => {
    const failure = new Error("database unavailable");
    const transaction = vi.fn().mockRejectedValue(failure);
    const service = createModerationService({ $transaction: transaction } as unknown as PrismaClient);
    await expect(service.createReport({ id: ids.accountId, role: "parent" }, input)).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe("moderation block resolution", () => {
  it("keeps both preflight and post-lock teacher resolution free of report evidence hydration", async () => {
    const forbiddenEvidenceQuery = vi.fn(() => {
      throw new Error("createBlock must not hydrate report evidence");
    });
    const teacherProfile = {
      findFirst: vi.fn().mockResolvedValue({ id: ids.profileId, accountId: ids.targetAccountId }),
    };
    const account = { findFirst: vi.fn().mockResolvedValue({ id: ids.accountId }) };
    const evidence = {
      teacherSubject: { findMany: forbiddenEvidenceQuery },
      subject: { findMany: forbiddenEvidenceQuery },
      teacherServiceArea: { findMany: forbiddenEvidenceQuery },
      region: { findMany: forbiddenEvidenceQuery },
      verification: { findMany: forbiddenEvidenceQuery },
    };
    const block = { upsert: vi.fn().mockResolvedValue({}) };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      account,
      teacherProfile,
      ...evidence,
      block,
    };
    const prisma = {
      account,
      teacherProfile,
      ...evidence,
      $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaClient;
    const service = createModerationService(prisma);

    await expect(service.createBlock(
      { id: ids.accountId, role: "parent" },
      { target: targets[0], reason: "不希望继续互动" },
    )).resolves.toEqual({ blocked: true });

    expect(teacherProfile.findFirst).toHaveBeenCalledTimes(2);
    expect(forbiddenEvidenceQuery).not.toHaveBeenCalled();
    expect(block.upsert).toHaveBeenCalledOnce();
  });
});
