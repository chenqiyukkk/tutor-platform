import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  accountMutationSchema,
  reportMutationSchema,
  verificationMutationSchema,
} from "./admin-schema";
import {
  AdminModerationError,
  createAdminModerationService,
} from "./admin-service";

const TARGET_ID = "20000000-0000-4000-8000-000000000001";
const MISSING_ID = "20000000-0000-4000-8000-000000000002";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const UPDATED_AT = "2026-07-14T08:00:00.000Z";

describe("admin mutation schemas", () => {
  it("requires strict UUID idempotency and optimistic concurrency fields", () => {
    const report = {
      clientRequestId: REQUEST_ID,
      expectedUpdatedAt: UPDATED_AT,
      decision: "RESOLVE",
      resolutionAction: "NONE",
      reviewNote: "已核实",
    };
    expect(reportMutationSchema.parse(report)).toEqual(report);
    expect(() => reportMutationSchema.parse({ ...report, accountId: TARGET_ID })).toThrow();
    expect(() => reportMutationSchema.parse({ ...report, clientRequestId: "not-a-uuid" })).toThrow();

    expect(() => verificationMutationSchema.parse({
      clientRequestId: REQUEST_ID,
      expectedUpdatedAt: UPDATED_AT,
      decision: "REJECT",
    })).toThrow();
    expect(accountMutationSchema.parse({
      clientRequestId: REQUEST_ID,
      expectedUpdatedAt: UPDATED_AT,
      status: "SUSPENDED",
      reason: "违反平台规则",
    }).status).toBe("SUSPENDED");
  });
});

describe("admin moderation service authorization", () => {
  it("rejects non-admin callers before starting a mutation", async () => {
    const prisma = { $transaction: vi.fn() };
    const service = createAdminModerationService(prisma as never, {
      enabled: true,
      write: vi.fn(),
      read: vi.fn(),
      remove: vi.fn(),
    });

    await expect(service.updateAccount(
      { id: TARGET_ID, role: "teacher" },
      TARGET_ID,
      {
        clientRequestId: REQUEST_ID,
        expectedUpdatedAt: UPDATED_AT,
        status: "SUSPENDED",
        reason: "违反平台规则",
      },
    )).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<AdminModerationError>);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a suspended admin before resolving either existing or missing report locators", async () => {
    const prisma = {
      account: { findFirst: vi.fn(async () => null) },
      report: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === TARGET_ID
          ? { id: TARGET_ID, targetType: "TEACHER_PROFILE", message: null }
          : null),
      },
      $transaction: vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) => operation(prisma)),
    };
    const moderation = createAdminModerationService(prisma as never, {
      enabled: true, write: vi.fn(), read: vi.fn(), remove: vi.fn(),
    });
    const input = {
      clientRequestId: REQUEST_ID,
      expectedUpdatedAt: UPDATED_AT,
      decision: "START_REVIEW" as const,
    };

    for (const reportId of [TARGET_ID, MISSING_ID]) {
      await expect(moderation.decideReport({ id: TARGET_ID, role: "admin" }, reportId, input))
        .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(prisma.account.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.report.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
