import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>找到合适的老师，也找到真正需要你的学生</h1>
      <nav aria-label="身份入口">
        <Link href="/teacher">我是老师</Link>
        <Link href="/parent">我是家长</Link>
      </nav>
    </main>
  );
}
