import Link from "next/link";

export default function Home() {
  return (
    <div className="container py-10 space-y-6">
      <h1 className="text-3xl font-bold">InfiniPaper</h1>
      <p>你的自建学术文献数据库。先从搜索或导入开始。</p>
      <div className="space-x-4">
        <Link href="/search" className="px-4 py-2 bg-blue-600 text-white rounded-md">搜索</Link>
        <Link href="/papers" className="px-4 py-2 bg-gray-800 text-white rounded-md">论文列表</Link>
      </div>
    </div>
  );
}