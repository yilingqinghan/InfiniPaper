import React from "react";

export default function PaperCard({ paper, onOpen }: { paper: any; onOpen?: (id: number) => void }) {
  const tags: string[] = (paper.tags || []).map((t: any) => t.name || t);
  const authors: { name?: string; affiliation?: string }[] = paper.authors || [];
  const authorLine = authors.map(a => a?.name).filter(Boolean).slice(0, 6).join(", ");
  const affSet = new Set<string>();
  authors.forEach(a => { if (a?.affiliation) affSet.add(a.affiliation); });
  const affLine = Array.from(affSet).slice(0, 3).join(" · ");

  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 hover:shadow-md transition">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold leading-snug line-clamp-2">{paper.title}</div>
          <div className="text-xs text-gray-500 mt-1">
            {paper.venue || "未知 venue"} · {paper.year || "年份未知"}
            {paper.doi ? ` · DOI: ${paper.doi}` : ""}
          </div>
          {authorLine && (
            <div className="text-xs text-gray-700 mt-1 line-clamp-1">{authorLine}</div>
          )}
          {affLine && (
            <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{affLine}</div>
          )}
        </div>
        <div className="flex-shrink-0 flex gap-2">
          {paper.url && (
            <a href={paper.url} target="_blank" className="text-sm px-2 py-1 rounded-md border hover:bg-gray-50">
              原文
            </a>
          )}
          <button onClick={() => onOpen?.(paper.id)} className="text-sm px-2 py-1 rounded-md border hover:bg-gray-50">
            详情
          </button>
        </div>
      </div>

      {paper.abstract && <p className="text-sm mt-3 line-clamp-3 text-gray-700">{paper.abstract}</p>}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {tags.map((t) => (
            <span key={t} className="inline-block text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-1">#{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
