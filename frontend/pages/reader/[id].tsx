// frontend/pages/reader/[id].tsx
"use client";
import React from "react";
import { useRouter } from "next/router";

type ParseResp = {
  used_mode: string;
  out_dir: string;
  html?: string | null;
  md?: string | null;
  html_file?: string | null;
  md_file?: string | null;
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

  // PDF.js：使用本地 /public/pdfjs/web/viewer.html （需要下面的拷贝步骤）
  const PDFJS_VIEWER =
    process.env.NEXT_PUBLIC_PDFJS_URL || "/pdfjs/web/viewer.html";

  // 后端 API 基座（推荐设置为 http://127.0.0.1:8000）
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  const api = React.useCallback(
    (path: string) => (apiBase ? `${apiBase}${path}` : path),
    [apiBase]
  );

  // 统一把 “/files/xxx.pdf” 变成：
  // viewer 用于 iframe（同域）; backend 用于后端下载（127.0.0.1:8000）
  const buildPdfUrls = React.useCallback((raw: string) => {
    let viewer = "";
    let backend = "";
    if (!raw) return { viewer, backend };

    // viewer：同当前前端域
    if (/^https?:\/\//i.test(raw)) viewer = raw;
    else if (raw.startsWith("/")) viewer = `${window.location.origin}${raw}`;
    else viewer = raw;

    // backend：/files/* 一律指向后端基座（避免 3000 代理/IPv6）
    if (/^https?:\/\//i.test(raw)) backend = raw;
    else if (raw.startsWith("/files/"))
      backend = `${apiBase || "http://127.0.0.1:8000"}${raw}`;
    else backend = raw;

    return { viewer, backend };
  }, [apiBase]);

  // 初次确定 pdfUrl（允许从接口再拉取一次）
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

  // 仅触发一次 MinerU 解析，避免重复请求
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
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, pdfFromQuery, buildPdfUrls, api]);

  // 左侧 viewer 的 URL
  const viewerUrl = pdfUrl
    ? `${PDFJS_VIEWER}?file=${encodeURIComponent(
        /^https?:\/\//i.test(pdfUrl) ? pdfUrl : `${window.location.origin}${pdfUrl}`
      )}`
    : "";

  return (
    <div className="h-screen w-screen flex flex-col">
      <div className="flex items-center gap-3 px-3 py-2 border-b bg-white">
        <button
          className="px-2 py-1 rounded border hover:bg-gray-50"
          onClick={() => router.back()}
        >
          ← 返回
        </button>
        <div className="text-sm text-gray-500">
          {id ? `Paper #${id}` : "文档"} · {loading ? "解析中…" : "已加载"}
        </div>
        {err && <div className="text-red-600 text-sm ml-4">错误：{err}</div>}
        <div className="ml-auto text-xs text-gray-400">MinerU 对照阅读</div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-0">
        {/* 左：PDF */}
        <div className="relative border-r">
          {pdfUrl ? (
            <iframe title="pdf" src={viewerUrl} className="w-full h-full" />
          ) : (
            <div className="p-6 text-gray-500">未找到 PDF 地址</div>
          )}
        </div>

        {/* 右：解析产物 */}
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
              <div className="animate-spin w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full" />
              <div className="mt-3 text-sm text-gray-600">MinerU 正在解析，请稍候…</div>
            </div>
          )}
          <div className="h-full overflow-auto p-4 prose prose-sm max-w-none">
            {html ? (
              <div dangerouslySetInnerHTML={{ __html: html }} />
            ) : md ? (
              <pre className="whitespace-pre-wrap text-[13px] leading-6">{md}</pre>
            ) : (
              !loading && <div className="text-gray-500">暂无解析内容</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}