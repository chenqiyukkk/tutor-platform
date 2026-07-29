import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="site-container public-footer__grid">
        <div>
          <Logo className="public-footer__logo" />
          <p className="public-footer__note">
            让真实、透明的家教连接，发生在熟悉的街区里。
          </p>
        </div>
        <nav className="public-footer__nav" aria-label="页脚导航">
          <Link href="/teacher">老师入口</Link>
          <Link href="/parent">家长入口</Link>
          <Link href="#safety">安全说明</Link>
          <Link href="#neighborhood">地区圈子</Link>
        </nav>
        <p className="public-footer__legal">
          © {new Date().getFullYear()} 邻师到家
          <br />
          平台不收取信息费
        </p>
      </div>
    </footer>
  );
}
