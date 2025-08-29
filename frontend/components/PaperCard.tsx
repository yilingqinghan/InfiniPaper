import React from "react";

type AuthorOut = {
  id?: number;
  name?: string;
  orcid?: string;
  affiliation?: string;
};

type PaperItem = {
  id: number;
  title?: string;
  abstract?: string;
  year?: number;
  doi?: string;
  venue?: string;
  pdf_url?: string;
  url?: string; // 外部落地页（OpenAlex/Crossref）
  tag_ids?: number[];
  author_ids?: number[];
  authors?: AuthorOut[];
  tags?: { id: number; name: string }[];
};

export default function PaperCard({
  paper,
  onOpen,
}: {
  paper: PaperItem;
  onOpen?: (id: number) => void;
}) {
  // ---- Debug：每张卡都打一条日志，确保拿到了 authors ----
  React.useEffect(() => {
    // 只打印一次
    // eslint-disable-next-line no-console
    console.log("[PaperCard] paper#", paper.id, {
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue,
      year: paper.year,
      doi: paper.doi,
      url: (paper as any).url, // 可能后端返回
      pdf_url: paper.pdf_url,
    });
  }, [paper]);

  const authors: AuthorOut[] = Array.isArray(paper.authors) ? paper.authors : [];
  const authorLine =
    authors
      .map((a) => a?.name)
      .filter(Boolean)
      .slice(0, 6)
      .join(", ") || "";

  // 单位去重（最多 3 个）
  const affSet = new Set<string>();
  authors.forEach((a) => {
    const aff = (a?.affiliation || "").trim();
    if (aff) affSet.add(aff);
  });
  const affLine = Array.from(affSet).slice(0, 3).join(" · ");

  const tags =
    Array.isArray(paper.tags) && paper.tags.length > 0
      ? paper.tags.map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean)
      : [];

  // 优先外部原文链接（OpenAlex/Crossref），其次本地 pdf_url
  const primaryUrl = (paper as any).url || paper.pdf_url;

  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 hover:shadow-md transition">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold leading-snug line-clamp-2">
            {paper.title}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {paper.venue || "未知 venue"} · {paper.year || "年份未知"}
            {paper.doi ? ` · DOI: ${paper.doi}` : ""}
          </div>

          {authorLine ? (
            <div className="text-xs text-gray-700 mt-1 line-clamp-1">
              {authorLine}
            </div>
          ) : null}

          {affLine ? (
            <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">
              {affLine}
            </div>
          ) : null}
        </div>

        <div className="flex-shrink-0 flex gap-2">
          {primaryUrl ? (
            <a
              href={primaryUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm px-2 py-1 rounded-md border hover:bg-gray-50"
            >
              原文/PDF
            </a>
          ) : null}
          <button
            onClick={() => onOpen?.(paper.id)}
            className="text-sm px-2 py-1 rounded-md border hover:bg-gray-50"
          >
            详情
          </button>
        </div>
      </div>

      {paper.abstract ? (
        <p className="text-sm mt-3 line-clamp-3 text-gray-700">
          {paper.abstract}
        </p>
      ) : null}

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2 mt-3">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-block text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-1"
            >
              #{t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
