
import { useEffect, useState } from "react";
import Link from "next/link";

type Paper = {
  id: number;
  title: string;
  venue?: string | null;
  year?: number | null;
};

export default function PapersList() {
  const [data, setData] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
    const res = await fetch(`${apiBase}/api/v1/papers?dedup=true`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-10">加载中...</div>;

  return (
    <div className="container py-8 space-y-4">
      <h1 className="text-3xl font-bold">论文列表</h1>
      {data.map((p) => (
        <div key={p.id} className="rounded-lg border p-4 bg-white">
          <div className="flex items-center justify-between">
            <Link href={`/papers/${p.id}`} className="text-xl font-semibold text-blue-600 hover:underline">
              {p.title}
            </Link>
            <button
              className="px-3 py-1 text-sm bg-red-600 text-white rounded"
              onClick={async () => {
                if (!confirm("确定删除这篇论文吗？")) return;
                const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
                const r = await fetch(`${apiBase}/api/v1/papers/${p.id}`, { method: "DELETE" });
                if (!r.ok) { alert("删除失败"); return; }
                await load();
              }}
            >
              删除
            </button>
          </div>
          <div className="text-gray-600 mt-1">
            {p.venue || "未知 venue"} · {p.year ?? "年份未知"}
          </div>
        </div>
      ))}
    </div>
  );
}
