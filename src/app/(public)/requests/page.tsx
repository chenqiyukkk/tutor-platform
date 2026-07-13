import type { Metadata } from "next";
import Link from "next/link";

import { CircleRibbon } from "@/components/directory/circle-ribbon";
import { FilterBar } from "@/components/directory/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { resolveRequestCircleTier, type DirectoryCircleTier } from "@/features/directory/circle";
import { getAdjacentRegionPairs, getDirectoryFilterOptions, getDirectoryViewerContext } from "@/features/directory/personalization";
import { DirectoryQueryError, parseRequestDirectoryQuery } from "@/features/directory/query";
import { directoryRepository } from "@/features/directory/server";

export const metadata: Metadata = { title: "找家教需求｜家教平台" };
type SearchValues = Record<string, string | string[] | undefined>;
const modeLabels = { ONLINE: "线上", OFFLINE: "线下", BOTH: "线上 / 线下均可" } as const;
const gradeLabels: Record<string, string> = { GRADE_1: "一年级", GRADE_2: "二年级", GRADE_3: "三年级", GRADE_4: "四年级", GRADE_5: "五年级", GRADE_6: "六年级", GRADE_7: "初一", GRADE_8: "初二", GRADE_9: "初三", GRADE_10: "高一", GRADE_11: "高二", GRADE_12: "高三", OTHER: "其他阶段" };

function paramsFrom(values: SearchValues) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) for (const entry of Array.isArray(value) ? value : value ? [value] : []) params.append(key, entry);
  return params;
}
function href(params: URLSearchParams, page: number) { const next = new URLSearchParams(params); next.set("page", String(page)); return `/requests?${next.toString()}`; }
function budget(min: number | null, max: number | null) { return min === null || max === null ? "预算面议" : `¥${min / 100}–${max / 100}/小时`; }

export default async function RequestsPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const raw = paramsFrom(await searchParams);
  const options = await getDirectoryFilterOptions();
  let invalidMessage: string | null = null;
  let query;
  try { query = parseRequestDirectoryQuery(raw); } catch (error) {
    invalidMessage = error instanceof DirectoryQueryError ? error.message : "筛选条件格式不正确";
    query = parseRequestDirectoryQuery(new URLSearchParams());
  }
  const result = invalidMessage ? { items: [], total: 0, page: 1, pageSize: query.pageSize } : await directoryRepository.listRequests(query);
  const viewer = await getDirectoryViewerContext("teacher");
  const tiers = new Map<string, DirectoryCircleTier>();
  if (viewer) {
    const adjacent = await getAdjacentRegionPairs([...viewer.districtIds.map(({ districtId }) => districtId), ...result.items.flatMap(({ region }) => region ? [region.id] : [])]);
    for (const request of result.items) {
      const tier = resolveRequestCircleTier({ id: request.id, subjectIds: request.subjects.map(({ id }) => id), districtId: request.region?.id ?? null, acceptsOnline: request.teachingMode === "ONLINE" || request.teachingMode === "BOTH" }, viewer, adjacent);
      if (tier) tiers.set(request.id, tier);
    }
  }
  return (
    <main className="directory-page directory-page--requests" id="main-content">
      <header className="directory-hero"><div className="site-container directory-hero__inner"><p className="eyebrow">老师找学生</p><h1>真实需求，留给真正合适的人回应</h1><p>这里不公开家长身份、联系方式或学生内部备注，只呈现选择家教所需的信息。</p>{!viewer ? <CircleRibbon /> : <p className="directory-hero__personalized">已按你的授课地区标记圈层</p>}</div></header>
      <div className="site-container directory-layout">
        <aside><FilterBar kind="requests" options={options} values={query} /></aside>
        <section aria-labelledby="request-results-title" className="directory-results">
          <div className="directory-results__heading"><div><p className="eyebrow">公开需求公告</p><h2 id="request-results-title">{invalidMessage ? "筛选条件需要修改" : `找到 ${result.total} 份需求`}</h2></div><Link className="directory-switch" href="/teachers">切换查看老师 →</Link></div>
          {invalidMessage ? <EmptyState eyebrow="筛选条件无效" title="无法使用这组筛选" description={`${invalidMessage}。请清除筛选后重试。`} action={<Link className="button button--outline" href="/requests">清除筛选</Link>} /> : result.items.length ? (
            <div className="directory-card-list">{result.items.map((request) => (
              <article className="directory-card directory-card--request" key={request.id}>
                <div className="directory-card__index" aria-hidden="true">需</div>
                <div className="directory-card__body">
                  <div className="directory-card__topline"><div><p className="eyebrow">{request.studentAlias} · {gradeLabels[request.gradeLevel ?? ""] ?? "学习阶段"}</p><h3>{request.title}</h3></div>{tiers.get(request.id) ? <CircleRibbon tier={tiers.get(request.id)} /> : null}</div>
                  <ul className="directory-tags" aria-label="辅导科目">{request.subjects.map((subject) => <li key={subject.id}>{subject.name}</li>)}</ul>
                  <dl className="directory-card__facts"><div><dt>预算</dt><dd>{budget(request.budgetMinCents, request.budgetMaxCents)}</dd></div><div><dt>方式</dt><dd>{request.teachingMode ? modeLabels[request.teachingMode] : "待商量"}</dd></div><div><dt>区县</dt><dd>{request.region?.name ?? "未公开"}</dd></div><div><dt>时间</dt><dd>{request.scheduleText ?? "待商量"}</dd></div></dl>
                  <div className="directory-card__footer"><span>不展示学生私密备注</span><Link className="text-link" href={`/requests/${request.id}`}>查看完整需求 →</Link></div>
                </div>
              </article>
            ))}</div>
          ) : <EmptyState title="这一圈暂时没有新需求" description="可以放宽地区、预算或上课方式；家长发布后会出现在这里。" action={<Link className="button button--outline" href="/requests">查看全部需求</Link>} />}
          <Pagination currentPage={result.page} totalPages={Math.ceil(result.total / result.pageSize)} getHref={(page) => href(raw, page)} />
        </section>
      </div>
    </main>
  );
}
