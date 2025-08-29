import React from "react";
import PaperCard from "@/components/PaperCard";

type PaperItem = any;

export default function PapersPage() {
  const [list, setList] = React.useState<PaperItem[]>([]);
  const [q, setQ] = React.useState<string>("");

  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

  const load = React.useCallback(async () => {
    try {
      const url = new URL(`${apiBase}/api/v1/papers/`);
      url.searchParams.set("dedup", "true");
      if (q.trim()) url.searchParams.set("q", q.trim());

      // ---- Debug：请求前打印 URL
      // eslint-disable-next-line no-console
      console.log("[PapersPage] GET", url.toString());

      const r = await fetch(url.toString());
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      // ---- Debug：返回 JSON 打印一份
      // eslint-disable-next-line no-console
      console.log("[PapersPage] response sample", data?.[0]);

      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[PapersPage] load error", e);
      setList([]);
    }
  }, [apiBase, q]);

  React.useEffect(() => {
    load();
  }, [load]);

  const onDelete = async (id: number) => {
    if (!confirm("确定删除这篇论文吗？")) return;
    try {
      const r = await fetch(`${apiBase}/api/v1/papers/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[PapersPage] delete error", e);
      alert("删除失败");
    }
  };

  const onOpen = (id: number) => {
    // 你原有的打开逻辑（路由到详情或者右侧抽屉）
    // 这里只打一条日志，确保能点击
    // eslint-disable-next-line no-console
    console.log("[PapersPage] open", id);
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索标题/DOI/venue"
          className="w-full px-3 py-2 border rounded-md"
        />
        <button
          onClick={load}
          className="px-3 py-2 border rounded-md hover:bg-gray-50"
        >
          搜索
        </button>
      </div>

      <div className="grid gap-3">
        {list.length === 0 ? (
          <div className="text-sm text-gray-500">暂无数据</div>
        ) : (
          list.map((p) => (
            <div key={p.id} className="relative group">
              <PaperCard
                paper={p}
                onOpen={onOpen}
              />
              <button
                onClick={() => onDelete(p.id)}
                className="absolute top-3 right-3 text-xs px-2 py-1 rounded-md border bg-white/70 opacity-0 group-hover:opacity-100 transition"
              >
                删除
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
