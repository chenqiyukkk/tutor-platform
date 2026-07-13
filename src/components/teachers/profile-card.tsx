import type { TeacherProfile } from "@/features/teachers/service";

const identityLabels = {
  UNIVERSITY_STUDENT: "在校大学生",
  FULL_TIME_TEACHER: "全职教师",
  OTHER: "其他教育从业者",
} as const;

function rateLabel(profile: TeacherProfile) {
  if (profile.rateMinCents === null || profile.rateMaxCents === null) return "价格面议";
  const minimum = profile.rateMinCents / 100;
  const maximum = profile.rateMaxCents / 100;
  return minimum === maximum
    ? `${minimum} 元/小时`
    : `${minimum}–${maximum} 元/小时`;
}

export function ProfileCard({ profile }: { profile: TeacherProfile }) {
  const nickname = profile.publicNickname.trim() || "未填写公开昵称";
  return (
    <article className="teacher-profile-card" aria-label="教师公开资料预览">
      <div className="teacher-profile-card__head">
        <div className="teacher-profile-card__avatar" aria-hidden="true">{nickname.slice(0, 1)}</div>
        <div>
          <p className="eyebrow">公开资料</p>
          <h2>{nickname}</h2>
          <p>{profile.identityType ? identityLabels[profile.identityType] : "身份待完善"}</p>
        </div>
        {profile.online ? <span className="profile-status profile-status--online">支持线上</span> : null}
      </div>
      <p className="teacher-profile-card__bio">{profile.bio || "这位老师还没有填写个人简介。"}</p>
      <dl className="teacher-profile-card__facts">
        <div><dt>教学经验</dt><dd>{profile.yearsExperience === null ? "待完善" : `${profile.yearsExperience} 年`}</dd></div>
        <div><dt>授课价格</dt><dd>{rateLabel(profile)}</dd></div>
        <div><dt>授课科目</dt><dd>{profile.subjects.map(({ name }) => name).join("、") || "待完善"}</dd></div>
        <div>
          <dt>主要地区</dt>
          <dd>{profile.primaryRegion?.name || "待完善"}</dd>
        </div>
      </dl>
      {profile.extraRegions.length ? (
        <p className="teacher-profile-card__areas">也可前往：{profile.extraRegions.map(({ name }) => name).join("、")}</p>
      ) : null}
    </article>
  );
}
