const actionLabels: Record<string, string> = { REPORT_DECISION: "举报处理", USER_STATUS: "用户状态变更", VERIFICATION_DECISION: "认证审核", VERIFICATION_EVIDENCE_VIEW: "认证证据调阅" };
const statusLabels: Record<string, string> = { RESOLVED: "已解决", DISMISSED: "已驳回", REVIEWING: "审核中", SUSPENDED: "已停用", ACTIVE: "正常", APPROVED: "已通过", REJECTED: "未通过" };

type Entry = { id: string; action: string; targetType: string; createdAt: string; result: Record<string, string | null | undefined> };

export function AuditTimeline({ entries }: { entries: readonly Entry[] }) {
  const allowed = ["status", "resolutionAction", "reviewedAt", "updatedAt", "mimeType"];
  return <section className="audit-timeline" aria-labelledby="audit-title"><header><p className="eyebrow">不可变审计</p><h2 id="audit-title">最近治理记录</h2></header>
    {entries.length ? <ol>{entries.map((entry) => <li key={entry.id}><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</time><strong>{actionLabels[entry.action] ?? "治理操作"}</strong><span>{entry.targetType}</span><dl>{allowed.flatMap((key) => {
      const value = entry.result[key]; if (!value) return [];
      return <div key={key}><dt>{key === "status" ? "结果" : key === "resolutionAction" ? "处置" : "记录"}</dt><dd>{statusLabels[value] ?? value}</dd></div>;
    })}</dl></li>)}</ol> : <p>暂无审计记录。</p>}
  </section>;
}
