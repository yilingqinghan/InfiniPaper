"use client";

import React from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import dynamic from 'next/dynamic';
const PdfPane = dynamic(() => import('@/components/PdfPane'), { ssr: false });
// --- Helpers to prettify markdown ---
// A) Wrap top author block with separators and no-indent
// ADD ——— 选区与锚点工具（把选中文本映射为容器内纯文本偏移）
function getLinearTextAndMap(container: HTMLElement) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let text = "";
    const segments: { node: Text; start: number; end: number }[] = [];
    let offset = 0;
    let n: any;
    while ((n = walker.nextNode())) {
        const t = (n as Text).nodeValue || "";
        const start = offset;
        const end = start + t.length;
        segments.push({ node: n as Text, start, end });
        text += t;
        offset = end;
    }
    return { text, segments };
}

function selectionToOffsets(container: HTMLElement) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;

    // 限定必须选在容器内
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
        return null;
    }

    const { text, segments } = getLinearTextAndMap(container);

    const toPos = (node: Node, nodeOffset: number) => {
        // 找到该 text node 在 segments 中的位置并换算线性偏移
        const idx = segments.findIndex(s => s.node === node);
        if (idx < 0) return null;
        return segments[idx].start + nodeOffset;
    };

    // 规范化到 text node
    const norm = (node: Node, offset: number) => {
        if (node.nodeType === Node.TEXT_NODE) return { node, offset };
        // 如果节点是元素，尝试找到其中某个 textNode
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const firstText = walker.nextNode();
        if (firstText) return { node: firstText as Node, offset: 0 };
        return { node, offset }; // 退化
    };

    const s = norm(range.startContainer, range.startOffset);
    const e = norm(range.endContainer, range.endOffset);
    const start = toPos(s.node, s.offset);
    const end = toPos(e.node, e.offset);
    if (start == null || end == null) return null;

    const a = Math.min(start, end);
    const b = Math.max(start, end);
    const quote = text.slice(a, b);
    return { start: a, end: b, quote, text, segments };
}

// 根据线性偏移高亮（用于恢复批注）
function highlightByOffsets(container: HTMLElement, start: number, end: number, id: string, color: string) {
    const selMap = getLinearTextAndMap(container);
    const { segments } = selMap;

    const range = document.createRange();
    // 找 start 对应的 text node & 偏移
    let sNode: Text | null = null, sOff = 0, eNode: Text | null = null, eOff = 0;
    for (const seg of segments) {
        if (sNode == null && start >= seg.start && start <= seg.end) {
            sNode = seg.node; sOff = start - seg.start;
        }
        if (eNode == null && end >= seg.start && end <= seg.end) {
            eNode = seg.node; eOff = end - seg.start;
        }
        if (sNode && eNode) break;
    }
    if (!sNode || !eNode) return;

    range.setStart(sNode, sOff);
    range.setEnd(eNode, eOff);

    const mark = document.createElement("mark");
    mark.dataset.annId = id;
    mark.style.background = color || "#FFE58F";
    mark.style.padding = "0 2px";
    try {
        range.surroundContents(mark);
    } catch {
        // 跨节点复杂结构时 fallback：用 span 包裹
        const span = document.createElement("span");
        span.dataset.annId = id;
        span.style.background = color || "#FFE58F";
        span.style.padding = "0 2px";
        range.surroundContents(span);
    }
}

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
        const candidates: Array<{ start: number, end: number }> = [];

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
    } catch { }
    return md;
}

// B) Remark plugin: turn [1] into links to #ref-1 and add ids to reference entries
// B) Remark plugin: add anchors in References section and linkify in-text citations elsewhere
function remarkCiteAnchorsAndLinks() {
    return (tree: any) => {
        const nodeText = (node: any): string => {
            if (!node) return "";
            if (typeof node.value === "string") return node.value;
            if (Array.isArray(node.children)) return node.children.map(nodeText).join("");
            return "";
        };

        const isSkippable = (node: any) =>
            node && (node.type === "link" || node.type === "inlineCode" || node.type === "code");

        let inRefs = false;
        let refDepth = 0;

        const walk = (node: any, parent: any = null) => {
            if (!node) return;

            // 进入/退出 References 区域
            if (node.type === "heading") {
                const text = nodeText(node).trim();
                const isRef = /^(references?|bibliography)$/i.test(text);
                if (isRef) {
                    inRefs = true;
                    refDepth = node.depth || 1;
                } else if (inRefs && (node.depth || 1) <= refDepth) {
                    inRefs = false;
                }
            }

            // 在参考文献段里：为每个 [N] 插入 <span id="ref-N"> 锚点（允许同段多个）
            if (inRefs && (node.type === "paragraph" || node.type === "listItem")) {
                const children = Array.isArray(node.children) ? node.children : [];
                for (let ci = 0; ci < children.length; ci++) {
                    const ch = children[ci];
                    if (!ch || ch.type !== "text") continue;
                    const value: string = ch.value || "";
                    const parts: any[] = [];
                    let last = 0;
                    const rx = /\[(\d+)\]/g;
                    let m: RegExpExecArray | null;
                    while ((m = rx.exec(value))) {
                        const idx = m.index;
                        const num = m[1];
                        if (idx > last) parts.push({ type: "text", value: value.slice(last, idx) });
                        // 在原始 [N] 之前塞入锚点
                        parts.push({ type: "html", value: `<span id="ref-${num}" class="ref-anchor"></span>` });
                        // 保留原 [N] 文本（不转链接）
                        parts.push({ type: "text", value: m[0] });
                        last = idx + m[0].length;
                    }
                    if (parts.length) {
                        if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
                        children.splice(ci, 1, ...parts);
                        ci += parts.length - 1;
                    }
                }
            }

            // 不在参考文献段：把 [N] 变成跳转链接
            if (!inRefs && !isSkippable(node) && node.type === "text" && parent && Array.isArray(parent.children)) {
                const value: string = node.value || "";
                const parts: any[] = [];
                let last = 0;
                const rx = /\[(\d+)\]/g;
                let m: RegExpExecArray | null;
                while ((m = rx.exec(value))) {
                    const idx = m.index;
                    if (idx > last) parts.push({ type: "text", value: value.slice(last, idx) });
                    const num = m[1];
                    parts.push({
                        type: "link",
                        url: `#ref-${num}`,
                        data: { hProperties: { className: "cite-link" } },
                        children: [{ type: "text", value: `[${num}]` }],
                    });
                    last = idx + m[0].length;
                }
                if (parts.length) {
                    if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
                    const idx = parent.children.indexOf(node);
                    parent.children.splice(idx, 1, ...parts);
                    return;
                }
            }

            if (Array.isArray(node.children)) {
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
    // ADD —— 批注 & LLM
    const mdContainerRef = React.useRef<HTMLDivElement | null>(null);
    const [selectionBox, setSelectionBox] = React.useState<{ x: number; y: number; show: boolean }>({ x: 0, y: 0, show: false });
    const [selPayload, setSelPayload] = React.useState<{ start: number; end: number; quote: string } | null>(null);

    // LLM 弹窗
    const [llmOpen, setLlmOpen] = React.useState(false);
    const [llmLoading, setLlmLoading] = React.useState(false);
    const [llmAnswer, setLlmAnswer] = React.useState("");

    // 批注列表
    type Ann = {
        id: string; paper_id: number;
        anchor: { start: number; end: number; quote: string };
        note: string; color: string; created_at: string; updated_at: string;
    };
    const [annos, setAnnos] = React.useState<Ann[]>([]);
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
            } catch { }
        };
        ensurePdf();
    }, [id, pdfFromQuery, api]);
    // ADD —— 恢复批注 & 绑定选区监听
    React.useEffect(() => {
        if (!id) return;
        // 拉取批注
        (async () => {
        try {
            const r = await fetch(api(`/api/v1/annotations/${id}`));
            if (r.ok) {
            const list: Ann[] = await r.json();
            setAnnos(list);
            // 等 markdown 渲染后再高亮
            setTimeout(() => {
                const box = mdContainerRef.current;
                if (!box) return;
                list.forEach(a => highlightByOffsets(box, a.anchor.start, a.anchor.end, a.id, a.color));
            }, 0);
            }
        } catch {}
        })();
    }, [id, md, api]);
    // ADD —— 监听选区
    React.useEffect(() => {
        const box = mdContainerRef.current;
        if (!box) return;
    
        const onMouseUp = () => {
        const info = selectionToOffsets(box);
        if (!info || info.quote.trim().length === 0) {
            setSelectionBox(s => ({...s, show:false}));
            setSelPayload(null);
            return;
        }
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const hostRect = box.getBoundingClientRect();
        setSelectionBox({
            x: rect.left - hostRect.left + rect.width/2,
            y: rect.top - hostRect.top - 8,
            show: true
        });
        setSelPayload({ start: info.start, end: info.end, quote: info.quote });
        };
    
        box.addEventListener("mouseup", onMouseUp);
        return () => box.removeEventListener("mouseup", onMouseUp);
    }, [md]);
    const startedRef = React.useRef(false);

    // ADD —— 询问 LLM
const askLLM = async () => {
    if (!selPayload) return;
    setLlmOpen(true);
    setLlmLoading(true);
    setLlmAnswer("");
    try {
      const r = await fetch(api(`/api/v1/llm/ask`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `请基于以下摘录进行解释/总结，并指出关键点：\n\n${selPayload.quote}`,
          context: `Paper #${id}`,
        }),
      });
      const data = await r.json();
      setLlmAnswer(data?.text || "(空)");
    } catch (e:any) {
      setLlmAnswer(`调用失败：${e?.message||e}`);
    } finally {
      setLlmLoading(false);
    }
  };
  
  // ADD —— 保存批注（高亮 + 备注）
  const addAnnotation = async () => {
    if (!selPayload || !id) return;
    const note = prompt("给这个高亮添加备注（可留空）", "") || "";
    const color = "#FFE58F";
    const annId = crypto.randomUUID();
  
    // 先本地高亮
    const box = mdContainerRef.current;
    if (box) highlightByOffsets(box, selPayload.start, selPayload.end, annId, color);
  
    try {
      const r = await fetch(api(`/api/v1/annotations/${id}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: annId,
          paper_id: Number(id),
          anchor: selPayload,
          note, color
        }),
      });
      if (r.ok) {
        const saved = await r.json();
        setAnnos(a => [...a, saved]);
      }
    } catch {}
    setSelectionBox(s => ({...s, show:false}));
    setSelPayload(null);
  };
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
                        <PdfPane fileUrl={viewerUrl} className="h-full" />
                    ) : (
                        <div className="p-6 text-gray-500">未找到 PDF 地址</div>
                    )}
                </div>

                {/* RIGHT: Markdown + selection tools */}
                <div className="relative">
                    {loading && (
                        <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
                            <div className="animate-spin w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full" />
                            <div className="mt-3 text-sm text-gray-600">MinerU 正在解析/读取缓存…</div>
                        </div>
                    )}

                    {/* This is the ONLY container with mdContainerRef */}
                    <div
                        className="h-full overflow-auto p-4 relative"
                        style={{ ['--md-font-size' as any]: `${mdFont}px` }}
                        ref={mdContainerRef}
                    >
                        {html ? (
                            <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
                        ) : md ? (
                            <article className="markdown-body">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm, remarkMath, remarkCiteAnchorsAndLinks]}
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
                                                                        el.scrollIntoView({ block: 'start' });
                                                                        if (history?.replaceState) history.replaceState(null, '', href);
                                                                    }
                                                                }
                                                            } catch { }
                                                        }}
                                                        {...props}
                                                    />
                                                );
                                            }
                                            return <a href={href} className={className} target="_blank" rel="noreferrer" {...props} />;
                                        },
                                        table: ({ node, ...props }) => (
                                            <div className="md-table">
                                                <table {...props} />
                                            </div>
                                        ),
                                        img: ({ node, src = "", alt, ...props }) => {
                                            let finalSrc = src;
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

                        {/* Floating action bar for selection */}
                        {selectionBox.show && selPayload && (
                            <div
                                className="absolute z-20 bg-white shadow-lg border rounded flex items-center"
                                style={{ left: selectionBox.x, top: selectionBox.y, transform: "translate(-50%, -100%)" }}
                                onMouseDown={(e) => e.preventDefault()}
                            >
                                <button className="px-2 py-1 text-sm hover:bg-gray-50 border-r" onClick={askLLM}>询问 LLM</button>
                                <button className="px-2 py-1 text-sm hover:bg-gray-50" onClick={addAnnotation}>添加批注</button>
                                <button className="px-2 py-1 text-sm text-gray-500 hover:bg-gray-50" onClick={() => setSelectionBox(s => ({ ...s, show: false }))}>×</button>
                            </div>
                        )}

                        {/* LLM modal */}
                        {llmOpen && (
                            <div className="absolute inset-0 z-30 bg-black/20 flex items-center justify-center" onClick={() => setLlmOpen(false)}>
                                <div className="bg-white w-[min(720px,90%)] max-h-[80%] overflow-auto rounded shadow-xl p-4" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center mb-2">
                                        <div className="font-medium">LLM 回答</div>
                                        <div className="ml-auto">
                                            <button className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 rounded" onClick={() => setLlmOpen(false)}>关闭</button>
                                        </div>
                                    </div>
                                    {llmLoading ? (
                                        <div className="text-gray-500">思考中…</div>
                                    ) : (
                                        <pre className="whitespace-pre-wrap text-sm leading-6">{llmAnswer}</pre>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}