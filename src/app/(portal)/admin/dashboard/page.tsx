import Link from "next/link";

import { AuditTimeline } from "@/components/admin/audit-timeline";
import { getAuthenticatedAdmin } from "@/features/moderation/admin-page-auth";
import { adminReadService } from "@/features/moderation/admin-read-server";

import { AdminPageHeader, formatAdminDate } from "../admin-page-ui";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminDashboardPage() {
  const actor = await getAuthenticatedAdmin();
  const data = await adminReadService.getDashboard(actor);
  return <main className="admin-page" id="main-content">
    <AdminPageHeader kicker="值班总览 / TODAY" title="治理工作台" description="先看积压，再处理队列。这里不做装饰性图表，只留下需要行动的事实。" />
    <section className="admin-ledger" aria-label="待办计数">
      <Link href="/admin/reports"><span>01 / 举报</span><strong>{data.counts.openReports}</strong><p>待处理与审核中</p><small>最早：{formatAdminDate(data.oldest.report)}</small></Link>
      <Link href="/admin/verifications?status=PENDING"><span>02 / 认证</span><strong>{data.counts.pendingVerifications}</strong><p>等待人工核验</p><small>最早：{formatAdminDate(data.oldest.verification)}</small></Link>
    </section>
    <AuditTimeline entries={data.recentAudit} />
  </main>;
}
