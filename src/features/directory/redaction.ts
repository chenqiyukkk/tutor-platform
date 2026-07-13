export type PublicSubject = { id: string; name: string };
export type PublicRegion = { id: string; name: string };
export type PublicServiceArea = PublicRegion & { isPrimary: boolean };

type DecimalLike = { toNumber(): number };

export type PublicTeacherRow = {
  id: string;
  displayName: string;
  identityType: "UNIVERSITY_STUDENT" | "FULL_TIME_TEACHER" | "OTHER" | null;
  headline: string | null;
  bio: string | null;
  yearsExperience: number | null;
  hourlyRate: DecimalLike | null;
  hourlyRateMax: DecimalLike | null;
  isOnline: boolean;
  publishedAt: Date | null;
  subjects: Array<{ subject: PublicSubject }>;
  serviceAreas: Array<{ isPrimary: boolean; region: PublicRegion }>;
  verifications: Array<{ id: string }>;
};

export type PublicRequestRow = {
  id: string;
  title: string;
  description: string;
  scheduleText: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  teachingMode: "OFFLINE" | "ONLINE" | "BOTH" | null;
  publicLocationNote: string | null;
  publishedAt: Date | null;
  studentProfile: { displayName: string; gradeLevel: string | null } | null;
  region: PublicRegion | null;
  subjects: Array<{ subject: PublicSubject }>;
};

function cents(value: DecimalLike | null) {
  return value === null ? null : Math.round(value.toNumber() * 100);
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export function toPublicTeacherListItem(row: PublicTeacherRow) {
  return {
    id: row.id,
    publicNickname: row.displayName,
    identityType: row.identityType,
    headline: row.headline,
    yearsExperience: row.yearsExperience,
    rateMinCents: cents(row.hourlyRate),
    rateMaxCents: cents(row.hourlyRateMax),
    online: row.isOnline,
    subjects: row.subjects.map(({ subject }) => ({ id: subject.id, name: subject.name })),
    serviceAreas: row.serviceAreas.map(({ isPrimary, region }) => ({
      id: region.id,
      name: region.name,
      isPrimary,
    })),
    verified: row.verifications.length > 0,
    publishedAt: iso(row.publishedAt),
  };
}

export function toPublicTeacherDetail(row: PublicTeacherRow) {
  return { ...toPublicTeacherListItem(row), bio: row.bio };
}

export function toPublicRequestListItem(row: PublicRequestRow) {
  return {
    id: row.id,
    title: row.title,
    studentAlias: row.studentProfile?.displayName ?? null,
    gradeLevel: row.studentProfile?.gradeLevel ?? null,
    budgetMinCents: row.budgetMin,
    budgetMaxCents: row.budgetMax,
    teachingMode: row.teachingMode,
    scheduleText: row.scheduleText,
    region: row.region ? { id: row.region.id, name: row.region.name } : null,
    subjects: row.subjects.map(({ subject }) => ({ id: subject.id, name: subject.name })),
    publishedAt: iso(row.publishedAt),
  };
}

export function toPublicRequestDetail(row: PublicRequestRow) {
  return {
    ...toPublicRequestListItem(row),
    description: row.description,
    publicLocationNote: row.publicLocationNote,
  };
}

export type PublicTeacherListItem = ReturnType<typeof toPublicTeacherListItem>;
export type PublicTeacherDetail = ReturnType<typeof toPublicTeacherDetail>;
export type PublicRequestListItem = ReturnType<typeof toPublicRequestListItem>;
export type PublicRequestDetail = ReturnType<typeof toPublicRequestDetail>;
