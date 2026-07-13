import "server-only";

import { Prisma, type PrismaClient, type TeacherProfile, type TutoringRequest } from "@prisma/client";

import type { AuthenticatedAccount } from "@/features/auth/service";
import { lockAccountPair } from "@/features/interactions/account-pair-lock";
import { violatesContactPolicy } from "@/features/safety/contact-policy";

import { greetingCardSnapshotSchema, type CurrentGreetingCardSnapshot } from "./card-schema";

import {
  greetingActionSchema,
  decodeGreetingCursor,
  encodeGreetingCursor,
  greetingInboxQuerySchema,
  sendGreetingSchema,
  type GreetingActionInput,
  type SendGreetingInput,
} from "./schema";

type Actor = Pick<AuthenticatedAccount, "id" | "role">;
type Db = PrismaClient | Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;
const GREETING_LIFETIME_MS = 7 * DAY_MS;
const REJECT_COOLDOWN_MS = 30 * DAY_MS;

export type GreetingErrorCode =
  | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_TARGET"
  | "PENDING_EXISTS" | "COOLDOWN" | "PERMANENTLY_CLOSED" | "EXPIRED"
  | "BLOCKED" | "DAILY_LIMIT" | "CONFLICT";

export class GreetingWorkflowError extends Error {
  constructor(readonly code: GreetingErrorCode, message: string) {
    super(message);
    this.name = "GreetingWorkflowError";
  }
}

type SafeAccount = { id: string; role: "TEACHER" | "PARENT" | "ADMIN"; status: "ACTIVE" | "SUSPENDED" | "DISABLED" };
type SafeSubject = { id: string; name: string; isActive: boolean };
type SafeRegion = { id: string; name: string; level: number; isActive: boolean };
type RequestContext = TutoringRequest & {
  parentProfile: { account: SafeAccount };
  studentProfile: { displayName: string; gradeLevel: string | null; isActive: boolean } | null;
  region: SafeRegion | null;
  subjects: Array<{ subject: SafeSubject }>;
};
type TeacherContext = TeacherProfile & {
  account: SafeAccount;
  subjects: Array<{ subject: SafeSubject }>;
  serviceAreas: Array<{ isPrimary: boolean; region: SafeRegion }>;
};

async function loadRequestContext(client: Db, id: string): Promise<RequestContext | null> {
  const request = await client.tutoringRequest.findUnique({ where: { id } });
  if (!request) return null;
  const parentProfile = await client.parentProfile.findUnique({ where: { id: request.parentProfileId }, select: { accountId: true } });
  if (!parentProfile) return null;
  const parentAccount = await client.account.findUnique({ where: { id: parentProfile.accountId }, select: { id: true, role: true, status: true } });
  if (!parentAccount) return null;
  const studentProfile = request.studentProfileId
    ? await client.studentProfile.findUnique({ where: { id: request.studentProfileId }, select: { displayName: true, gradeLevel: true, isActive: true } })
    : null;
  const region = request.regionId
    ? await client.region.findUnique({ where: { id: request.regionId }, select: { id: true, name: true, level: true, isActive: true } })
    : null;
  const links = await client.requestSubject.findMany({ where: { tutoringRequestId: id }, select: { subjectId: true }, orderBy: { subjectId: "asc" } });
  const subjectRows = await client.subject.findMany({ where: { id: { in: links.map(({ subjectId }) => subjectId) } }, select: { id: true, name: true, isActive: true } });
  const bySubjectId = new Map(subjectRows.map((subject) => [subject.id, subject]));
  return {
    ...request,
    parentProfile: { account: parentAccount },
    studentProfile,
    region,
    subjects: links.flatMap(({ subjectId }) => {
      const subject = bySubjectId.get(subjectId);
      return subject ? [{ subject }] : [];
    }),
  };
}

async function loadTeacherContext(client: Db, where: { id: string } | { accountId: string }): Promise<TeacherContext | null> {
  const profile = await client.teacherProfile.findUnique({ where });
  if (!profile) return null;
  const account = await client.account.findUnique({ where: { id: profile.accountId }, select: { id: true, role: true, status: true } });
  if (!account) return null;
  const subjectLinks = await client.teacherSubject.findMany({ where: { teacherProfileId: profile.id }, select: { subjectId: true }, orderBy: { subjectId: "asc" } });
  const subjectRows = await client.subject.findMany({ where: { id: { in: subjectLinks.map(({ subjectId }) => subjectId) } }, select: { id: true, name: true, isActive: true } });
  const bySubjectId = new Map(subjectRows.map((subject) => [subject.id, subject]));
  const areaLinks = await client.teacherServiceArea.findMany({ where: { teacherProfileId: profile.id }, select: { regionId: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { regionId: "asc" }] });
  const regionRows = await client.region.findMany({ where: { id: { in: areaLinks.map(({ regionId }) => regionId) } }, select: { id: true, name: true, level: true, isActive: true } });
  const byRegionId = new Map(regionRows.map((region) => [region.id, region]));
  return {
    ...profile,
    account,
    subjects: subjectLinks.flatMap(({ subjectId }) => {
      const subject = bySubjectId.get(subjectId);
      return subject ? [{ subject }] : [];
    }),
    serviceAreas: areaLinks.flatMap(({ regionId, isPrimary }) => {
      const region = byRegionId.get(regionId);
      return region ? [{ isPrimary, region }] : [];
    }),
  };
}

function utcDayRange(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

async function advisoryLock(transaction: Prisma.TransactionClient, key: string) {
  await transaction.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function lockPublicContext(
  transaction: Prisma.TransactionClient,
  teacherProfileId: string,
  requestId: string,
  at: Date,
) {
  // Task 12 must preserve this global lock order across every publishing and
  // deactivation workflow: TeacherProfile -> TutoringRequest -> sorted union
  // Subject -> sorted union Region -> StudentProfile -> ParentProfile ->
  // sorted Account -> sorted Verification.
  await transaction.$queryRaw`SELECT "id" FROM "TeacherProfile" WHERE "id" = ${teacherProfileId}::uuid FOR SHARE`;
  await transaction.$queryRaw`SELECT "id" FROM "TutoringRequest" WHERE "id" = ${requestId}::uuid FOR SHARE`;

  // Root locks stabilize Task 7/8 relationship writers before child IDs are read.
  const initialTeacher = await loadTeacherContext(transaction, { id: teacherProfileId });
  const initialRequest = await loadRequestContext(transaction, requestId);
  if (!initialTeacher || !initialRequest) throw new GreetingWorkflowError("INVALID_TARGET", "公开联系场景已不可用");

  const subjectIds = [...new Set([
    ...initialTeacher.subjects.map(({ subject }) => subject.id),
    ...initialRequest.subjects.map(({ subject }) => subject.id),
  ])].sort();
  if (subjectIds.length) {
    await transaction.$queryRaw`SELECT "id" FROM "Subject" WHERE "id" IN (${Prisma.join(subjectIds)}) ORDER BY "id" FOR SHARE`;
  }
  const regionIds = [...new Set([
    ...initialTeacher.serviceAreas.map(({ region }) => region.id),
    ...(initialRequest.regionId ? [initialRequest.regionId] : []),
  ])].sort();
  if (regionIds.length) {
    await transaction.$queryRaw`SELECT "id" FROM "Region" WHERE "id" IN (${Prisma.join(regionIds)}) ORDER BY "id" FOR SHARE`;
  }
  if (initialRequest.studentProfileId) {
    await transaction.$queryRaw`SELECT "id" FROM "StudentProfile" WHERE "id" = ${initialRequest.studentProfileId}::uuid FOR SHARE`;
  }
  await transaction.$queryRaw`SELECT "id" FROM "ParentProfile" WHERE "id" = ${initialRequest.parentProfileId}::uuid FOR SHARE`;
  const accountIds = [...new Set([initialTeacher.account.id, initialRequest.parentProfile.account.id])].sort();
  await transaction.$queryRaw`SELECT "id" FROM "Account" WHERE "id" IN (${Prisma.join(accountIds)}) ORDER BY "id" FOR SHARE`;

  const verificationIds = (await transaction.verification.findMany({
    where: {
      teacherProfileId, accountId: initialTeacher.account.id, status: "APPROVED",
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
    },
    select: { id: true }, orderBy: { id: "asc" },
  })).map(({ id }) => id);
  if (verificationIds.length) {
    await transaction.$queryRaw`SELECT "id" FROM "Verification" WHERE "id" IN (${Prisma.join(verificationIds)}) ORDER BY "id" FOR SHARE`;
  }

  const teacher = await loadTeacherContext(transaction, { id: teacherProfileId });
  const request = await loadRequestContext(transaction, requestId);
  if (!teacher || !request) throw new GreetingWorkflowError("INVALID_TARGET", "公开联系场景已不可用");
  const verified = await transaction.verification.count({ where: {
    teacherProfileId, accountId: teacher.account.id, status: "APPROVED",
    OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
  } }) > 0;
  return { teacher, request, verified };
}

function assertActor(role: string): asserts role is "parent" | "teacher" {
  if (role !== "parent" && role !== "teacher") {
    throw new GreetingWorkflowError("FORBIDDEN", "仅家长或老师可以使用打招呼功能");
  }
}

function assertPublicTeacher(profile: TeacherContext) {
  const publicTextSafe = ![profile.displayName, profile.headline, profile.bio].some(violatesContactPolicy);
  const valid = profile.account.role === "TEACHER"
    && profile.account.status === "ACTIVE"
    && profile.status === "PUBLISHED"
    && profile.publishedAt !== null
    && profile.displayName.trim() !== ""
    && profile.identityType !== null
    && profile.headline !== null
    && profile.headline.trim() !== ""
    && profile.bio !== null
    && profile.yearsExperience !== null
    && profile.hourlyRate !== null
    && profile.hourlyRateMax !== null
    && profile.subjects.length > 0
    && profile.subjects.every(({ subject }) => subject.isActive)
    && profile.serviceAreas.some(({ isPrimary }) => isPrimary)
    && profile.serviceAreas.every(({ region }) => region.isActive && region.level === 3)
    && publicTextSafe;
  if (!valid) throw new GreetingWorkflowError("INVALID_TARGET", "老师资料当前不可联系");
}

function assertPublicRequest(request: RequestContext, now: Date) {
  const publicTextSafe = ![
    request.title,
    request.description,
    request.scheduleText,
    request.publicLocationNote,
    request.studentProfile?.displayName,
  ].some(violatesContactPolicy);
  const valid = request.parentProfile.account.role === "PARENT"
    && request.parentProfile.account.status === "ACTIVE"
    && request.status === "PUBLISHED"
    && request.publishedAt !== null
    && request.title.trim() !== ""
    && request.description.trim() !== ""
    && request.teachingMode !== null
    && request.studentProfile?.isActive === true
    && request.region?.isActive === true
    && request.region.level === 3
    && request.subjects.length > 0
    && request.subjects.every(({ subject }) => subject.isActive)
    && (request.expiresAt === null || request.expiresAt.getTime() > now.getTime())
    && publicTextSafe;
  if (!valid) throw new GreetingWorkflowError("INVALID_TARGET", "家教需求当前不可联系");
}

function createCard(teacher: TeacherContext, request: RequestContext, verified: boolean): CurrentGreetingCardSnapshot {
  return {
    teacher: {
      id: teacher.id,
      publicNickname: teacher.displayName,
      identityType: teacher.identityType!,
      headline: teacher.headline!,
      yearsExperience: teacher.yearsExperience!,
      rateMinCents: Math.round(teacher.hourlyRate!.toNumber() * 100),
      rateMaxCents: Math.round(teacher.hourlyRateMax!.toNumber() * 100),
      online: teacher.isOnline,
      verified,
      subjects: teacher.subjects.map(({ subject }) => ({ id: subject.id, name: subject.name })),
      serviceAreas: teacher.serviceAreas.map(({ isPrimary, region }) => ({ id: region.id, name: region.name, isPrimary })),
    },
    request: {
      id: request.id,
      title: request.title,
      studentAlias: request.studentProfile!.displayName,
      gradeLevel: request.studentProfile!.gradeLevel,
      budgetMinCents: request.budgetMin,
      budgetMaxCents: request.budgetMax,
      teachingMode: request.teachingMode!,
      scheduleText: request.scheduleText,
      region: { id: request.region!.id, name: request.region!.name },
      subjects: request.subjects.map(({ subject }) => ({ id: subject.id, name: subject.name })),
    },
  };
}

async function loadSendContext(client: Db, actor: Actor, input: SendGreetingInput, now: Date) {
  assertActor(actor.role);
  const actorRole = actor.role === "parent" ? "PARENT" : "TEACHER";
  const account = await client.account.findFirst({ where: { id: actor.id, role: actorRole, status: "ACTIVE" }, select: { id: true } });
  if (!account) throw new GreetingWorkflowError("UNAUTHORIZED", "登录状态无效");

  const request = await loadRequestContext(client, input.requestId);
  if (!request) throw new GreetingWorkflowError("NOT_FOUND", "家教需求不存在");
  const teacher = actor.role === "teacher"
    ? await loadTeacherContext(client, { accountId: actor.id })
    : await loadTeacherContext(client, { id: input.targetId });
  if (!teacher) throw new GreetingWorkflowError("NOT_FOUND", "老师资料不存在");
  if (actor.role === "teacher" && input.targetId !== input.requestId) {
    throw new GreetingWorkflowError("INVALID_TARGET", "目标需求不一致");
  }
  const parentId = request.parentProfile.account.id;
  const teacherId = teacher.account.id;
  if ((actor.role === "parent" && actor.id !== parentId) || (actor.role === "teacher" && actor.id !== teacherId)) {
    throw new GreetingWorkflowError("FORBIDDEN", "你不是该联系场景的参与者");
  }
  if (teacherId === parentId) throw new GreetingWorkflowError("FORBIDDEN", "不能给自己打招呼");
  assertPublicTeacher(teacher);
  assertPublicRequest(request, now);
  return {
    teacher, request, teacherId, parentId,
    senderId: actor.id,
    recipientId: actor.role === "parent" ? teacherId : parentId,
    contextKey: `${teacherId}:${parentId}:${request.id}`,
  };
}

async function hasBlock(client: Db, left: string, right: string) {
  return (await client.block.count({ where: { OR: [
    { blockerAccountId: left, blockedAccountId: right },
    { blockerAccountId: right, blockedAccountId: left },
  ] } })) > 0;
}

type GreetingDtoRow = {
  id: string;
  senderAccountId: string;
  recipientAccountId: string;
  message: string | null;
  cardSnapshot: Prisma.JsonValue;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
};

function toDto(row: GreetingDtoRow, viewerId?: string) {
  const parsedCard = greetingCardSnapshotSchema.safeParse(row.cardSnapshot);
  return {
    id: row.id,
    direction: viewerId ? (row.senderAccountId === viewerId ? "sent" as const : "received" as const) : undefined,
    status: row.status,
    note: row.message && violatesContactPolicy(row.message) ? "历史说明已隐藏" : row.message ?? "",
    card: parsedCard.success ? parsedCard.data : { legacy: true as const },
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
  };
}

export function createGreetingService(prisma: PrismaClient, now: () => Date = () => new Date()) {
  async function recordAttempt(senderId: string, at: Date) {
    const { start, end } = utcDayRange(at);
    return prisma.$transaction(async (transaction) => {
      await advisoryLock(transaction, `greeting-daily:${senderId}:${start.toISOString().slice(0, 10)}`);
      const count = await transaction.greetingAttempt.count({ where: { senderAccountId: senderId, attemptedAt: { gte: start, lt: end } } });
      if (count >= 10) throw new GreetingWorkflowError("DAILY_LIMIT", "今天的打招呼次数已用完");
      await transaction.greetingAttempt.create({ data: { senderAccountId: senderId, attemptedAt: at } });
    });
  }

  return {
    async send(actor: Actor, rawInput: SendGreetingInput) {
      const input = sendGreetingSchema.parse(rawInput);
      const at = now();
      const preflight = await loadSendContext(prisma, actor, input, at);
      await recordAttempt(actor.id, at);
      const result = await prisma.$transaction(async (transaction) => {
        await lockAccountPair(transaction, preflight.teacherId, preflight.parentId);
        await advisoryLock(transaction, `greeting-context:${preflight.contextKey}`);
        const initialContext = await loadSendContext(transaction, actor, input, at);
        if (
          initialContext.contextKey !== preflight.contextKey ||
          initialContext.teacherId !== preflight.teacherId ||
          initialContext.parentId !== preflight.parentId
        ) {
          throw new GreetingWorkflowError("CONFLICT", "公开联系场景已发生变化，请重试");
        }
        const locked = await lockPublicContext(transaction, initialContext.teacher.id, initialContext.request.id, at);
        const context = await loadSendContext(transaction, actor, input, at);
        if (await hasBlock(transaction, context.teacherId, context.parentId)) {
          throw new GreetingWorkflowError("BLOCKED", "双方当前不能互相联系");
        }
        const card = createCard(context.teacher, context.request, locked.verified);
        const existing = await transaction.greeting.findUnique({ where: { contextKey: context.contextKey } });
        const expiresAt = new Date(at.getTime() + GREETING_LIFETIME_MS);
        if (!existing) {
          const created = await transaction.greeting.create({ data: {
            senderAccountId: context.senderId, recipientAccountId: context.recipientId,
            tutoringRequestId: context.request.id, contextKey: context.contextKey,
            message: input.note || null, cardSnapshot: card, createdAt: at, expiresAt,
          } });
          return toDto(created);
        }
        if (existing.status === "PENDING") {
          if (existing.expiresAt.getTime() <= at.getTime()) {
            await transaction.greeting.update({ where: { id: existing.id }, data: { status: "EXPIRED" } });
            return { workflowError: new GreetingWorkflowError("PERMANENTLY_CLOSED", "该联系已过期，不能重新开启") };
          }
          throw new GreetingWorkflowError("PENDING_EXISTS", "已发送过打招呼，请等待对方回应");
        }
        if (existing.status !== "REJECTED") {
          throw new GreetingWorkflowError("PERMANENTLY_CLOSED", "该联系场景不能重新开启");
        }
        const retryAt = (existing.respondedAt?.getTime() ?? Number.POSITIVE_INFINITY) + REJECT_COOLDOWN_MS;
        if (at.getTime() < retryAt) throw new GreetingWorkflowError("COOLDOWN", "对方拒绝后需等待 30 天才能再次联系");
        const retried = await transaction.greeting.update({ where: { id: existing.id }, data: {
          senderAccountId: context.senderId, recipientAccountId: context.recipientId,
          message: input.note || null, cardSnapshot: card, status: "PENDING", respondedAt: null,
          createdAt: at, expiresAt,
        } });
        return toDto(retried);
      }, { isolationLevel: "ReadCommitted" });
      if ("workflowError" in result) throw result.workflowError;
      return result;
    },

    async respond(actor: Actor, greetingId: string, rawInput: GreetingActionInput) {
      assertActor(actor.role);
      const input = greetingActionSchema.parse(rawInput);
      const preliminary = await prisma.greeting.findUnique({
        where: { id: greetingId },
        select: { contextKey: true, senderAccountId: true, recipientAccountId: true },
      });
      if (!preliminary) throw new GreetingWorkflowError("NOT_FOUND", "打招呼记录不存在");
      const at = now();
      const result = await prisma.$transaction(async (transaction) => {
        await lockAccountPair(transaction, preliminary.senderAccountId, preliminary.recipientAccountId);
        await advisoryLock(transaction, `greeting-context:${preliminary.contextKey}`);
        const greeting = await transaction.greeting.findUnique({ where: { id: greetingId } });
        if (!greeting) throw new GreetingWorkflowError("NOT_FOUND", "打招呼记录不存在");
        const actorRole = actor.role === "parent" ? "PARENT" : "TEACHER";
        const account = await transaction.account.findFirst({ where: { id: actor.id, role: actorRole, status: "ACTIVE" }, select: { id: true } });
        if (!account) throw new GreetingWorkflowError("UNAUTHORIZED", "登录状态无效");
        if (greeting.recipientAccountId !== actor.id) throw new GreetingWorkflowError("FORBIDDEN", "只有接收方可以回应");

        if (input.action === "accept" && greeting.status === "ACCEPTED") {
          const conversation = await transaction.conversation.findUnique({ where: { greetingId } });
          if (conversation) return { ...toDto(greeting), conversationEstablished: true, conversationId: conversation.id };
        }
        if (input.action === "report" && greeting.status === "REPORTED") return { ...toDto(greeting), reported: true };
        if (input.action === "block" && greeting.status === "BLOCKED") return { ...toDto(greeting), blocked: true };
        if (greeting.status !== "PENDING") throw new GreetingWorkflowError("CONFLICT", "该打招呼已经处理");
        if (greeting.expiresAt.getTime() <= at.getTime()) {
          const expired = await transaction.greeting.update({ where: { id: greeting.id }, data: { status: "EXPIRED" } });
          return { workflowError: new GreetingWorkflowError("EXPIRED", `打招呼已于 ${expired.expiresAt.toISOString()} 过期`) };
        }

        // Reject/report/block remain available to an active recipient even if
        // the sender or the original public context has since been deactivated.
        if (input.action === "reject") {
          const row = await transaction.greeting.update({ where: { id: greeting.id }, data: { status: "REJECTED", respondedAt: at } });
          return toDto(row);
        }
        if (input.action === "report") {
          const visibleGreeting = toDto(greeting);
          await transaction.report.upsert({ where: { greetingId: greeting.id }, update: {}, create: {
            greetingId: greeting.id, reporterAccountId: actor.id, reportedAccountId: greeting.senderAccountId,
            tutoringRequestId: greeting.tutoringRequestId, targetType: "GREETING", targetId: greeting.id,
            targetSnapshot: { card: visibleGreeting.card, note: visibleGreeting.note },
            reason: input.reason!, details: "由受控打招呼卡片举报",
          } });
          const row = await transaction.greeting.update({ where: { id: greeting.id }, data: { status: "REPORTED", respondedAt: at } });
          return { ...toDto(row), reported: true };
        }
        if (input.action === "block") {
          await transaction.block.upsert({
            where: { blockerAccountId_blockedAccountId: { blockerAccountId: actor.id, blockedAccountId: greeting.senderAccountId } },
            update: {}, create: { blockerAccountId: actor.id, blockedAccountId: greeting.senderAccountId, reason: input.reason },
          });
          const row = await transaction.greeting.update({ where: { id: greeting.id }, data: { status: "BLOCKED", respondedAt: at } });
          return { ...toDto(row), blocked: true };
        }

        // Accept is the only transition that establishes a live relationship,
        // so it revalidates the complete public context under the global locks.
        const teacherId = actor.role === "teacher" ? actor.id : greeting.senderAccountId;
        const parentId = actor.role === "parent" ? actor.id : greeting.senderAccountId;
        const teacherRoot = await transaction.teacherProfile.findUnique({ where: { accountId: teacherId }, select: { id: true } });
        if (!teacherRoot) throw new GreetingWorkflowError("INVALID_TARGET", "老师资料已不可用");
        const locked = await lockPublicContext(transaction, teacherRoot.id, greeting.tutoringRequestId, at);
        if (locked.teacher.account.id !== teacherId || locked.request.parentProfile.account.id !== parentId) {
          throw new GreetingWorkflowError("INVALID_TARGET", "打招呼参与者与公开资料不一致");
        }
        assertPublicTeacher(locked.teacher);
        assertPublicRequest(locked.request, at);
        if (await hasBlock(transaction, teacherId, parentId)) throw new GreetingWorkflowError("BLOCKED", "双方当前不能互相联系");

        const updated = await transaction.greeting.update({ where: { id: greeting.id }, data: { status: "ACCEPTED", respondedAt: at } });
        const conversation = await transaction.conversation.upsert({
          where: { teacherId_parentId_tutoringRequestId: { teacherId, parentId, tutoringRequestId: greeting.tutoringRequestId } },
          update: {}, create: { greetingId: greeting.id, teacherId, parentId, tutoringRequestId: greeting.tutoringRequestId },
        });
        return { ...toDto(updated), conversationEstablished: true, conversationId: conversation.id };
      }, { isolationLevel: "ReadCommitted" });
      if ("workflowError" in result) throw result.workflowError;
      return result;
    },

    async listInbox(actor: Actor, rawQuery: unknown) {
      assertActor(actor.role);
      const query = greetingInboxQuerySchema.parse(rawQuery);
      const at = now();
      const actorRole = actor.role === "parent" ? "PARENT" : "TEACHER";
      const account = await prisma.account.findFirst({ where: { id: actor.id, role: actorRole, status: "ACTIVE" }, select: { id: true } });
      if (!account) throw new GreetingWorkflowError("UNAUTHORIZED", "登录状态无效");
      const side = query.box === "sent" ? { senderAccountId: actor.id } : { recipientAccountId: actor.id };
      await prisma.greeting.updateMany({ where: { ...side, status: "PENDING", expiresAt: { lte: at } }, data: { status: "EXPIRED" } });
      const cursor = query.cursor ? decodeGreetingCursor(query.cursor) : null;
      const where: Prisma.GreetingWhereInput = {
        ...side,
        ...(cursor ? { OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ] } : {}),
      };
      const rows = await prisma.greeting.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: query.pageSize + 1,
      });
      const hasMore = rows.length > query.pageSize;
      const items = hasMore ? rows.slice(0, query.pageSize) : rows;
      const boundary = hasMore ? items.at(-1) : undefined;
      return {
        items: items.map((row) => toDto(row, actor.id)),
        pageSize: query.pageSize,
        nextCursor: boundary ? encodeGreetingCursor({ createdAt: boundary.createdAt, id: boundary.id }) : null,
      };
    },
  };
}

export type GreetingService = ReturnType<typeof createGreetingService>;
