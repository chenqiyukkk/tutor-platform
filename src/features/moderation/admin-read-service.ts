import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { verificationTypes, type VerificationType } from "@/features/verifications/schema";

import { AdminModerationError, type AdminActor } from "./admin-service";

const PAGE_SIZE = 20;
const auditResultKeys = new Set(["status", "resolutionAction", "reviewedAt", "updatedAt", "mimeType"]);

export type AdminListResult<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };
export type UserFilter = { status?: "ACTIVE" | "SUSPENDED" | "DISABLED"; role?: "TEACHER" | "PARENT" | "ADMIN"; page?: number };
export type ReportFilter = { status?: "PENDING" | "REVIEWING" | "RESOLVED" | "DISMISSED"; type?: "ACCOUNT" | "TEACHER_PROFILE" | "TUTORING_REQUEST" | "GREETING" | "CONVERSATION" | "MESSAGE"; page?: number };
export type VerificationFilter = { status?: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED"; type?: VerificationType; page?: number };

type RawQuery = Record<string, string | string[] | undefined>;

function scalar(value: string | string[] | undefined) { return typeof value === "string" ? value : undefined; }
function enumValue<T extends string>(value: string | undefined, allowed: readonly T[]) { return value && allowed.includes(value as T) ? value as T : undefined; }
function pageValue(value: string | undefined) {
  if (!value || !/^\d{1,6}$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

type AdminQueryMap = { users: UserFilter; reports: ReportFilter; verifications: VerificationFilter };

export function parseAdminListQuery<K extends keyof AdminQueryMap>(kind: K, raw: RawQuery): AdminQueryMap[K] {
  const page = pageValue(scalar(raw.page));
  if (kind === "users") {
    const status = enumValue(scalar(raw.status), ["ACTIVE", "SUSPENDED", "DISABLED"] as const);
    const role = enumValue(scalar(raw.role), ["TEACHER", "PARENT", "ADMIN"] as const);
    return { ...(status ? { status } : {}), ...(role ? { role } : {}), page } as AdminQueryMap[K];
  }
  if (kind === "reports") {
    const status = enumValue(scalar(raw.status), ["PENDING", "REVIEWING", "RESOLVED", "DISMISSED"] as const);
    const type = enumValue(scalar(raw.type), ["ACCOUNT", "TEACHER_PROFILE", "TUTORING_REQUEST", "GREETING", "CONVERSATION", "MESSAGE"] as const);
    return { ...(status ? { status } : {}), ...(type ? { type } : {}), page } as AdminQueryMap[K];
  }
  const status = enumValue(scalar(raw.status), ["PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const);
  const type = enumValue(scalar(raw.type), verificationTypes);
  return { ...(status ? { status } : {}), ...(type ? { type } : {}), page } as AdminQueryMap[K];
}

function safeObject(value: Prisma.JsonValue | null, keys: Set<string>, maxLength = 160) {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!keys.has(key)) continue;
    if (typeof entry === "string") result[key] = entry.slice(0, maxLength);
    else if (Array.isArray(entry) && entry.every((item) => typeof item === "string")) result[key] = entry.join("、").slice(0, maxLength);
  }
  return result;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, limit = 160) { return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null; }

export function projectReportSnapshot(value: Prisma.JsonValue | null): Record<string, string> {
  const root = object(value);
  const kind = text(root?.kind, 40);
  if (kind === "teacher_profile") {
    const profile = object(root?.profile);
    const displayName = text(profile?.publicNickname ?? profile?.displayName, 80);
    const headline = text(profile?.headline, 160);
    return { ...(displayName ? { displayName } : {}), ...(headline ? { headline } : {}) };
  }
  if (kind === "tutoring_request") {
    const request = object(root?.request);
    const title = text(request?.title, 160);
    const description = text(request?.description, 200);
    return { ...(title ? { title } : {}), ...(description ? { description } : {}) };
  }
  if (kind === "greeting") {
    const greeting = object(root?.greeting);
    const card = object(greeting?.card);
    const teacher = object(card?.teacher);
    const requestCard = object(card?.request);
    const note = text(greeting?.note, 160);
    const teacherName = text(teacher?.publicNickname, 80);
    const teacherHeadline = text(teacher?.headline, 120);
    const teacherSummary = [teacherName, teacherHeadline].filter(Boolean).join(" · ");
    const request = text(requestCard?.title, 160);
    return { ...(note ? { note } : {}), ...(teacherSummary ? { teacher: teacherSummary } : {}), ...(request ? { request } : {}) };
  }
  if (kind === "conversation") {
    const conversation = object(root?.conversation);
    const counterpartRecord = object(conversation?.counterpart);
    const requestRecord = object(conversation?.request);
    const counterpart = text(counterpartRecord?.displayName, 80);
    const request = text(requestRecord?.title, 160);
    return { ...(counterpart ? { counterpart } : {}), ...(request ? { request } : {}) };
  }
  if (kind === "message") {
    const messageRecord = object(root?.message);
    const conversation = object(root?.conversation);
    const requestRecord = object(conversation?.request);
    const message = text(messageRecord?.body, 200);
    const request = text(requestRecord?.title, 160);
    return { ...(message ? { message } : {}), ...(request ? { request } : {}) };
  }
  return {};
}

async function assertActiveAdmin(prisma: PrismaClient, actor: AdminActor) {
  if (actor.role !== "admin") throw new AdminModerationError("FORBIDDEN", "仅管理员可以查看治理数据");
  const active = await prisma.account.findFirst({ where: { id: actor.id, role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
  if (!active) throw new AdminModerationError("UNAUTHORIZED", "管理员登录状态无效");
}

function paged<T>(items: T[], total: number, page: number): AdminListResult<T> {
  return { items, total, page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export function createAdminReadService(prisma: PrismaClient) {
  return {
    async getDashboard(actor: AdminActor) {
      await assertActiveAdmin(prisma, actor);
      const [openReports, pendingVerifications, oldestReports, oldestVerifications, audit] = await Promise.all([
        prisma.report.count({ where: { status: { in: ["PENDING", "REVIEWING"] } } }),
        prisma.verification.count({ where: { status: "PENDING" } }),
        prisma.report.findMany({ where: { status: { in: ["PENDING", "REVIEWING"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { createdAt: true } }),
        prisma.verification.findMany({ where: { status: "PENDING" }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 1, select: { submittedAt: true } }),
        prisma.adminAuditLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12, select: { id: true, action: true, targetType: true, createdAt: true, metadata: true } }),
      ]);
      return {
        counts: { openReports, pendingVerifications },
        oldest: {
          report: oldestReports[0]?.createdAt.toISOString() ?? null,
          verification: oldestVerifications[0]?.submittedAt.toISOString() ?? null,
        },
        recentAudit: audit.map((entry) => ({
          id: entry.id, action: entry.action, targetType: entry.targetType, createdAt: entry.createdAt.toISOString(),
          result: safeObject(entry.metadata && !Array.isArray(entry.metadata) && typeof entry.metadata === "object" && "result" in entry.metadata ? entry.metadata.result as Prisma.JsonValue : null, auditResultKeys, 60),
        })),
      };
    },

    async listUsers(actor: AdminActor, filter: UserFilter) {
      await assertActiveAdmin(prisma, actor);
      const where = { ...(filter.status ? { status: filter.status } : {}), ...(filter.role ? { role: filter.role } : {}) };
      const total = await prisma.account.count({ where });
      const page = Math.min(filter.page ?? 1, Math.max(1, Math.ceil(total / PAGE_SIZE)));
      const records = await prisma.account.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: { id: true, username: true, role: true, status: true, createdAt: true, updatedAt: true } });
      return paged(records.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })), total, page);
    },

    async listReports(actor: AdminActor, filter: ReportFilter) {
      await assertActiveAdmin(prisma, actor);
      const where = { ...(filter.status ? { status: filter.status } : {}), ...(filter.type ? { targetType: filter.type } : {}) };
      const total = await prisma.report.count({ where });
      const page = Math.min(filter.page ?? 1, Math.max(1, Math.ceil(total / PAGE_SIZE)));
      const records = await prisma.report.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: {
          id: true, targetType: true, reason: true, details: true, status: true, targetSnapshot: true, resolutionAction: true, createdAt: true, updatedAt: true,
          reporter: { select: { username: true } }, reportedAccount: { select: { id: true, username: true, status: true } },
        } });
      return paged(records.map((row) => ({
        id: row.id, targetType: row.targetType, reason: row.reason.slice(0, 120), details: row.details?.slice(0, 240) ?? null,
        status: row.status, resolutionAction: row.resolutionAction, reporter: row.reporter.username,
        subject: row.reportedAccount?.username ?? "已移除账号", snapshot: projectReportSnapshot(row.targetSnapshot),
        canSuspendAccount: row.reportedAccount?.status === "ACTIVE" && row.reportedAccount.id !== actor.id,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      })), total, page);
    },

    async listVerifications(actor: AdminActor, filter: VerificationFilter) {
      await assertActiveAdmin(prisma, actor);
      const where = { ...(filter.status ? { status: filter.status } : {}), ...(filter.type ? { type: filter.type } : {}) };
      const total = await prisma.verification.count({ where });
      const page = Math.min(filter.page ?? 1, Math.max(1, Math.ceil(total / PAGE_SIZE)));
      const records = await prisma.verification.findMany({ where, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: {
          id: true, type: true, status: true, submittedAt: true, updatedAt: true, account: { select: { username: true } },
        } });
      return paged(records.map((row) => ({ id: row.id, applicant: row.account.username, type: row.type, status: row.status, submittedAt: row.submittedAt.toISOString(), updatedAt: row.updatedAt.toISOString() })), total, page);
    },
  };
}

export type AdminReadService = ReturnType<typeof createAdminReadService>;
