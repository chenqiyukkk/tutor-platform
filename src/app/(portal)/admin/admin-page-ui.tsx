import Link from "next/link";

export const statusLabel: Record<string, string> = { ACTIVE: "正常", SUSPENDED: "已停用", DISABLED: "已禁用", PENDING: "待处理", REVIEWING: "审核中", RESOLVED: "已解决", DISMISSED: "已驳回", APPROVED: "已通过", REJECTED: "未通过", EXPIRED: "已过期" };
export const roleLabel: Record<string, string> = { TEACHER: "老师", PARENT: "家长", ADMIN: "管理员" };
export const targetLabel: Record<string, string> = { ACCOUNT: "账号", TEACHER_PROFILE: "教师资料", TUTORING_REQUEST: "家教需求", GREETING: "往来卡", CONVERSATION: "会话", MESSAGE: "消息" };
export const verificationLabel: Record<string, string> = { STUDENT_STATUS: "在读身份", EDUCATION: "学历", TEACHER_QUALIFICATION: "教师资格" };

export function AdminPageHeader({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return <><header className="admin-page-header"><p className="eyebrow">{kicker}</p><h1>{title}</h1><p>{description}</p></header><h2 className="admin-result-announcement" id="admin-action-result" tabIndex={-1} aria-live="polite" /></>;
}

export function AdminPagination({ page, totalPages, path, query }: { page: number; totalPages: number; path: string; query: Record<string, string | undefined> }) {
  const href = (next: number) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (value) params.set(key, value); params.set("page", String(next)); return `${path}?${params}`; };
  return <nav className="admin-pagination" aria-label="分页"><span>第 {page} / {totalPages} 页</span>{page > 1 ? <Link href={href(page - 1)}>上一页</Link> : <span aria-disabled="true">上一页</span>}{page < totalPages ? <Link href={href(page + 1)}>下一页</Link> : <span aria-disabled="true">下一页</span>}</nav>;
}

export function FilterBar({ children }: { children: React.ReactNode }) { return <form className="admin-filters" method="get">{children}<button type="submit">筛选</button></form>; }
export function AdminStatus({ value }: { value: string }) { return <span className={`admin-status admin-status--${value.toLowerCase()}`}>{statusLabel[value] ?? value}</span>; }
export function formatAdminDate(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "暂无"; }
