import React from "react";
import { motion } from "framer-motion";
import { List, Rows } from "lucide-react";
import PaperCard from "@/components/PaperCard";

export default function RecentPapers({
  papers,
  loading,
  onReload,
  onOpen,
}: {
  papers: any[];
  loading?: boolean;
  onReload?: () => void;
  onOpen?: (id: number) => void;
}) {
  const [dense, setDense] = React.useState(false);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">最近导入</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDense((s) => !s)}
            className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50 flex items-center gap-1"
            title={dense ? "卡片模式" : "密集模式"}
          >
            {dense ? <Rows className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
            {dense ? "卡片" : "密集"}
          </button>
        </div>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-gray-400">加载中…</div>
        ) : papers.length === 0 ? (
          <div className="text-sm text-gray-400">暂无数据</div>
        ) : dense ? (
          <ul className="divide-y">
            {papers.map((p) => (
              <li key={p.id} className="py-2 text-sm flex items-center justify-between gap-4">
                <button
                  className="text-left hover:underline truncate"
                  onClick={() => onOpen?.(p.id)}
                  title={p.title}
                >
                  {p.title}
                </button>
                <div className="shrink-0 text-xs text-gray-500">
                  {(p.venue || "未知 venue")} · {(p.year || "年份未知")}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {papers.map((p) => (
              <PaperCard key={p.id} paper={p} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
