import Link from "next/link";

import { RequestCard } from "@/components/requests/request-card";
import { getAuthenticatedParent } from "@/features/requests/auth";
import { getRequestService } from "@/features/requests/server";
import { toRequestDto } from "@/features/requests/service";

export default async function ParentDashboardPage() {
  const account = await getAuthenticatedParent();
  const [students, requests] = await Promise.all([getRequestService().listStudents(account), getRequestService().listRequests(account)]);
  const published = requests.filter(({ status }) => status === "PUBLISHED").length;
  const drafts = requests.filter(({ status }) => status === "DRAFT").length;
  return <main className="parent-dashboard portal-page" id="main-content"><section className="parent-dashboard__hero"><div><p className="eyebrow">家长工作台</p><h1>把学习需求，写成一份清楚的邀请</h1><p>先用学习昵称保护孩子隐私，再逐步完善时间、地区和预算。</p></div><Link className="button button--secondary" href="/parent/requests/new">新建家教需求</Link></section><section className="parent-stats" aria-label="需求概况"><article><strong>{students.length}</strong><span>学生档案</span></article><article><strong>{published}</strong><span>招募中</span></article><article><strong>{drafts}</strong><span>待完善草稿</span></article></section><div className="parent-dashboard__grid"><section><div className="parent-section-heading"><div><p className="eyebrow">最近需求</p><h2>继续完成下一步</h2></div>{requests.length ? null : <Link href="/parent/requests/new">创建第一条需求 →</Link>}</div><div className="parent-request-list">{requests.length ? requests.slice(0, 3).map((item) => <Link aria-label={`编辑${item.student?.publicAlias ?? "家教"}需求`} href={`/parent/requests/${item.id}/edit`} key={item.id}><RequestCard compact request={toRequestDto(item)} /></Link>) : <div className="parent-empty"><span aria-hidden="true">需</span><h2>暂无家教需求</h2><p>草稿允许先保存不完整信息，准备好后再发布。</p></div>}</div></section><aside className="parent-future"><p className="eyebrow">沟通中心</p><h2>聊天招呼即将开放</h2><p>老师的招呼和后续沟通会集中显示在这里。当前无需反复刷新。</p><span>敬请期待</span></aside></div></main>;
}
