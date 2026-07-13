import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { CircleRibbon } from "@/components/directory/circle-ribbon";
import { DirectoryContactCta } from "@/components/directory/contact-cta";
import { GreetingComposer } from "@/components/greetings/greeting-composer";
import { resolveTeacherCircleTier } from "@/features/directory/circle";
import { formatDirectoryDate } from "@/features/directory/date";
import { getAdjacentRegionPairs, getDirectoryAccessContext } from "@/features/directory/personalization";
import { directoryRepository } from "@/features/directory/server";
import type { PublicTeacherDetail } from "@/features/directory/redaction";
import { getParentPublishedRequestOptions } from "@/features/greetings/page-data";

export const metadata: Metadata = { title: "教师公开资料｜家教平台" };
const identityLabels = { UNIVERSITY_STUDENT: "在校大学生", FULL_TIME_TEACHER: "全职教师", OTHER: "其他教育从业者" } as const;
function money(value: number | null) { return value === null ? "面议" : `¥${value / 100}`; }

export default async function TeacherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const access = await getDirectoryAccessContext("parent");
  const teacher = access.authenticated
    ? await directoryRepository.getTeacherDetail(parsed.data)
    : await directoryRepository.getTeacherPreview(parsed.data);
  if (!teacher) notFound();
  const detail = access.authenticated ? teacher as PublicTeacherDetail : null;
  const greetingRequests = access.authenticated ? await getParentPublishedRequestOptions() : [];
  const viewer = access.matchingViewer;
  let tier;
  if (viewer) {
    const adjacent = await getAdjacentRegionPairs([...viewer.districtIds.map(({ districtId }) => districtId), ...teacher.serviceAreas.map(({ id }) => id)]);
    tier = resolveTeacherCircleTier({ id: teacher.id, subjectIds: teacher.subjects.map(({ id }) => id), serviceAreas: teacher.serviceAreas.map(({ id, isPrimary }) => ({ districtId: id, isPrimary })), acceptsOnline: teacher.online }, viewer, adjacent);
  }
  return (
    <main className="directory-detail" id="main-content">
      <div className="site-container directory-detail__breadcrumbs"><Link href="/teachers">← 返回老师名册</Link><span>公开资料编号 · {teacher.id.slice(0, 8)}</span></div>
      <div className="site-container directory-detail__grid">
        <article className="directory-profile-sheet">
          <header><div className="directory-profile-sheet__avatar" aria-hidden="true">{teacher.publicNickname.slice(0, 1)}</div><div><p className="eyebrow">{teacher.identityType ? identityLabels[teacher.identityType] : "教师"}</p><h1>{teacher.publicNickname}</h1><p>{teacher.headline}</p></div>{tier ? <CircleRibbon tier={tier} /> : null}</header>
          {detail ? <section><p className="eyebrow">教学自述</p><h2>怎样陪学生把问题想明白</h2><p className="directory-detail__prose">{detail.bio}</p></section> : null}
          <section><p className="eyebrow">授课信息</p><dl className="directory-detail__facts"><div><dt>教学经验</dt><dd>{teacher.yearsExperience} 年</dd></div><div><dt>课时费</dt><dd>{money(teacher.rateMinCents)}–{money(teacher.rateMaxCents)}/小时</dd></div><div><dt>上课方式</dt><dd>{teacher.online ? "线上 / 线下" : "线下"}</dd></div><div><dt>认证</dt><dd>{teacher.verified ? "已通过身份认证" : "未通过认证"}</dd></div></dl></section>
          <section><p className="eyebrow">科目与地区</p><div className="directory-detail__columns"><div><h2>授课科目</h2><ul className="directory-tags">{teacher.subjects.map((subject) => <li key={subject.id}>{subject.name}</li>)}</ul></div><div><h2>服务区县</h2><ul className="directory-area-list">{teacher.serviceAreas.map((area) => <li key={area.id}><strong>{area.name}</strong>{area.isPrimary ? <span>主要地区</span> : null}</li>)}</ul></div></div></section>
          <footer>发布于 {teacher.publishedAt ? formatDirectoryDate(teacher.publishedAt) : "未知日期"} · 平台不会展示证件材料或联系方式</footer>
        </article>
        {access.authenticated ? <GreetingComposer realm="parent" requestOptions={greetingRequests} targetId={teacher.id} /> : <DirectoryContactCta kind="teacher" />}
      </div>
    </main>
  );
}
