import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { queryConversationContext, safeMessageSelect, toMessageDto } from "@/features/chat/data";
import {
  requestPublicVisibilityWhere,
  teacherPublicVisibilityWhere,
} from "@/features/directory/public-visibility";
import { toPublicRequestDetail, toPublicTeacherDetail } from "@/features/directory/redaction";
import { greetingCardSnapshotSchema } from "@/features/greetings/card-schema";
import { violatesContactPolicy } from "@/features/safety/contact-policy";

import type { ModerationTarget } from "./schema";

export type ModerationActor = { id: string; role: string };
type Db = PrismaClient | Prisma.TransactionClient;

export type ResolvedModerationTarget = {
  targetType: "TEACHER_PROFILE" | "TUTORING_REQUEST" | "GREETING" | "CONVERSATION" | "MESSAGE";
  targetId: string;
  reportedAccountId: string;
  teacherProfileId?: string;
  tutoringRequestId?: string;
  greetingId?: string;
  conversationId?: string;
  messageId?: string;
  snapshot: Prisma.InputJsonObject;
  pair: { teacherId: string; parentId: string };
  pendingGreeting?: boolean;
  greetingContextKey?: string;
};

export type ResolvedBlockTarget = Omit<ResolvedModerationTarget, "snapshot"> & {
  snapshot?: Prisma.InputJsonObject;
};

async function resolveTeacherProfile(
  client: Db,
  actor: ModerationActor,
  profileId: string,
  now: Date,
  purpose: "report" | "block",
): Promise<ResolvedModerationTarget | ResolvedBlockTarget | null> {
  if (actor.role !== "parent") return null;
  if (purpose === "block") {
    const row = await client.teacherProfile.findFirst({
      where: { AND: [teacherPublicVisibilityWhere, { id: profileId }] },
      select: { id: true, accountId: true },
    });
    if (!row) return null;
    return {
      targetType: "TEACHER_PROFILE",
      targetId: row.id,
      reportedAccountId: row.accountId,
      teacherProfileId: row.id,
      pair: { teacherId: row.accountId, parentId: actor.id },
    };
  }
  const row = await client.teacherProfile.findFirst({
    where: { AND: [teacherPublicVisibilityWhere, { id: profileId }] },
    select: {
      id: true, displayName: true, identityType: true, headline: true, bio: true,
      yearsExperience: true, hourlyRate: true, hourlyRateMax: true, isOnline: true, publishedAt: true,
      accountId: true,
    },
  });
  if (!row) return null;
  const subjectLinks = await client.teacherSubject.findMany({
    where: { teacherProfileId: row.id }, select: { subjectId: true }, orderBy: { subjectId: "asc" },
  });
  const subjectRows = await client.subject.findMany({
    where: { id: { in: subjectLinks.map(({ subjectId }) => subjectId) }, isActive: true },
    select: { id: true, name: true },
  });
  const subjectById = new Map(subjectRows.map((subject) => [subject.id, subject]));
  const areaLinks = await client.teacherServiceArea.findMany({
    where: { teacherProfileId: row.id },
    select: { regionId: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" }, { regionId: "asc" }],
  });
  const regionRows = await client.region.findMany({
    where: { id: { in: areaLinks.map(({ regionId }) => regionId) }, isActive: true, level: 3 },
    select: { id: true, name: true },
  });
  const regionById = new Map(regionRows.map((region) => [region.id, region]));
  const verifications = await client.verification.findMany({
    where: {
      teacherProfileId: row.id, status: "APPROVED",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  const profile = {
    ...row,
    subjects: subjectLinks.flatMap(({ subjectId }) => {
      const subject = subjectById.get(subjectId);
      return subject ? [{ subject }] : [];
    }),
    serviceAreas: areaLinks.flatMap(({ regionId, isPrimary }) => {
      const region = regionById.get(regionId);
      return region ? [{ isPrimary, region }] : [];
    }),
    verifications,
  };
  return {
    targetType: "TEACHER_PROFILE",
    targetId: row.id,
    reportedAccountId: row.accountId,
    teacherProfileId: row.id,
    snapshot: { kind: "teacher_profile", profile: toPublicTeacherDetail(profile) },
    pair: { teacherId: row.accountId, parentId: actor.id },
  };
}

async function resolveTutoringRequest(
  client: Db,
  actor: ModerationActor,
  requestId: string,
  now: Date,
  purpose: "report" | "block",
): Promise<ResolvedModerationTarget | ResolvedBlockTarget | null> {
  if (actor.role !== "teacher") return null;
  const row = await client.tutoringRequest.findFirst({
    where: { AND: [requestPublicVisibilityWhere(now), { id: requestId }] },
    select: purpose === "block"
      ? { id: true, parentProfileId: true }
      : {
          id: true, title: true, description: true, scheduleText: true, budgetMin: true, budgetMax: true,
          teachingMode: true, publicLocationNote: true, publishedAt: true,
          parentProfileId: true, studentProfileId: true, regionId: true,
        },
  });
  if (!row) return null;
  const parentProfile = await client.parentProfile.findUnique({
    where: { id: row.parentProfileId }, select: { accountId: true },
  });
  if (!parentProfile) return null;
  if (purpose === "block") {
    return {
      targetType: "TUTORING_REQUEST",
      targetId: row.id,
      reportedAccountId: parentProfile.accountId,
      tutoringRequestId: row.id,
      pair: { teacherId: actor.id, parentId: parentProfile.accountId },
    };
  }
  const studentProfile = row.studentProfileId ? await client.studentProfile.findFirst({
    where: { id: row.studentProfileId, isActive: true }, select: { displayName: true, gradeLevel: true },
  }) : null;
  const region = row.regionId ? await client.region.findFirst({
    where: { id: row.regionId, isActive: true, level: 3 }, select: { id: true, name: true },
  }) : null;
  const subjectLinks = await client.requestSubject.findMany({
    where: { tutoringRequestId: row.id }, select: { subjectId: true }, orderBy: { subjectId: "asc" },
  });
  const subjectRows = await client.subject.findMany({
    where: { id: { in: subjectLinks.map(({ subjectId }) => subjectId) }, isActive: true },
    select: { id: true, name: true },
  });
  const subjectById = new Map(subjectRows.map((subject) => [subject.id, subject]));
  const request = {
    ...row,
    studentProfile,
    region,
    subjects: subjectLinks.flatMap(({ subjectId }) => {
      const subject = subjectById.get(subjectId);
      return subject ? [{ subject }] : [];
    }),
  };
  return {
    targetType: "TUTORING_REQUEST",
    targetId: row.id,
    reportedAccountId: parentProfile.accountId,
    tutoringRequestId: row.id,
    snapshot: { kind: "tutoring_request", request: toPublicRequestDetail(request) },
    pair: { teacherId: actor.id, parentId: parentProfile.accountId },
  };
}

async function validPair(client: Db, teacherId: string, parentId: string, requireActive: boolean) {
  const accounts = await client.account.findMany({
    where: { id: { in: [teacherId, parentId] }, ...(requireActive ? { status: "ACTIVE" as const } : {}) },
    select: { id: true, role: true },
  });
  return accounts.some((account) => account.id === teacherId && account.role === "TEACHER")
    && accounts.some((account) => account.id === parentId && account.role === "PARENT");
}

async function resolveGreeting(
  client: Db,
  actor: ModerationActor,
  greetingId: string,
  requireActive: boolean,
): Promise<ResolvedModerationTarget | null> {
  const row = await client.greeting.findFirst({
    where: { id: greetingId, recipientAccountId: actor.id },
    select: {
      id: true, senderAccountId: true, recipientAccountId: true, tutoringRequestId: true, contextKey: true,
      message: true, cardSnapshot: true, status: true,
      sender: { select: { role: true, status: true } },
    },
  });
  if (!row || (requireActive && row.sender.status !== "ACTIVE")) return null;
  const expectedSenderRole = actor.role === "parent" ? "TEACHER" : actor.role === "teacher" ? "PARENT" : null;
  if (!expectedSenderRole || row.sender.role !== expectedSenderRole) return null;
  const teacherId = actor.role === "parent" ? row.senderAccountId : actor.id;
  const parentId = actor.role === "parent" ? actor.id : row.senderAccountId;
  if (!await validPair(client, teacherId, parentId, requireActive)) return null;
  const parsedCard = greetingCardSnapshotSchema.safeParse(row.cardSnapshot);
  const note = row.message && violatesContactPolicy(row.message) ? "历史说明已隐藏" : row.message ?? "";
  return {
    targetType: "GREETING",
    targetId: row.id,
    reportedAccountId: row.senderAccountId,
    tutoringRequestId: row.tutoringRequestId,
    greetingId: row.id,
    snapshot: {
      kind: "greeting",
      greeting: { id: row.id, note, card: parsedCard.success ? parsedCard.data : { legacy: true } },
    },
    pair: { teacherId, parentId },
    pendingGreeting: row.status === "PENDING",
    greetingContextKey: row.contextKey,
  };
}

async function loadVisibleConversation(
  client: Db,
  actor: ModerationActor,
  conversationId: string,
  requireActive: boolean,
) {
  const row = await queryConversationContext(client, conversationId);
  if (!row || !row.contextValid || (row.teacherId !== actor.id && row.parentId !== actor.id)) return null;
  if (!await validPair(client, row.teacherId, row.parentId, requireActive)) return null;
  return row;
}

async function resolveConversation(
  client: Db,
  actor: ModerationActor,
  conversationId: string,
  requireActive: boolean,
): Promise<ResolvedModerationTarget | null> {
  const row = await loadVisibleConversation(client, actor, conversationId, requireActive);
  if (!row) return null;
  const actorIsTeacher = actor.id === row.teacherId;
  return {
    targetType: "CONVERSATION",
    targetId: row.id,
    reportedAccountId: actorIsTeacher ? row.parentId : row.teacherId,
    tutoringRequestId: row.tutoringRequestId,
    conversationId: row.id,
    snapshot: {
      kind: "conversation",
      conversation: {
        id: row.id,
        counterpart: {
          role: actorIsTeacher ? "parent" : "teacher",
          displayName: actorIsTeacher ? row.parentDisplayName : row.teacherDisplayName,
        },
        request: { id: row.tutoringRequestId, title: row.requestTitle },
      },
    },
    pair: { teacherId: row.teacherId, parentId: row.parentId },
  };
}

async function resolveMessage(
  client: Db,
  actor: ModerationActor,
  messageId: string,
  requireActive: boolean,
): Promise<ResolvedModerationTarget | null> {
  const message = await client.message.findUnique({
    where: { id: messageId },
    select: { ...safeMessageSelect, conversationId: true },
  });
  if (!message) return null;
  const conversation = await loadVisibleConversation(client, actor, message.conversationId, requireActive);
  if (!conversation) return null;
  const counterpartId = actor.id === conversation.teacherId ? conversation.parentId : conversation.teacherId;
  if (message.senderAccountId !== actor.id && message.senderAccountId !== counterpartId) return null;
  return {
    targetType: "MESSAGE",
    targetId: message.id,
    reportedAccountId: message.senderAccountId,
    tutoringRequestId: conversation.tutoringRequestId,
    conversationId: conversation.id,
    messageId: message.id,
    snapshot: {
      kind: "message",
      message: toMessageDto(message, actor.id),
      conversation: {
        id: conversation.id,
        request: { id: conversation.tutoringRequestId, title: conversation.requestTitle },
      },
    },
    pair: { teacherId: conversation.teacherId, parentId: conversation.parentId },
  };
}

export function targetIdentity(target: ModerationTarget) {
  if (target.kind === "teacher_profile") return { targetType: "TEACHER_PROFILE" as const, targetId: target.profileId };
  if (target.kind === "tutoring_request") return { targetType: "TUTORING_REQUEST" as const, targetId: target.requestId };
  if (target.kind === "greeting") return { targetType: "GREETING" as const, targetId: target.greetingId };
  if (target.kind === "conversation") return { targetType: "CONVERSATION" as const, targetId: target.conversationId };
  return { targetType: "MESSAGE" as const, targetId: target.messageId };
}

export function resolveModerationTarget(
  client: Db,
  actor: ModerationActor,
  target: ModerationTarget,
  now: Date,
  purpose: "report",
): Promise<ResolvedModerationTarget | null>;
export function resolveModerationTarget(
  client: Db,
  actor: ModerationActor,
  target: ModerationTarget,
  now: Date,
  purpose: "block",
): Promise<ResolvedBlockTarget | null>;
export async function resolveModerationTarget(
  client: Db,
  actor: ModerationActor,
  target: ModerationTarget,
  now: Date,
  purpose: "report" | "block",
): Promise<ResolvedModerationTarget | ResolvedBlockTarget | null> {
  const requireActive = purpose === "block";
  if (target.kind === "teacher_profile") {
    return resolveTeacherProfile(client, actor, target.profileId, now, purpose);
  }
  if (target.kind === "tutoring_request") {
    return resolveTutoringRequest(client, actor, target.requestId, now, purpose);
  }
  if (target.kind === "greeting") return resolveGreeting(client, actor, target.greetingId, requireActive);
  if (target.kind === "conversation") return resolveConversation(client, actor, target.conversationId, requireActive);
  return resolveMessage(client, actor, target.messageId, requireActive);
}
