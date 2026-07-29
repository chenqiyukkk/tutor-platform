import Link from "next/link";

type LogoProps = {
  className?: string;
};

export function Logo({ className = "" }: LogoProps) {
  return (
    <Link className={`brand-logo ${className}`.trim()} href="/" aria-label="邻师到家首页">
      <span className="brand-logo__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand-logo__text">
        邻师到家
        <small>同一片街区，好老师在身边</small>
      </span>
    </Link>
  );
}
