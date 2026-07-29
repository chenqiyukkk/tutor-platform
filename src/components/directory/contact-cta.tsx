import Link from "next/link";

export function DirectoryContactCta({ kind, isLoggedIn = false }: { kind: "teacher" | "request"; isLoggedIn?: boolean }) {
  const teacher = kind === "teacher";
  return (
    <aside className="directory-contact" aria-label="联系提示">
      <p className="eyebrow">免费双向选择</p>
      <h2>{teacher ? "觉得这位老师合适？" : "这份需求与你的安排合拍？"}</h2>
      <p>登录后可在平台内表达联系意向。平台不收信息费，也不会公开双方联系方式。</p>
      {isLoggedIn ? (
        <p className="directory-contact__coming">站内打招呼功能即将开放</p>
      ) : (
        <Link className="button button--primary" href={teacher ? "/parent/login" : "/teacher/login"}>
          {teacher ? "家长登录后联系老师" : "老师登录后回应需求"}
        </Link>
      )}
      <small>{isLoggedIn ? "无需支付信息费，请留意后续开放通知。" : "站内打招呼功能将在下一阶段开放。"}</small>
    </aside>
  );
}
