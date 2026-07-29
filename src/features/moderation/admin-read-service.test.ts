import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAdminReadService, parseAdminListQuery, projectReportSnapshot } from "./admin-read-service";

const actor = { id: "10000000-0000-4000-8000-000000000001", role: "admin" as const };

function prismaMock(active = true) {
  return {
    account: {
      findFirst: vi.fn(async () => active ? { id: actor.id } : null),
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [{
        id: "20000000-0000-4000-8000-000000000001", username: "松风", role: "TEACHER",
        status: "ACTIVE", createdAt: new Date("2026-07-14T01:00:00Z"),
        updatedAt: new Date("2026-07-14T02:00:00Z"),
      }]),
    },
    report: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    verification: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    adminAuditLog: { findMany: vi.fn(async () => []) },
  };
}

describe("admin read service", () => {
  it("revalidates an ACTIVE ADMIN on every read", async () => {
    const prisma = prismaMock(false);
    const service = createAdminReadService(prisma as never);
    await expect(service.listUsers(actor, {})).rejects.toEqual(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(prisma.account.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: actor.id, role: "ADMIN", status: "ACTIVE" },
    }));
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  it("returns safe user rows without email or internal profile identifiers", async () => {
    const service = createAdminReadService(prismaMock() as never);
    const result = await service.listUsers(actor, { status: "ACTIVE", role: "TEACHER", page: 1 });
    expect(result.items[0]).toEqual({
      id: "20000000-0000-4000-8000-000000000001", username: "松风", role: "TEACHER",
      status: "ACTIVE", createdAt: "2026-07-14T01:00:00.000Z", updatedAt: "2026-07-14T02:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toMatch(/email|accountId|profileId/i);
  });

  it("allowlists audit metadata and drops identifiers, paths, hashes, email and prose", async () => {
    const prisma = prismaMock();
    prisma.adminAuditLog.findMany.mockResolvedValueOnce([{ id: "audit-1", action: "REPORT_DECISION", targetType: "REPORT", targetId: "secret-target", createdAt: new Date("2026-07-14T03:00:00Z"), metadata: {
      payloadHash: "private-hash", result: { status: "RESOLVED", resolutionAction: "NONE", accountId: "private-account", email: "private@example.test", path: "D:\\private", fullText: "完整正文" },
    }}] as never);
    const service = createAdminReadService(prisma as never);
    const result = await service.getDashboard(actor);
    expect(result.recentAudit[0]).toEqual({ id: "audit-1", action: "REPORT_DECISION", targetType: "REPORT", createdAt: "2026-07-14T03:00:00.000Z", result: { status: "RESOLVED", resolutionAction: "NONE" } });
    expect(JSON.stringify(result)).not.toMatch(/secret-target|private|example|完整正文|payloadHash/i);
  });

  it("never returns verification evidence metadata", async () => {
    const prisma = prismaMock();
    prisma.verification.findMany.mockResolvedValueOnce([{ id: "30000000-0000-4000-8000-000000000001", type: "EDUCATION", status: "PENDING", submittedAt: new Date("2026-07-14T01:00:00Z"), updatedAt: new Date("2026-07-14T02:00:00Z"), account: { username: "青禾" }, evidence: { key: "secret", path: "D:\\secret", sha256: "private" } }] as never);
    const result = await createAdminReadService(prisma as never).listVerifications(actor, {});
    expect(result.items[0]).toEqual({ id: "30000000-0000-4000-8000-000000000001", applicant: "青禾", type: "EDUCATION", status: "PENDING", submittedAt: "2026-07-14T01:00:00.000Z", updatedAt: "2026-07-14T02:00:00.000Z" });
    expect(JSON.stringify(result)).not.toMatch(/evidence|key|path|sha256|accountId/i);
  });

  it.each([
    ["users", "account"], ["reports", "report"], ["verifications", "verification"],
  ] as const)("clamps an out-of-range %s page to the real last page", async (kind, model) => {
    const prisma = prismaMock();
    prisma[model].count.mockResolvedValueOnce(21);
    const service = createAdminReadService(prisma as never);
    const result = kind === "users" ? await service.listUsers(actor, { page: 999_999 })
      : kind === "reports" ? await service.listReports(actor, { page: 999_999 })
        : await service.listVerifications(actor, { page: 999_999 });
    expect(result.page).toBe(2);
    expect(prisma[model].findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });

  it("normalizes an empty list to page one", async () => {
    const prisma = prismaMock();
    prisma.account.count.mockResolvedValueOnce(0);
    const result = await createAdminReadService(prisma as never).listUsers(actor, { page: 999_999 });
    expect(result.page).toBe(1);
    expect(prisma.account.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
  });

  it("derives report suspension capability without exposing subject id or status", async () => {
    const prisma = prismaMock();
    prisma.report.count.mockResolvedValueOnce(1);
    prisma.report.findMany.mockResolvedValueOnce([{ id: "30000000-0000-4000-8000-000000000001", targetType: "MESSAGE", reason: "骚扰", details: null, status: "PENDING", targetSnapshot: { kind: "message", message: { body: "停止联系" } }, resolutionAction: null, createdAt: new Date("2026-07-14T01:00:00Z"), updatedAt: new Date("2026-07-14T02:00:00Z"), reporter: { username: "青禾" }, reportedAccount: { id: "20000000-0000-4000-8000-000000000001", username: "松风", status: "ACTIVE" } }] as never);
    const result = await createAdminReadService(prisma as never).listReports(actor, {});
    expect(result.items[0].canSuspendAccount).toBe(true);
    expect(JSON.stringify(result.items[0])).not.toMatch(/20000000-0000-4000-8000-000000000001|reportedAccountId|subjectStatus/i);
  });

  it.each([
    [null],
    [{ id: actor.id, username: "当前管理员", status: "ACTIVE" }],
    [{ id: "20000000-0000-4000-8000-000000000001", username: "已停用用户", status: "SUSPENDED" }],
  ])("does not allow suspension for a missing, current-admin, or inactive report subject", async (reportedAccount) => {
    const prisma = prismaMock();
    prisma.report.count.mockResolvedValueOnce(1);
    prisma.report.findMany.mockResolvedValueOnce([{ id: "30000000-0000-4000-8000-000000000001", targetType: "MESSAGE", reason: "骚扰", details: null, status: "PENDING", targetSnapshot: null, resolutionAction: null, createdAt: new Date("2026-07-14T01:00:00Z"), updatedAt: new Date("2026-07-14T02:00:00Z"), reporter: { username: "青禾" }, reportedAccount }] as never);
    const result = await createAdminReadService(prisma as never).listReports(actor, {});
    expect(result.items[0].canSuspendAccount).toBe(false);
  });
});

describe("admin query parsing", () => {
  it("strictly allowlists public filters and safely defaults invalid values", () => {
    expect(parseAdminListQuery("users", { status: "SUSPENDED", role: "TEACHER", page: "2", email: "secret@example.test" })).toEqual({ status: "SUSPENDED", role: "TEACHER", page: 2 });
    expect(parseAdminListQuery("users", { status: "bad", role: "bad", page: "-9", debug: "1" })).toEqual({ page: 1 });
    expect(parseAdminListQuery("reports", { status: "REVIEWING", type: "MESSAGE", page: "3" })).toEqual({ status: "REVIEWING", type: "MESSAGE", page: 3 });
    expect(parseAdminListQuery("verifications", { type: "STUDENT_STATUS", page: "1" })).toEqual({ type: "STUDENT_STATUS", page: 1 });
    expect(parseAdminListQuery("verifications", { type: "STUDENT_IDENTITY" })).toEqual({ page: 1 });
  });
});

describe("report snapshot projection", () => {
  it.each([
    [{ kind: "teacher_profile", profile: { publicNickname: "松风", headline: "耐心讲清楚", id: "secret", bio: "不展示完整正文", accountId: "private" } }, { displayName: "松风", headline: "耐心讲清楚" }],
    [{ kind: "tutoring_request", request: { title: "初二数学", description: "巩固几何基础", id: "secret", publicLocationNote: "精确住址" } }, { title: "初二数学", description: "巩固几何基础" }],
    [{ kind: "greeting", greeting: { id: "secret", note: "希望沟通", card: { teacher: { publicNickname: "松风", headline: "数学老师", accountId: "private" }, request: { title: "初二数学", description: "不应出现" } } } }, { note: "希望沟通", teacher: "松风 · 数学老师", request: "初二数学" }],
    [{ kind: "conversation", conversation: { id: "secret", counterpart: { role: "teacher", displayName: "松风", email: "private@example.test" }, request: { id: "secret", title: "初二数学" } } }, { counterpart: "松风", request: "初二数学" }],
    [{ kind: "message", message: { id: "secret", body: "请停止联系", senderAccountId: "private" }, conversation: { id: "secret", request: { id: "secret", title: "初二数学" } } }, { message: "请停止联系", request: "初二数学" }],
  ])("projects %o using an explicit allowlist", (snapshot, expected) => {
    const result = projectReportSnapshot(snapshot as never);
    expect(result).toEqual(expected);
    expect(JSON.stringify(result)).not.toMatch(/secret|private|example|accountId|精确住址|完整正文/i);
  });
});
