import { AdminActionDialog } from "@/components/admin/admin-action-dialog";
import { ModerationTable } from "@/components/admin/moderation-table";
import { getAuthenticatedAdmin } from "@/features/moderation/admin-page-auth";
import { parseAdminListQuery } from "@/features/moderation/admin-read-service";
import { adminReadService } from "@/features/moderation/admin-read-server";

import { AdminPageHeader, AdminPagination, AdminStatus, FilterBar, formatAdminDate, targetLabel } from "../admin-page-ui";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = parseAdminListQuery("reports", await searchParams);
  const data = await adminReadService.listReports(await getAuthenticatedAdmin(), filter);
  const columns = [
    { key: "targetType" as const, label: "目标", render: (row: typeof data.items[number]) => targetLabel[row.targetType] ?? row.targetType },
    { key: "reason" as const, label: "举报摘要", render: (row: typeof data.items[number]) => <div className="admin-report-copy"><strong>{row.reason}</strong>{row.details ? <span>{row.details}</span> : null}{Object.values(row.snapshot).length ? <small>现场快照：{Object.values(row.snapshot).join(" · ")}</small> : null}</div> },
    { key: "reporter" as const, label: "双方", render: (row: typeof data.items[number]) => <span>{row.reporter} → {row.subject}</span> },
    { key: "status" as const, label: "状态", render: (row: typeof data.items[number]) => <AdminStatus value={row.status} /> },
    { key: "createdAt" as const, label: "提交时间", render: (row: typeof data.items[number]) => <time dateTime={row.createdAt}>{formatAdminDate(row.createdAt)}</time> },
  ];
  const filtered = !!filter.status || !!filter.type;
  const reportActions = (row: typeof data.items[number]) => {
    if (row.status !== "PENDING" && row.status !== "REVIEWING") return <span>已归档</span>;
    const canTakedown = ["TEACHER_PROFILE", "TUTORING_REQUEST", "MESSAGE"].includes(row.targetType);
    return <>
      {row.status === "PENDING" ? <AdminActionDialog targetId={row.id} expectedUpdatedAt={row.updatedAt} action={{ kind: "report", decision: "START_REVIEW" }} title="开始审核" triggerLabel="接手" /> : null}
      <AdminActionDialog targetId={row.id} expectedUpdatedAt={row.updatedAt} action={{ kind: "report", decision: "DISMISS", resolutionAction: "NONE" }} title="驳回举报" triggerLabel="驳回" />
      <AdminActionDialog targetId={row.id} expectedUpdatedAt={row.updatedAt} action={{ kind: "report", decision: "RESOLVE", resolutionAction: "NONE" }} title="确认违规" triggerLabel="仅结案" />
      {canTakedown ? <AdminActionDialog targetId={row.id} expectedUpdatedAt={row.updatedAt} action={{ kind: "report", decision: "RESOLVE", resolutionAction: "CONTENT_TAKEDOWN" }} title="下架并结案" triggerLabel="下架" /> : null}
      {row.canSuspendAccount ? <AdminActionDialog targetId={row.id} expectedUpdatedAt={row.updatedAt} action={{ kind: "report", decision: "RESOLVE", resolutionAction: "ACCOUNT_SUSPENSION" }} title="停用并结案" triggerLabel="停用账号" reasonOptions={["虚假信息", "骚扰", "收费诈骗", "其他"]} /> : null}
    </>;
  };
  return <main className="admin-page" id="main-content"><AdminPageHeader kicker="举报治理 / REPORTS" title="举报队列" description="现场快照只保留当时可见的必要信息；账号内部标识不在此处展示。" />
    <FilterBar><label>处理状态<select name="status" defaultValue={filter.status ?? ""}><option value="">全部</option><option value="PENDING">待处理</option><option value="REVIEWING">审核中</option><option value="RESOLVED">已解决</option><option value="DISMISSED">已驳回</option></select></label><label>目标类型<select name="type" defaultValue={filter.type ?? ""}><option value="">全部</option>{Object.entries(targetLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></FilterBar>
    <ModerationTable caption="举报治理列表" columns={columns} rows={data.items} emptyKind={filtered ? "filter" : "queue"} renderActions={reportActions} />
    <AdminPagination page={data.page} totalPages={data.totalPages} path="/admin/reports" query={{ status: filter.status, type: filter.type }} />
  </main>;
}
