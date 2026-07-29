import Link from "next/link";

import { calculateProfileCompletion, type TeacherProfile } from "@/features/teachers/service";

const statusLabels = {
  DRAFT: "草稿",
  PENDING_REVIEW: "审核中",
  PUBLISHED: "已发布",
  REJECTED: "需修改",
} as const;

export function TeacherDashboard({
  profile,
  username,
}: {
  profile: TeacherProfile | null;
  username: string;
}) {
  const completion = profile
    ? calculateProfileCompletion(profile)
    : { percentage: 0, missingItems: ["公开昵称", "公开标题", "身份类型", "个人简介", "教学年限", "授课价格", "授课科目", "主授课地区"] };
  return (
    <main className="teacher-dashboard portal-page" id="main-content">
      <section className="teacher-dashboard__hero">
        <div>
          <p className="eyebrow">教师工作台</p>
          <h1>早上好，{profile?.publicNickname || username}</h1>
          <p>先把你的教学名片整理清楚，合适的家庭才更容易找到你。</p>
        </div>
        <Link className="button button--primary" href="/teacher/profile">管理教师资料</Link>
      </section>

      <section className="teacher-dashboard__overview" aria-label="资料概况">
        <article className="completion-card">
          <div className="completion-card__dial" style={{ "--completion": `${completion.percentage * 3.6}deg` } as React.CSSProperties}>
            <strong>{completion.percentage}%</strong><span>资料完成度</span>
          </div>
          <div>
            <p className="eyebrow">公开准备度</p>
            <h2>{completion.missingItems.length ? "还差一点，就能完整亮相" : "资料已经完整"}</h2>
            <p>{completion.missingItems.length ? `待完善：${completion.missingItems.join("、")}` : "你可以随时更新资料并重新发布。"}</p>
          </div>
        </article>
        <article className="dashboard-summary-card">
          <p className="eyebrow">当前状态</p>
          <strong className={`profile-status profile-status--${profile?.status.toLowerCase() ?? "draft"}`}>{profile ? statusLabels[profile.status] : "尚未创建"}</strong>
          <dl>
            <div><dt>主要地区</dt><dd>{profile?.primaryRegion?.name ?? "待选择"}</dd></div>
            <div><dt>额外地区</dt><dd>{profile?.extraRegions.map(({ name }) => name).join("、") || "暂无"}</dd></div>
          </dl>
        </article>
      </section>

      <section className="teacher-dashboard__future" aria-label="业务动态">
        <article className="future-card">
          <span aria-hidden="true">招</span>
          <div><p className="eyebrow">近期招呼</p><h2>功能即将开放</h2><p>后续家长发来的招呼会集中显示在这里。</p></div>
        </article>
        <article className="future-card">
          <span aria-hidden="true">配</span>
          <div><p className="eyebrow">匹配需求</p><h2>功能即将开放</h2><p>后续适合你的家教需求会集中显示在这里。</p></div>
        </article>
      </section>
    </main>
  );
}
