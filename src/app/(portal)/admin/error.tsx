"use client";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="admin-state" id="main-content"><span aria-hidden="true">!</span><h1>治理数据暂时不可用</h1><p>没有展示错误详情，以避免把内部数据带到页面。</p><button type="button" onClick={reset}>重新加载</button></main>; }
