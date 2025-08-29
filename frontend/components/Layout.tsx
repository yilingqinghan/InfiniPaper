import Link from "next/link";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="bg-white border-b">
        <div className="container py-3 flex items-center justify-between">
          <Link href="/" className="font-bold">InfiniPaper</Link>
          <div className="space-x-4 text-sm">
            <Link href="/search">搜索</Link>
            <Link href="/papers">论文</Link>
            <Link href="/tags">标签</Link>
            <Link href="/network">网络</Link>
            <Link href="/trends">趋势</Link>
          </div>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}