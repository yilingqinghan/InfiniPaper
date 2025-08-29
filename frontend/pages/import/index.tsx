import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/utils/api";
import PaperCard from "@/components/PaperCard";

type Paper = any;

export default function ImportPage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Paper[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);

  async function search() {
    setLoading(true);
    try {
      const data = await apiGet(`/api/v1/import/openalex?q=${encodeURIComponent(q)}`);
      setResults(data);
    } finally {
      setLoading(false);
    }
  }

  async function doImport() {
    const ids = Object.entries(selected).filter(([id, v]) => v).map(([id]) => id);
    if (!ids.length) return;
    setImporting(true);
    try {
      await apiPost("/api/v1/import/openalex/import", ids);
      alert("导入完成");
      setSelected({});
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="container py-6">
      <h1 className="text-2xl font-semibold mb-4">从 OpenAlex 导入</h1>
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded-xl px-3 py-2"
          placeholder="关键词 / 作者 / 机构 / 主题"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button onClick={search} className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50">{loading ? "搜索中..." : "搜索"}</button>
        <button onClick={doImport} disabled={importing || Object.values(selected).every(v=>!v)} className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50">{importing ? "导入中..." : "导入选中"}</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {results.map((p: any) => (
          <div key={p.title} className="relative">
            <label className="absolute top-2 left-2 bg-white/90 rounded-md border px-2 py-1 text-xs flex items-center gap-2">
              <input type="checkbox" checked={!!selected[p.doi || p.title]} onChange={(e)=> setSelected(s => ({...s, [p.doi || p.title]: e.target.checked}))} />
              选中
            </label>
            <PaperCard paper={p} />
          </div>
        ))}
      </div>
    </div>
  );
}
