import { AdminActionDialog } from "@/components/admin/admin-action-dialog";
import { ModerationTable } from "@/components/admin/moderation-table";
import { getAuthenticatedAdmin } from "@/features/moderation/admin-page-auth";
import { parseAdminListQuery } from "@/features/moderation/admin-read-service";
import { adminReadService } from "@/features/moderation/admin-read-server";

import { AdminPageHeader, AdminPagination, AdminStatus, FilterBar, formatAdminDate, roleLabel } from "../admin-page-ui";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = parseAdminListQuery("users", await searchParams);
  const actor = await getAuthenticatedAdmin();
  const data = await adminReadService.listUsers(actor, filter);
  const columns = [
    { key: "username" as const, label: "用户名" },
    { key: "role" as const, label: "身份", render: (row: typeof data.items[number]) => roleLabel[row.role] ?? row.role },
    { key: "status" as const, label: "状态", render: (row: typeof data.items[number]) => <AdminStatus value={row.status} /> },
    { key: "createdAt" as const, label: "注册时间", render: (row: typeof data.items[number]) => <time dateTime={row.createdAt}>{formatAdminDate(row.createdAt)}</time> },
  ];
  const filtered = !!filter.status || !!filter.role;
  return <main className="admin-page" id="main-content"><AdminPageHeader kicker="账号治理 / USERS" title="用户名册" description="默认只显示治理所需字段；邮箱与内部资料标识不进入列表。" />
    <FilterBar><label>账号状态<select name="status" defaultValue={filter.status ?? ""}><option value="">全部</option><option value="ACTIVE">正常</option><option value="SUSPENDED">已停用</option><option value="DISABLED">已禁用</option></select></label><label>身份<select name="role" defaultValue={filter.role ?? ""}><option value="">全部</option><option value="TEACHER">老师</option><option value="PARENT">家长</option><option value="ADMIN">管理员</option></select></label></FilterBar>
    <ModerationTable caption="用户治理列表" columns={columns} rows={data.items} emptyKind={filtered ? "filter" : "queue"} renderActions={(row) => row.id === actor.id ? <span>当前账号</span> : <AdminActionDialog targetId={row.id} expectedUpdatedAt={row.updatedAt} action={{ kind: "user", status: row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }} title={row.status === "ACTIVE" ? "停用用户" : "恢复用户"} triggerLabel={row.status === "ACTIVE" ? "停用" : "恢复"} reasonOptions={row.status === "ACTIVE" ? ["虚假信息", "骚扰", "收费诈骗", "其他"] : ["申诉通过", "误停用", "人工复核", "其他"]} />} />
    <AdminPagination page={data.page} totalPages={data.totalPages} path="/admin/users" query={{ status: filter.status, role: filter.role }} />
  </main>;
}
