"use client";

import React from "react";
import Head from "next/head";
import { useRouter } from "next/router";

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
        setMd(data.md ?? null);
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
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}
                  components={{
                    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,

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