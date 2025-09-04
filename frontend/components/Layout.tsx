import Link from "next/link";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <nav className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b">
        <div className="container py-3 flex items-center justify-between">
          <Link href="/" className="font-bold text-lg tracking-tight">InfiniPaper</Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/search" className="hover:underline">搜索</Link>
            <Link href="/papers" className="hover:underline">论文</Link>
            <Link href="/import" className="hover:underline">导入</Link>
            <Link href="/tags" className="hover:underline">标签</Link>
            <Link href="/quality" className="hover:underline">质量</Link>
            <Link href="/cards" className="hover:underline">卡片</Link>
          </div>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
