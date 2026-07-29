import { AdminActionDialog } from "@/components/admin/admin-action-dialog";
import { EvidenceAccessDialog } from "@/components/admin/evidence-access-dialog";
import { ModerationTable } from "@/components/admin/moderation-table";
import { getAuthenticatedAdmin } from "@/features/moderation/admin-page-auth";
import { parseAdminListQuery } from "@/features/moderation/admin-read-service";
import { adminReadService } from "@/features/moderation/admin-read-server";

import { AdminPageHeader, AdminPagination, AdminStatus, FilterBar, formatAdminDate, verificationLabel } from "../admin-page-ui";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminVerificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = parseAdminListQuery("verifications", await searchParams);
  const data = await adminReadService.listVerifications(await getAuthenticatedAdmin(), filter);
  const columns = [
    { key: "applicant" as const, label: "申请人" },
    { key: "type" as const, label: "认证类型", render: (row: typeof data.items[number]) => verificationLabel[row.type] ?? row.type },
    { key: "status" as const, label: "状态", render: (row: typeof data.items[number]) => <AdminStatus value={row.status} /> },
    { key: "submittedAt" as const, label: "提交时间", render: (row: typeof data.items[number]) => <time dateTime={row.submittedAt}>{formatAdminDate(row.submittedAt)}</time> },
  ];
  const filtered = !!filter.status || !!filter.type;
  return <main className="admin-page" id="main-content"><AdminPageHeader kicker="自愿认证 / VERIFICATION" title="认证队列" description="原件不会进入页面或生成缩略图。每次下载都需要主动点击，并重新鉴权、写入审计。" />
    <FilterBar><label>审核状态<select name="status" defaultValue={filter.status ?? ""}><option value="">全部</option><option value="PENDING">待处理</option><option value="APPROVED">已通过</option><option value="REJECTED">未通过</option><option value="EXPIRED">已过期</option></select></label><label>认证类型<select name="type" defaultValue={filter.type ?? ""}><option value="">全部</option>{Object.entries(verificationLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></FilterBar>
    <ModerationTable caption="教师认证审核列表" columns={columns} rows={data.items} emptyKind={filtered ? "filter" : "queue"} renderActions={(row) => <><EvidenceAccessDialog verificationId={row.id} />{row.status === "PENDING" ? <><AdminActionDialog targetId={row.id} expectedUpdatedAt={row.updatedAt} action={{ kind: "verification", decision: "APPROVE" }} title="通过认证" triggerLabel="通过" /><AdminActionDialog targetId={row.id} expectedUpdatedAt={row.updatedAt} action={{ kind: "verification", decision: "REJECT" }} title="拒绝认证" triggerLabel="拒绝" /></> : null}</>} />
    <AdminPagination page={data.page} totalPages={data.totalPages} path="/admin/verifications" query={{ status: filter.status, type: filter.type }} />
  </main>;
}
