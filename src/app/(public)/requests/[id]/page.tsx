import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { CircleRibbon } from "@/components/directory/circle-ribbon";
import { DirectoryContactCta } from "@/components/directory/contact-cta";
import { resolveRequestCircleTier } from "@/features/directory/circle";
import { formatDirectoryDate } from "@/features/directory/date";
import { getAdjacentRegionPairs, getDirectoryAccessContext } from "@/features/directory/personalization";
import { directoryRepository } from "@/features/directory/server";
import type { PublicRequestDetail } from "@/features/directory/redaction";

export const metadata: Metadata = { title: "家教需求详情｜家教平台" };
const modes = { ONLINE: "线上", OFFLINE: "线下", BOTH: "线上 / 线下均可" } as const;
const gradeLabels: Record<string, string> = { GRADE_1: "一年级", GRADE_2: "二年级", GRADE_3: "三年级", GRADE_4: "四年级", GRADE_5: "五年级", GRADE_6: "六年级", GRADE_7: "初一", GRADE_8: "初二", GRADE_9: "初三", GRADE_10: "高一", GRADE_11: "高二", GRADE_12: "高三", OTHER: "其他阶段" };
function budget(min: number | null, max: number | null) { return min === null || max === null ? "面议" : `¥${min / 100}–${max / 100}/小时`; }

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const access = await getDirectoryAccessContext("teacher");
  const request = access.authenticated
    ? await directoryRepository.getRequestDetail(parsed.data)
    : await directoryRepository.getRequestPreview(parsed.data);
  if (!request) notFound();
  const detail = access.authenticated ? request as PublicRequestDetail : null;
  const viewer = access.matchingViewer;
  let tier;
  if (viewer) {
    const adjacent = await getAdjacentRegionPairs([...viewer.districtIds.map(({ districtId }) => districtId), ...(request.region ? [request.region.id] : [])]);
    tier = resolveRequestCircleTier({ id: request.id, subjectIds: request.subjects.map(({ id }) => id), districtId: request.region?.id ?? null, acceptsOnline: request.teachingMode === "ONLINE" || request.teachingMode === "BOTH" }, viewer, adjacent);
  }
  return (
    <main className="directory-detail directory-detail--request" id="main-content">
      <div className="site-container directory-detail__breadcrumbs"><Link href="/requests">← 返回需求公告</Link><span>公开需求编号 · {request.id.slice(0, 8)}</span></div>
      <div className="site-container directory-detail__grid">
        <article className="directory-profile-sheet">
          <header><div className="directory-profile-sheet__avatar" aria-hidden="true">需</div><div><p className="eyebrow">{request.studentAlias} · {gradeLabels[request.gradeLevel ?? ""] ?? "学习阶段"}</p><h1>{request.title}</h1><p>{request.region?.name ?? "区县未公开"} · {request.teachingMode ? modes[request.teachingMode] : "方式待商量"}</p></div>{tier ? <CircleRibbon tier={tier} /> : null}</header>
          {detail ? <section><p className="eyebrow">需求说明</p><h2>希望老师了解的学习情况</h2><p className="directory-detail__prose">{detail.description}</p></section> : null}
          <section><p className="eyebrow">安排与预算</p><dl className="directory-detail__facts"><div><dt>预算</dt><dd>{budget(request.budgetMinCents, request.budgetMaxCents)}</dd></div><div><dt>上课方式</dt><dd>{request.teachingMode ? modes[request.teachingMode] : "待商量"}</dd></div><div><dt>时间安排</dt><dd>{request.scheduleText ?? "待商量"}</dd></div><div><dt>大致位置</dt><dd>{request.region?.name}{detail?.publicLocationNote ? ` · ${detail.publicLocationNote}` : ""}</dd></div></dl></section>
          <section><p className="eyebrow">辅导科目</p><ul className="directory-tags">{request.subjects.map((subject) => <li key={subject.id}>{subject.name}</li>)}</ul></section>
          <footer>发布于 {request.publishedAt ? formatDirectoryDate(request.publishedAt) : "未知日期"} · 学生内部备注、家长资料与联系方式均不公开</footer>
        </article>
        <DirectoryContactCta isLoggedIn={access.authenticated} kind="request" />
      </div>
    </main>
  );
}
