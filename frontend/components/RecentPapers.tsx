import React from "react";
import { motion } from "framer-motion";
import PaperCard from "@/components/PaperCard";

export default function RecentPapers({
  papers,
  loading,
  onReload,
}: {
  papers: any[];
  loading: boolean;
  onReload?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">最近导入</h2>
        <button
          onClick={onReload}
          className="text-xs px-2 py-1 rounded-lg border hover:bg-gray-50"
        >
          刷新
        </button>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border p-4 bg-white">
              <div className="h-4 w-2/3 bg-gray-100 rounded" />
              <div className="mt-2 h-3 w-1/2 bg-gray-100 rounded" />
              <div className="mt-3 h-20 w-full bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : papers.length === 0 ? (
        <div className="text-sm text-gray-500">暂无论文，先上传或导入一批 PDF。</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {papers.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <PaperCard paper={p} onOpen={() => {}} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
