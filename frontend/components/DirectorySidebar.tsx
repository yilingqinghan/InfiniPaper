import React from "react";
import { motion } from "framer-motion";
import { FolderTree, Tag, Star, FileText, Clock, FileSearch, Link } from "lucide-react";

type TagItem = { id: number; name: string };

export default function DirectorySidebar({
  papers,
  onSelect,
  className = "",
}: {
  papers: any[];
  onSelect?: (payload: { type: "all" | "recent" | "withpdf" | "withoutpdf" | "favorite" | "tag"; value?: any }) => void;
  className?: string;
}) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
  const [tags, setTags] = React.useState<TagItem[]>([]);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${apiBase}/api/v1/tags/`);
        if (!r.ok) return;
        const data = await r.json();
        setTags(Array.isArray(data) ? data : []);
      } catch {}
    })();
  }, [apiBase]);

  const countWithPDF = papers.filter((p) => !!p.pdf_url).length;

  return (
    <aside className={`${className} sticky top-20`}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border bg-white p-4"
      >
        <div className="text-xs font-medium text-gray-600 flex items-center gap-2 mb-2">
          <FolderTree className="w-4 h-4" />
          目录/视图
        </div>
        <ul className="space-y-1">
          <li>
            <button
              onClick={() => onSelect?.({ type: "all" })}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-2"
            >
              <FileText className="w-4 h-4 text-gray-500" />
              全部（{papers.length}）
            </button>
          </li>
          <li>
            <button
              onClick={() => onSelect?.({ type: "recent" })}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-2"
            >
              <Clock className="w-4 h-4 text-gray-500" />
              近期导入
            </button>
          </li>
          <li>
            <button
              onClick={() => onSelect?.({ type: "withpdf" })}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-2"
            >
              <Link className="w-4 h-4 text-gray-500" />
              PDF 可用（{countWithPDF}）
            </button>
          </li>
          <li>
            <button
              onClick={() => onSelect?.({ type: "withoutpdf" })}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-2"
            >
              <FileSearch className="w-4 h-4 text-gray-500" />
              无 PDF
            </button>
          </li>
          <li>
            <button
              onClick={() => onSelect?.({ type: "favorite" })}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-2"
            >
              <Star className="w-4 h-4 text-amber-500" />
              收藏夹
            </button>
          </li>
        </ul>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-2xl border bg-white p-4 mt-3"
      >
        <div className="text-xs font-medium text-gray-600 flex items-center gap-2 mb-2">
          <Tag className="w-4 h-4" />
          标签
        </div>
        {tags.length === 0 ? (
          <div className="text-xs text-gray-500">暂无标签</div>
        ) : (
          <ul className="space-y-1 max-h-[280px] overflow-auto pr-1">
            {tags.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onSelect?.({ type: "tag", value: t })}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 truncate"
                  title={`#${t.name}`}
                >
                  #{t.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </aside>
  );
}
