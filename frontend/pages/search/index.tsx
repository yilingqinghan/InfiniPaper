import { useEffect, useState } from "react";
import { apiGet } from "@/utils/api";
import PaperCard from "@/components/PaperCard";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"kw"|"sem">("sem");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      const path = mode === "sem" ? `/api/v1/search/semantic?q=${encodeURIComponent(q)}` : `/api/v1/search?q=${encodeURIComponent(q)}`;
      const data = await apiGet(path);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="container py-6">
      <h1 className="text-2xl font-semibold mb-4">搜索</h1>
      <div className="flex gap-2 flex-wrap items-center">
        <input className="flex-1 border rounded-xl px-3 py-2" placeholder="输入关键词或一句话进行语义搜索..." value={q} onChange={(e)=>setQ(e.target.value)} onKeyDown={e=> e.key==='Enter' && run()} />
        <select className="border rounded-xl px-3 py-2" value={mode} onChange={(e)=> setMode(e.target.value as any)}>
          <option value="sem">语义</option>
          <option value="kw">关键词</option>
        </select>
        <button onClick={run} className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50">{loading? "搜索中..." : "搜索"}</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {items.map((p:any)=> <PaperCard key={p.id} paper={p} />)}
      </div>
    </div>
  );
}
