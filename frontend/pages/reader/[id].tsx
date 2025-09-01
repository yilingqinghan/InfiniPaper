"use client";

import React from "react";
import Head from "next/head";
import { useRouter } from "next/router";

// --- Helpers to prettify markdown ---
// A) Wrap top author block with separators and no-indent
function decorateAuthorBlock(md: string): string {
  try {
    const lines = md.split(/\r?\n/);

    // utility to test whether a block looks like author+affiliation content
    const looksLikeAuthorBlock = (arr: string[]) => {
      if (!arr.length) return false;
      const text = arr.join(" ");
      const hasAff = /(University|Institute|Laboratory|College|School|Department|Faculty)/i.test(text);
      const hasCommaNames = arr.some((l) => /,\s*[A-Z]/.test(l));
      const manyShortLines = arr.length >= 2 && arr.length <= 20;
      return (hasAff || hasCommaNames) && manyShortLines;
    };

    // 1) find first heading (# or ##) as paper title
    let hIdx = lines.findIndex((l) => /^\s*#{1,2}\s+/.test(l));

    // candidate blocks: (a) from top until blank/heading; (b) lines after first heading until blank line
    const candidates: Array<{start:number,end:number}> = [];

    // (a) block at very top before any heading
    {
      let i = 0;
      while (i < lines.length && !lines[i].trim()) i++;
      const start = i;
      let end = i;
      for (; end < lines.length; end++) {
        const ln = lines[end];
        if (!ln.trim()) break;
        if (/^\s*#/.test(ln)) break;
      }
      if (end > start) candidates.push({ start, end });
    }

    // (b) block right after first heading
    if (hIdx >= 0) {
      let i = hIdx + 1;
      // skip 0-2 blank lines just after heading
      let blanks = 0;
      while (i < lines.length && blanks < 3 && !lines[i].trim()) { i++; blanks++; }
      const start = i;
      let end = i;
      for (; end < lines.length; end++) {
        const ln = lines[end];
        if (!ln.trim()) break;
        if (/^\s*#/.test(ln)) break;
      }
      if (end > start) candidates.push({ start, end });
    }

    for (const { start, end } of candidates) {
      const slice = lines.slice(start, end);
      if (!looksLikeAuthorBlock(slice)) continue;

      const before = lines.slice(0, start).join("\n");
      const after = lines.slice(end).join("\n");
      const items = slice.map((s) => s.trim()).filter(Boolean);
      const inner = items.map((t) => `<p>${t}</p>`).join("\n");
      const wrapped = `${before}\n<div class=\"author-block\">\n${inner}\n</div>\n\n<hr class=\"body-hr\"/>\n${after}`;
      return wrapped.trim();
    }
  } catch {}
  return md;
}

// B) Remark plugin: turn [1] into links to #ref-1 and add ids to reference entries
function remarkCiteLinks() {
  return (tree: any) => {
    const isSkippable = (node: any) => node && (node.type === 'link' || node.type === 'inlineCode' || node.type === 'code');

    // Simple recursive walk with parent/idx
    const walk = (node: any, parent: any = null) => {
      if (!node || isSkippable(node)) return;

      // Paragraphs starting with [N] —> give id="ref-N"
      if (node.type === 'paragraph' && Array.isArray(node.children) && node.children.length) {
        const first = node.children[0];
        if (first && first.type === 'text') {
          const m = first.value && first.value.match(/^\s*\[(\d+)\]\s*/);
          if (m) {
            const id = `ref-${m[1]}`;
            node.data = node.data || {};
            node.data.hProperties = { ...(node.data.hProperties || {}), id };
          }
        }
      }

      // Linkify [N] in plain text nodes
      if (node.type === 'text' && parent && Array.isArray(parent.children)) {
        const value: string = node.value || '';
        const parts: any[] = [];
        let last = 0;
        const regex = /\[(\d+)\]/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(value))) {
          const idx = m.index;
          if (idx > last) parts.push({ type: 'text', value: value.slice(last, idx) });
          const num = m[1];
          parts.push({
            type: 'link',
            url: `#ref-${num}`,
            data: { hProperties: { className: 'cite-link' } },
            children: [{ type: 'text', value: `[${num}]` }],
          });
          last = idx + m[0].length;
        }
        if (parts.length) {
          if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
          const idx = parent.children.indexOf(node);
          parent.children.splice(idx, 1, ...parts);
          return; // children of new nodes will be visited in parent loop naturally
        }
      }

      if (Array.isArray(node.children)) {
        // copy because we may splice during iteration
        const copy = [...node.children];
        for (const child of copy) walk(child, node);
      }
    };

    walk(tree, null);
  };
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";

type ParseResp = {
  used_mode: string;
  out_dir: string;
  html?: string | null;
  md?: string | null;
  html_file?: string | null;
  md_file?: string | null;
  cache_key?: string | null;
  assets_base?: string | null; // 现在是绝对URL，例如 http://127.0.0.1:8000/api/v1/mineru/assets/<key>
  md_rel?: string | null;
  md_base?: string | null;     // 例如 "<title>/auto"
};

export default function ReaderPage() {
  const router = useRouter();
  const { id } = router.query as { id?: string };
  const pdfFromQuery = (router.query?.pdf as string) || "";

  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [html, setHtml] = React.useState<string | null>(null);
  const [md, setMd] = React.useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = React.useState<string>("");

  const [cacheKey, setCacheKey] = React.useState<string | null>(null);
  const [assetsBase, setAssetsBase] = React.useState<string | null>(null);
  const [mdRel, setMdRel] = React.useState<string | null>(null);
  const [mdBase, setMdBase] = React.useState<string | null>(null);

  const PDFJS_VIEWER = process.env.NEXT_PUBLIC_PDFJS_URL || "/pdfjs/web/viewer.html";
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  const api = React.useCallback((path: string) => (apiBase ? `${apiBase}${path}` : path), [apiBase]);

  const [mdFont, setMdFont] = React.useState(16); // px
  const incFont = () => setMdFont((s) => Math.min(22, s + 1));
  const decFont = () => setMdFont((s) => Math.max(14, s - 1));

  const viewerUrl = React.useMemo(() => {
    if (!pdfUrl) return "";
    const abs = /^https?:\/\//i.test(pdfUrl) ? pdfUrl : `${typeof window !== "undefined" ? window.location.origin : ""}${pdfUrl}`;
    return `${PDFJS_VIEWER}?file=${encodeURIComponent(abs)}#zoom=page-width`;
  }, [pdfUrl, PDFJS_VIEWER]);

  const buildPdfUrls = React.useCallback((raw: string) => {
    let viewer = "";
    let backend = "";
    if (!raw) return { viewer, backend };

    if (/^https?:\/\//i.test(raw)) viewer = raw;
    else if (raw.startsWith("/")) viewer = `${window.location.origin}${raw}`;
    else viewer = raw;

    if (/^https?:\/\//i.test(raw)) backend = raw;
    else if (raw.startsWith("/files/")) backend = `${apiBase || "http://127.0.0.1:8000"}${raw}`;
    else backend = raw;

    return { viewer, backend };
  }, [apiBase]);

  React.useEffect(() => {
    if (!id) return;
    const ensurePdf = async () => {
      if (pdfFromQuery) {
        setPdfUrl(pdfFromQuery);
        return;
      }
      try {
        const r = await fetch(api(`/api/v1/papers/${id}`));
        if (r.ok) {
          const p = await r.json();
          if (p?.pdf_url) setPdfUrl(p.pdf_url as string);
        }
      } catch {}
    };
    ensurePdf();
  }, [id, pdfFromQuery, api]);

  const startedRef = React.useRef(false);
  React.useEffect(() => {
    if (!id || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const raw = pdfFromQuery || pdfUrl;
        const { viewer, backend } = buildPdfUrls(raw);
        setPdfUrl(viewer || raw || "");

        const body: any = {};
        if (backend && /^https?:\/\//i.test(backend)) body.pdf_url = backend;
        else if (raw) body.pdf_path = raw;
        else body.paper_id = Number(id);

        const r = await fetch(api(`/api/v1/mineru/parse`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await r.text());
        const data: ParseResp = await r.json();

        setHtml(data.html ?? null);
        setMd(data.md ? decorateAuthorBlock(data.md) : null);
        setCacheKey(data.cache_key ?? null);
        setAssetsBase(data.assets_base ?? null);
        setMdRel(data.md_rel ?? null);
        setMdBase(data.md_base ?? null);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, pdfFromQuery, buildPdfUrls, api]);

  return (
    <div className="h-screen w-screen flex flex-col">
      <Head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-light.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css" />
        <link rel="stylesheet" href="/css/reader.css" />
      </Head>

      <div className="flex items-center gap-3 px-3 py-2 border-b bg-white">
        <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => router.back()}>
          ← 返回
        </button>
        <div className="text-sm text-gray-500">
          {id ? `Paper #${id}` : "文档"} · {loading ? "解析中…" : "已加载"}
        </div>
        {err && <div className="text-red-600 text-sm ml-4">错误：{err}</div>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400 mr-2">MinerU 对照阅读</span>
          <span className="text-xs text-gray-500">字体</span>
          <button className="px-2 py-1 rounded border text-sm hover:bg-gray-50" onClick={decFont}>A-</button>
          <button className="px-2 py-1 rounded border text-sm hover:bg-gray-50" onClick={incFont}>A+</button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-0">
        <div className="relative border-r">
          {pdfUrl ? (
            <iframe title="pdf" src={viewerUrl} className="w-full h-full" />
          ) : (
            <div className="p-6 text-gray-500">未找到 PDF 地址</div>
          )}
        </div>

        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
              <div className="animate-spin w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full" />
              <div className="mt-3 text-sm text-gray-600">MinerU 正在解析/读取缓存…</div>
            </div>
          )}

          <div className="h-full overflow-auto p-4" style={{ ['--md-font-size' as any]: `${mdFont}px` }}>
            {html ? (
              <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
            ) : md ? (
              <article className="markdown-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath, remarkCiteLinks]}
                  rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}
                  components={{
                    a: ({ node, href, className, ...props }) => {
                      const cls = (className || "").toString();
                      const isCite = cls.includes("cite-link") || (typeof href === 'string' && href.startsWith('#ref-'));
                      if (isCite) {
                        return (
                          <a
                            href={href}
                            className={className}
                            onClick={(e) => {
                              try {
                                if (!href) return;
                                if (href.startsWith('#')) {
                                  e.preventDefault();
                                  const id = href.slice(1);
                                  const el = document.getElementById(id);
                                  if (el) {
                                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    if (history?.replaceState) history.replaceState(null, '', href);
                                  }
                                }
                              } catch {}
                            }}
                            {...props}
                          />
                        );
                      }
                      return <a href={href} className={className} target="_blank" rel="noreferrer" {...props} />;
                    },

                    // 表格外包一层，便于整体居中 + 横向滚动
                    table: ({ node, ...props }) => (
                      <div className="md-table">
                        <table {...props} />
                      </div>
                    ),

                    // 图片渲染为 figure（alt 作为可选 figcaption），并将相对路径重写为绝对 URL
                    img: ({ node, src = "", alt, ...props }) => {
                      let finalSrc = src;

                      // 若为相对路径，按 assetsBase + mdBase/mdRel 拼接
                      if (!/^https?:\/\//i.test(finalSrc)) {
                        const base =
                          assetsBase ||
                          (cacheKey ? `${apiBase}/api/v1/mineru/assets/${cacheKey}` : "");

                        if (base) {
                          const relBase = (mdBase || mdRel || "").replace(/^\/+|\/+$/g, "");
                          const prefix = relBase ? `${base.replace(/\/+$/, "")}/${relBase}/` : `${base.replace(/\/+$/, "")}/`;
                          try {
                            finalSrc = new URL(finalSrc.replace(/^\/+/, ""), prefix).toString();
                          } catch {
                            finalSrc = `${prefix}${finalSrc.replace(/^\/+/, "")}`;
                          }
                        }
                      }

                      const caption = typeof alt === "string" ? alt.trim() : "";
                      return (
                        <figure>
                          <img src={finalSrc} alt={caption} {...props} />
                          {caption ? <figcaption>{caption}</figcaption> : null}
                        </figure>
                      );
                    },
                  }}
                >
                  {md}
                </ReactMarkdown>
              </article>
            ) : (
              !loading && <div className="text-gray-500">暂无解析内容</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}