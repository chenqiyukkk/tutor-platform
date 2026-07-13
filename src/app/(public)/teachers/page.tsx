import type { Metadata } from "next";
import Link from "next/link";

import { CircleRibbon } from "@/components/directory/circle-ribbon";
import { FilterBar } from "@/components/directory/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { resolveTeacherCircleTier, type DirectoryCircleTier } from "@/features/directory/circle";
import { getAdjacentRegionPairs, getDirectoryAccessContext, getDirectoryFilterOptions } from "@/features/directory/personalization";
import { DirectoryQueryError, parseTeacherDirectoryQuery } from "@/features/directory/query";
import { directoryRepository } from "@/features/directory/server";

export const metadata: Metadata = { title: "找老师｜家教平台" };

type SearchValues = Record<string, string | string[] | undefined>;

const identityLabels = {
  UNIVERSITY_STUDENT: "在校大学生",
  FULL_TIME_TEACHER: "全职教师",
  OTHER: "其他教育从业者",
} as const;

function searchParams(values: SearchValues) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : value ? [value] : []) params.append(key, entry);
  }
  return params;
}

function pageHref(params: URLSearchParams, page: number) {
  const next = new URLSearchParams(params);
  next.set("page", String(page));
  return `/teachers?${next.toString()}`;
}

function rate(minimum: number | null, maximum: number | null) {
  if (minimum === null || maximum === null) return "价格面议";
  return minimum === maximum ? `¥${minimum / 100}/小时` : `¥${minimum / 100}–${maximum / 100}/小时`;
}

export default async function TeachersPage({ searchParams: incoming }: { searchParams: Promise<SearchValues> }) {
  const raw = searchParams(await incoming);
  const options = await getDirectoryFilterOptions();
  let invalidMessage: string | null = null;
  let query;
  try {
    query = parseTeacherDirectoryQuery(raw);
  } catch (error) {
    invalidMessage = error instanceof DirectoryQueryError ? error.message : "筛选条件格式不正确";
    query = parseTeacherDirectoryQuery(new URLSearchParams());
  }
  const result = invalidMessage
    ? { items: [], total: 0, page: 1, pageSize: query.pageSize }
    : await directoryRepository.listTeachers(query);
  const access = await getDirectoryAccessContext("parent");
  const viewer = access.matchingViewer;
  const tiers = new Map<string, DirectoryCircleTier>();
  if (viewer) {
    const targetDistricts = result.items.flatMap(({ serviceAreas }) => serviceAreas.map(({ id }) => id));
    const adjacent = await getAdjacentRegionPairs([
      ...viewer.districtIds.map(({ districtId }) => districtId),
      ...targetDistricts,
    ]);
    for (const teacher of result.items) {
      const tier = resolveTeacherCircleTier({
        id: teacher.id,
        subjectIds: teacher.subjects.map(({ id }) => id),
        serviceAreas: teacher.serviceAreas.map(({ id, isPrimary }) => ({ districtId: id, isPrimary })),
        acceptsOnline: teacher.online,
      }, viewer, adjacent);
      if (tier) tiers.set(teacher.id, tier);
    }
  }
  const totalPages = Math.ceil(result.total / result.pageSize);

  return (
    <main className="directory-page" id="main-content">
      <header className="directory-hero">
        <div className="site-container directory-hero__inner">
          <p className="eyebrow">家长找老师</p>
          <h1>一页一页，认真看看谁适合孩子</h1>
          <p>只展示已发布、账号正常且地区科目仍有效的资料。公开位置止于区县，不展示联系方式。</p>
          {viewer ? <p className="directory-hero__personalized">已按你的最近地区信息标记圈层</p> : <CircleRibbon authenticated={access.authenticated} />}
        </div>
      </header>
      <div className="site-container directory-layout">
        <aside><FilterBar kind="teachers" options={options} values={query} /></aside>
        <section aria-labelledby="teacher-results-title" className="directory-results">
          <div className="directory-results__heading">
            <div><p className="eyebrow">公开老师名册</p><h2 id="teacher-results-title">{invalidMessage ? "筛选条件需要修改" : `找到 ${result.total} 位老师`}</h2></div>
            <Link className="directory-switch" href="/requests">切换查看家教需求 →</Link>
          </div>
          {invalidMessage ? (
            <EmptyState eyebrow="筛选条件无效" title="无法使用这组筛选" description={`${invalidMessage}。请清除筛选后重试。`} action={<Link className="button button--outline" href="/teachers">清除筛选</Link>} />
          ) : result.items.length ? (
            <div className="directory-card-list">
              {result.items.map((teacher) => (
                <article className="directory-card directory-card--teacher" key={teacher.id}>
                  <div className="directory-card__marker" aria-hidden="true">{teacher.publicNickname.slice(0, 1)}</div>
                  <div className="directory-card__body">
                    <div className="directory-card__topline">
                      <div><p className="eyebrow">{teacher.identityType ? identityLabels[teacher.identityType] : "教师"}</p><h3>{teacher.publicNickname}</h3></div>
                      {tiers.get(teacher.id) ? <CircleRibbon tier={tiers.get(teacher.id)} /> : null}
                    </div>
                    <p className="directory-card__lead">{teacher.headline || "认真对待每一次教学相遇"}</p>
                    <ul className="directory-tags" aria-label="授课科目">{teacher.subjects.map((subject) => <li key={subject.id}>{subject.name}</li>)}</ul>
                    <dl className="directory-card__facts">
                      <div><dt>经验</dt><dd>{teacher.yearsExperience} 年</dd></div>
                      <div><dt>课时费</dt><dd>{rate(teacher.rateMinCents, teacher.rateMaxCents)}</dd></div>
                      <div><dt>地区</dt><dd>{teacher.serviceAreas.map(({ name }) => name).join("、")}</dd></div>
                      <div><dt>方式</dt><dd>{teacher.online ? "线上 / 线下" : "线下"}</dd></div>
                    </dl>
                    <div className="directory-card__footer"><span>{teacher.verified ? "✓ 身份认证已通过" : "认证状态未通过"}</span><Link className="text-link" href={`/teachers/${teacher.id}`}>查看完整资料 →</Link></div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="这一圈暂时没有合适老师" description="可以放宽地区、预算或上课方式；新资料发布后会出现在这里。" action={<Link className="button button--outline" href="/teachers">查看全部老师</Link>} />
          )}
          <Pagination currentPage={result.page} totalPages={totalPages} getHref={(page) => pageHref(raw, page)} />
        </section>
      </div>
    </main>
  );
}
