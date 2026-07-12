import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export function PublicHeader() {
  return (
    <>
      <Link className="skip-link" href="#main-content">
        跳到主要内容
      </Link>
      <header className="public-header">
        <div className="site-container public-header__inner">
          <Logo />
          <nav className="public-header__nav" aria-label="公共导航">
            <Link className="header-link" href="#neighborhood">
              地区圈子
            </Link>
            <Link className="header-link" href="#safety">
              安全保障
            </Link>
            <Link className="header-cta header-cta--teacher" href="/teacher">
              我是老师
            </Link>
            <Link className="header-cta header-cta--parent" href="/parent">
              我是家长
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}
