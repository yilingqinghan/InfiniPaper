
import React, { useMemo, useState } from "react";

type Paper = {
  id: number;
  title: string;
  abstract?: string | null;
  venue?: string | null;
  year?: number | null;
  pdf_url?: string | null;
  tag_ids?: number[];
};

function resolveApiBase() {
  // Prefer explicit env. If absent, try to infer (dev: localhost:3000 -> 127.0.0.1:8000).
  const env = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (env && env.trim()) return env;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    // Frontend常见为 localhost:3000，而后端默认 127.0.0.1:8000
    if ((hostname === "localhost" || hostname === "127.0.0.1") && protocol.startsWith("http")) {
      return "http://127.0.0.1:8000";
    }
    // 生产下走同源 8000 端口
    return `${protocol}//${hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
}

export default function PaperDetail({ paper }: { paper: Paper }) {
  const apiBase = useMemo(() => resolveApiBase(), []);
  const [tagsRaw, setTagsRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function saveTags() {
    setSaving(true); setErr(null);
    try {
      const raw = tagsRaw || "";
      const tags = raw.split(",").map(s => s.trim()).filter(Boolean);
      const res = await fetch(`${apiBase}/api/v1/papers/${paper.id}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      alert("已更新标签");
      setTagsRaw("");
    } catch (e: any) {
      setErr(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{paper.title}</h1>
        <p className="text-gray-600 mt-1">{paper.venue || "未知 venue"} · {paper.year ?? "年份未知"}</p>
      </div>

      {paper.abstract && (
        <div className="rounded-lg bg-gray-50 p-4 leading-relaxed">{paper.abstract}</div>
      )}

      {/* 标签编辑 */}
      <div className="rounded-lg border p-4">
        <div className="text-sm text-gray-500 mb-2">标签（逗号分隔）</div>
        <div className="flex gap-2">
          <input
            value={tagsRaw}
            onChange={(e)=>setTagsRaw(e.target.value)}
            className="flex-1 border rounded px-3 py-2"
            placeholder="如：Compiler, Register Allocation, GPU"
          />
          <button
            disabled={saving}
            onClick={saveTags}
            className={"px-4 py-2 rounded text-white " + (saving ? "bg-gray-400" : "bg-gray-800 hover:bg-gray-700")}
          >
            {saving ? "保存中..." : "更新标签"}
          </button>
        </div>
        {err && <div className="text-sm text-red-600 mt-2">错误：{err}</div>}
      </div>

      <div className="mt-2 flex gap-3">
        {paper.pdf_url && (
          <a
            className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300 transition"
            href={(paper.pdf_url || "").startsWith("http") ? paper.pdf_url : `${apiBase}${paper.pdf_url}`}
            target="_blank"
          >
            PDF: 打开原文
          </a>
        )}
        <button
          onClick={async () => {
            if (!confirm("确定删除这篇论文吗？此操作不可恢复。")) return;
            const res = await fetch(`${apiBase}/api/v1/papers/${paper.id}`, { method: "DELETE" });
            if (!res.ok) { alert("删除失败"); return; }
            window.location.href = "/papers";
          }}
          className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-500 transition"
        >
          删除
        </button>
      </div>
    </div>
  );
}
