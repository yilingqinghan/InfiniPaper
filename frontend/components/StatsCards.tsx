import React from "react";
import { motion } from "framer-motion";
import { FileText, Users, Tags, FileDown } from "lucide-react";

export type StatsData = {
  papers: number;
  authors: number;
  tags: number;
  withPDF: number;
};

export default function StatsCards({
  loading,
  stats,
}: {
  loading: boolean;
  stats: StatsData;
}) {
  const items = [
    { k: "papers", label: "论文总数", icon: FileText },
    { k: "authors", label: "作者人数", icon: Users },
    { k: "tags", label: "标签数", icon: Tags },
    { k: "withPDF", label: "PDF 可用", icon: FileDown },
  ] as const;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <motion.div
            key={it.k}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * i }}
            className="rounded-2xl border bg-white p-4"
          >
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Icon className="w-4 h-4" />
              {it.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {loading ? "…" : (stats as any)[it.k]}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
