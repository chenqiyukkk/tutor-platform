import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import type { RequestDirectoryQuery, TeacherDirectoryQuery } from "./query";
import {
  toPublicRequestDetail,
  toPublicRequestListItem,
  toPublicTeacherDetail,
  toPublicTeacherListItem,
  type PublicRequestDetail,
  type PublicRequestListItem,
  type PublicTeacherDetail,
  type PublicTeacherListItem,
} from "./redaction";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

const teacherScalarSelect = {
  id: true,
  displayName: true,
  identityType: true,
  headline: true,
  bio: true,
  yearsExperience: true,
  hourlyRate: true,
  hourlyRateMax: true,
  isOnline: true,
  publishedAt: true,
} satisfies Prisma.TeacherProfileSelect;

const requestScalarSelect = {
  id: true,
  title: true,
  description: true,
  scheduleText: true,
  budgetMin: true,
  budgetMax: true,
  teachingMode: true,
  publicLocationNote: true,
  publishedAt: true,
  studentProfileId: true,
  regionId: true,
} satisfies Prisma.TutoringRequestSelect;

const teacherPublicBase: Prisma.TeacherProfileWhereInput = {
  status: "PUBLISHED",
  publishedAt: { not: null },
  displayName: { not: "" },
  identityType: { not: null },
  bio: { not: null },
  yearsExperience: { not: null },
  hourlyRate: { not: null },
  hourlyRateMax: { not: null },
  account: { role: "TEACHER", status: "ACTIVE" },
  subjects: {
    some: {},
    every: { subject: { isActive: true } },
  },
  serviceAreas: {
    some: { isPrimary: true },
    every: { region: { isActive: true, level: 3 } },
  },
};

function requestPublicBase(): Prisma.TutoringRequestWhereInput {
  return {
    status: "PUBLISHED",
    publishedAt: { not: null },
    title: { not: "" },
    description: { not: "" },
    parentProfile: { account: { role: "PARENT", status: "ACTIVE" } },
    studentProfile: { is: { isActive: true } },
    region: { is: { isActive: true, level: 3 } },
    subjects: {
      some: {},
      every: { subject: { isActive: true } },
    },
  };
}

function teacherWhere(query: TeacherDirectoryQuery): Prisma.TeacherProfileWhereInput {
  const filters: Prisma.TeacherProfileWhereInput[] = [teacherPublicBase];
  if (query.district) filters.push({ serviceAreas: { some: { regionId: query.district } } });
  if (query.subject) filters.push({ subjects: { some: { subjectId: query.subject } } });
  if (query.identityType) filters.push({ identityType: query.identityType });
  if (query.mode === "ONLINE") filters.push({ isOnline: true });
  if (query.budgetMax !== undefined) {
    filters.push({ hourlyRate: { lte: new Prisma.Decimal(query.budgetMax).dividedBy(100) } });
  }
  if (query.budgetMin !== undefined) {
    filters.push({ hourlyRateMax: { gte: new Prisma.Decimal(query.budgetMin).dividedBy(100) } });
  }
  return { AND: filters };
}

function requestWhere(query: RequestDirectoryQuery, now = new Date()): Prisma.TutoringRequestWhereInput {
  const filters: Prisma.TutoringRequestWhereInput[] = [
    requestPublicBase(),
    { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  ];
  if (query.district) filters.push({ regionId: query.district });
  if (query.subject) filters.push({ subjects: { some: { subjectId: query.subject } } });
  if (query.mode === "ONLINE") filters.push({ teachingMode: { in: ["ONLINE", "BOTH"] } });
  if (query.mode === "OFFLINE") filters.push({ teachingMode: { in: ["OFFLINE", "BOTH"] } });
  if (query.budgetMax !== undefined) filters.push({ budgetMin: { lte: query.budgetMax } });
  if (query.budgetMin !== undefined) filters.push({ budgetMax: { gte: query.budgetMin } });
  return { AND: filters };
}

export type DirectoryPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export interface DirectoryRepository {
  listTeachers(query: TeacherDirectoryQuery): Promise<DirectoryPage<PublicTeacherListItem>>;
  getTeacher(id: string): Promise<PublicTeacherDetail | null>;
  listRequests(query: RequestDirectoryQuery): Promise<DirectoryPage<PublicRequestListItem>>;
  getRequest(id: string): Promise<PublicRequestDetail | null>;
}

export class PrismaDirectoryRepository implements DirectoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async hydrateTeachers(
    client: DatabaseClient,
    rows: Array<Prisma.TeacherProfileGetPayload<{ select: typeof teacherScalarSelect }>>,
  ) {
    const profileIds = rows.map(({ id }) => id);
    if (!profileIds.length) return [];
    const links = await client.teacherSubject.findMany({
      where: { teacherProfileId: { in: profileIds } },
      select: { teacherProfileId: true, subjectId: true },
      orderBy: [{ teacherProfileId: "asc" }, { subjectId: "asc" }],
    });
    const subjectIds = [...new Set(links.map(({ subjectId }) => subjectId))];
    const subjects = await client.subject.findMany({
      where: { id: { in: subjectIds }, isActive: true },
      select: { id: true, name: true },
    });
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
    const areaLinks = await client.teacherServiceArea.findMany({
      where: { teacherProfileId: { in: profileIds } },
      select: { teacherProfileId: true, regionId: true, isPrimary: true },
      orderBy: [{ teacherProfileId: "asc" }, { isPrimary: "desc" }, { regionId: "asc" }],
    });
    const regionIds = [...new Set(areaLinks.map(({ regionId }) => regionId))];
    const regions = await client.region.findMany({
      where: { id: { in: regionIds }, isActive: true, level: 3 },
      select: { id: true, name: true },
    });
    const regionById = new Map(regions.map((region) => [region.id, region]));
    const now = new Date();
    const verifications = await client.verification.findMany({
      where: {
        teacherProfileId: { in: profileIds },
        status: "APPROVED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, teacherProfileId: true },
    });
    const verificationByProfile = new Map<string, { id: string }[]>();
    for (const verification of verifications) {
      const list = verificationByProfile.get(verification.teacherProfileId ?? "") ?? [];
      list.push({ id: verification.id });
      verificationByProfile.set(verification.teacherProfileId ?? "", list);
    }
    return rows.map((row) => ({
      ...row,
      subjects: links
        .filter(({ teacherProfileId }) => teacherProfileId === row.id)
        .flatMap(({ subjectId }) => {
          const subject = subjectById.get(subjectId);
          return subject ? [{ subject }] : [];
        })
        .sort((left, right) => left.subject.name.localeCompare(right.subject.name, "zh-CN")),
      serviceAreas: areaLinks
        .filter(({ teacherProfileId }) => teacherProfileId === row.id)
        .flatMap(({ regionId, isPrimary }) => {
          const region = regionById.get(regionId);
          return region ? [{ isPrimary, region }] : [];
        })
        .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary)
          || left.region.name.localeCompare(right.region.name, "zh-CN")),
      verifications: verificationByProfile.get(row.id) ?? [],
    }));
  }

  private async hydrateRequests(
    client: DatabaseClient,
    rows: Array<Prisma.TutoringRequestGetPayload<{ select: typeof requestScalarSelect }>>,
  ) {
    const requestIds = rows.map(({ id }) => id);
    if (!requestIds.length) return [];
    const studentIds = rows.flatMap(({ studentProfileId }) => studentProfileId ? [studentProfileId] : []);
    const students = await client.studentProfile.findMany({
      where: { id: { in: studentIds }, isActive: true },
      select: { id: true, displayName: true, gradeLevel: true },
    });
    const studentById = new Map(students.map((student) => [student.id, student]));
    const regionIds = rows.flatMap(({ regionId }) => regionId ? [regionId] : []);
    const regions = await client.region.findMany({
      where: { id: { in: regionIds }, isActive: true, level: 3 },
      select: { id: true, name: true },
    });
    const regionById = new Map(regions.map((region) => [region.id, region]));
    const links = await client.requestSubject.findMany({
      where: { tutoringRequestId: { in: requestIds } },
      select: { tutoringRequestId: true, subjectId: true },
      orderBy: [{ tutoringRequestId: "asc" }, { subjectId: "asc" }],
    });
    const subjectIds = [...new Set(links.map(({ subjectId }) => subjectId))];
    const subjects = await client.subject.findMany({
      where: { id: { in: subjectIds }, isActive: true },
      select: { id: true, name: true },
    });
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
    return rows.map(({ studentProfileId, regionId, ...row }) => ({
      ...row,
      studentProfile: studentProfileId ? studentById.get(studentProfileId) ?? null : null,
      region: regionId ? regionById.get(regionId) ?? null : null,
      subjects: links
        .filter(({ tutoringRequestId }) => tutoringRequestId === row.id)
        .flatMap(({ subjectId }) => {
          const subject = subjectById.get(subjectId);
          return subject ? [{ subject }] : [];
        })
        .sort((left, right) => left.subject.name.localeCompare(right.subject.name, "zh-CN")),
    }));
  }

  async listTeachers(query: TeacherDirectoryQuery) {
    const where = teacherWhere(query);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.teacherProfile.findMany({
        where,
        select: teacherScalarSelect,
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const total = await transaction.teacherProfile.count({ where });
      const hydrated = await this.hydrateTeachers(transaction, rows);
      return {
        items: hydrated.map(toPublicTeacherListItem),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    }, { isolationLevel: "RepeatableRead" });
  }

  async getTeacher(id: string) {
    const row = await this.prisma.teacherProfile.findFirst({
      where: { AND: [teacherPublicBase, { id }] },
      select: teacherScalarSelect,
    });
    if (!row) return null;
    const [hydrated] = await this.hydrateTeachers(this.prisma, [row]);
    return toPublicTeacherDetail(hydrated);
  }

  async listRequests(query: RequestDirectoryQuery) {
    const where = requestWhere(query);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.tutoringRequest.findMany({
        where,
        select: requestScalarSelect,
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const total = await transaction.tutoringRequest.count({ where });
      const hydrated = await this.hydrateRequests(transaction, rows);
      return {
        items: hydrated.map(toPublicRequestListItem),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    }, { isolationLevel: "RepeatableRead" });
  }

  async getRequest(id: string) {
    const row = await this.prisma.tutoringRequest.findFirst({
      where: { AND: [requestPublicBase(), { id }] },
      select: requestScalarSelect,
    });
    if (!row) return null;
    const [hydrated] = await this.hydrateRequests(this.prisma, [row]);
    return toPublicRequestDetail(hydrated);
  }
}
