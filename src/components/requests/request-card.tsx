import type { TutoringRequestDto } from "@/features/requests/service";

const statusLabels = { DRAFT: "草稿", PUBLISHED: "招募中", CLOSED: "已关闭" } as const;
const modeLabels = { OFFLINE: "线下", ONLINE: "线上", BOTH: "线上 / 线下均可" } as const;
const gradeLabels: Record<string, string> = {
  GRADE_1: "一年级", GRADE_2: "二年级", GRADE_3: "三年级", GRADE_4: "四年级", GRADE_5: "五年级", GRADE_6: "六年级",
  GRADE_7: "初一", GRADE_8: "初二", GRADE_9: "初三", GRADE_10: "高一", GRADE_11: "高二", GRADE_12: "高三", OTHER: "其他阶段",
};

export function RequestCard({ request, compact = false }: { request: TutoringRequestDto; compact?: boolean }) {
  const budget = request.budgetMinCents !== null && request.budgetMaxCents !== null
    ? `¥${request.budgetMinCents / 100}–${request.budgetMaxCents / 100}/小时`
    : "预算待补充";
  return (
    <article className={`parent-request-card ${compact ? "parent-request-card--compact" : ""}`.trim()}>
      <header>
        <div>
          <p className="eyebrow">{request.student ? `${request.student.publicAlias} · ${gradeLabels[request.student.grade] ?? "学习阶段"}` : "学生待选择"}</p>
          <h2>{request.subjects.length ? request.subjects.map(({ name }) => name).join("、") : "科目待选择"}家教</h2>
        </div>
        <span className={`request-status request-status--${request.status.toLowerCase()}`}>{statusLabels[request.status]}</span>
      </header>
      <dl className="parent-request-card__facts">
        <div><dt>方式</dt><dd>{request.teachingMode ? modeLabels[request.teachingMode] : "待补充"}</dd></div>
        <div><dt>预算</dt><dd>{budget}</dd></div>
        <div><dt>区域</dt><dd>{request.region?.name ?? "待选择区县"}{request.publicLocationNote ? ` · ${request.publicLocationNote}` : ""}</dd></div>
        <div><dt>时间</dt><dd>{request.scheduleText ?? "待补充"}</dd></div>
      </dl>
      {!compact && request.description ? <p className="parent-request-card__description">{request.description}</p> : null}
    </article>
  );
}
