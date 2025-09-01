// The new file content begins here
"use client";

import React from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
const PdfPane = dynamic(() => import("@/components/PdfPane"), { ssr: false });

/* -------------------- 选择映射 & 高亮工具 -------------------- */
function getLinearTextAndMap(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const segments: { node: Text; start: number; end: number }[] = [];
  let text = "";
  let off = 0;
  let n: any;
  while ((n = walker.nextNode())) {
    const t = (n as Text).nodeValue || "";
    const start = off;
    const end = start + t.length;
    segments.push({ node: n as Text, start, end });
    text += t;
    off = end;
  }
  return { text, segments };
}

function selectionToOffsets(container: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

  const { text, segments } = getLinearTextAndMap(container);

  const toPos = (node: Node, nodeOffset: number) => {
    const idx = segments.findIndex((s) => s.node === node);
    if (idx < 0) return null;
    return segments[idx].start + nodeOffset;
  };

  const norm = (node: Node, offset: number) => {
    if (node.nodeType === Node.TEXT_NODE) return { node, offset };
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    if (first) return { node: first as Node, offset: 0 };
    return { node, offset };
  };

  const s = norm(range.startContainer, range.startOffset);
  const e = norm(range.endContainer, range.endOffset);
  const start = toPos(s.node, s.offset);
  const end = toPos(e.node, e.offset);
  if (start == null || end == null) return null;

  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const quote = text.slice(a, b);
  return { start: a, end: b, quote };
}

/** 更稳妥的包裹：extractContents + insertNode */
function wrapRange(range: Range, tagName: string, attrs: Record<string, string>, styles: Record<string, string>) {
  const el = document.createElement(tagName);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  Object.entries(styles || {}).forEach(([k, v]) => ((el.style as any)[k] = v));
  const frag = range.extractContents();
  el.appendChild(frag);
  range.insertNode(el);
  return el;
}

/**
 * 将 [start,end) 的线性区间拆成多个纯文本范围逐段高亮，
 * 避免把整个 <p> 等块级元素包进 <mark> 导致布局异常。
 */
function highlightOffsetsMulti(container: HTMLElement, start: number, end: number, id: string, color: string) {
  const { segments } = getLinearTextAndMap(container);
  const created: HTMLElement[] = [];
  segments.forEach((seg) => {
    const L = Math.max(start, seg.start);
    const R = Math.min(end, seg.end);
    if (L < R) {
      const r = document.createRange();
      r.setStart(seg.node, L - seg.start);
      r.setEnd(seg.node, R - seg.start);
      const el = wrapRange(
        r,
        "mark",
        { "data-ann-id": id, class: "ann-mark" },
        { background: color || "#FFE58F", padding: "0 2px" }
      );
      created.push(el as HTMLElement);
    }
  });
  return created;
}

function highlightByOffsets(container: HTMLElement, start: number, end: number, id: string, color: string) {
  return highlightOffsetsMulti(container, start, end, id, color);
}

// 浮动层判断：工具条/右键菜单/备注面板等
function isInFloating(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('[data-floating-ui]');
}

/* -------------------- Markdown修饰（作者块/参考文献锚点） -------------------- */
function decorateAuthorBlock(md: string): string {
  try {
    const lines = md.split(/\r?\n/);
    const looksLikeAuthorBlock = (arr: string[]) => {
      if (!arr.length) return false;
      const text = arr.join(" ");
      const hasAff = /(University|Institute|Laboratory|College|School|Department|Faculty)/i.test(text);
      const hasCommaNames = arr.some((l) => /,\s*[A-Z]/.test(l));
      const manyShortLines = arr.length >= 2 && arr.length <= 20;
      return (hasAff || hasCommaNames) && manyShortLines;
    };

    const candidates: Array<{ start: number; end: number }> = [];
    { // 顶部块
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

    const hIdx = lines.findIndex((l) => /^\s*#{1,2}\s+/.test(l));
    if (hIdx >= 0) { // 标题后块
      let i = hIdx + 1;
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
      const inner = slice.map((t) => `<p>${t.trim()}</p>`).join("\n");
      return `${before}\n<div class="author-block">\n${inner}\n</div>\n\n<hr class="body-hr"/>\n${after}`.trim();
    }
  } catch {}
  return md;
}

function remarkCiteAnchorsAndLinks() {
  return (tree: any) => {
    const nodeText = (node: any): string => {
      if (!node) return "";
      if (typeof node.value === "string") return node.value;
      if (Array.isArray(node.children)) return node.children.map(nodeText).join("");
      return "";
    };
    const isSkippable = (node: any) => node && (node.type === "link" || node.type === "inlineCode" || node.type === "code");

    let inRefs = false;
    let refDepth = 0;

    const walk = (node: any, parent: any = null) => {
      if (!node) return;

      if (node.type === "heading") {
        const text = nodeText(node).trim();
        const isRef = /^(references?|bibliography)$/i.test(text);
        if (isRef) { inRefs = true; refDepth = node.depth || 1; }
        else if (inRefs && (node.depth || 1) <= refDepth) inRefs = false;
      }

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
            const idx = m.index, num = m[1];
            if (idx > last) parts.push({ type: "text", value: value.slice(last, idx) });
            parts.push({ type: "html", value: `<span id="ref-${num}" class="ref-anchor"></span>` });
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

      if (!inRefs && !isSkippable(node) && node.type === "text" && parent && Array.isArray(parent.children)) {
        const value: string = node.value || "";
        const parts: any[] = [];
        let last = 0;
        const rx = /\[(\d+)\]/g;
        let m: RegExpExecArray | null;
        while ((m = rx.exec(value))) {
          const idx = m.index, num = m[1];
          if (idx > last) parts.push({ type: "text", value: value.slice(last, idx) });
          parts.push({ type: "link", url: `#ref-${num}`, data: { hProperties: { className: "cite-link" } }, children: [{ type: "text", value: `[${num}]` }] });
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

/* -------------------- Markdown 渲染插件 -------------------- */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";

/* -------------------- 类型 -------------------- */
type ParseResp = {
  used_mode: string;
  out_dir: string;
  html?: string | null;
  md?: string | null;
  html_file?: string | null;
  md_file?: string | null;
  cache_key?: string | null;
  assets_base?: string | null;
  md_rel?: string | null;
  md_base?: string | null;
};

type Ann = {
  id: string;
  paper_id: number;
  anchor: { start: number; end: number; quote: string };
  note: string;
  color: string;
  created_at: string;
  updated_at: string;
};

/* -------------------- 组件 -------------------- */
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

  // 字体
  const [mdFont, setMdFont] = React.useState(16);
  const incFont = () => setMdFont((s) => Math.min(22, s + 1));
  const decFont = () => setMdFont((s) => Math.max(14, s - 1));

  const viewerUrl = React.useMemo(() => {
    if (!pdfUrl) return "";
    const abs = /^https?:\/\//i.test(pdfUrl) ? pdfUrl : `${typeof window !== "undefined" ? window.location.origin : ""}${pdfUrl}`;
    return `${PDFJS_VIEWER}?file=${encodeURIComponent(abs)}#zoom=page-width`;
  }, [pdfUrl, PDFJS_VIEWER]);

  // 选择 & 工具条
  const mdContainerRef = React.useRef<HTMLDivElement | null>(null);
  const notesPaneRef = React.useRef<HTMLDivElement | null>(null);
  const [selectionBox, setSelectionBox] = React.useState<{ x: number; y: number; show: boolean }>({ x: 0, y: 0, show: false });
  const [selPayload, setSelPayload] = React.useState<{ start: number; end: number; quote: string } | null>(null);
  const [pickedColor, setPickedColor] = React.useState<string>("#FFE58F");

  // 右键菜单
  const [ctxMenu, setCtxMenu] = React.useState<{ show: boolean; x: number; y: number; annId: string | null }>({ show: false, x: 0, y: 0, annId: null });

  // LLM
  const [llmOpen, setLlmOpen] = React.useState(false);
  const [llmLoading, setLlmLoading] = React.useState(false);
  const [llmAnswer, setLlmAnswer] = React.useState("");

  // 批注
  const [annos, setAnnos] = React.useState<Ann[]>([]);
  // 侧栏定位
  const [noteLayout, setNoteLayout] = React.useState<{ id: string; top: number }[]>([]);

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
      if (pdfFromQuery) { setPdfUrl(pdfFromQuery); return; }
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

  // 加载批注 + 恢复高亮
  React.useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r = await fetch(api(`/api/v1/annotations/${id}`));
        if (r.ok) {
          const list: Ann[] = await r.json();
          setAnnos(list);
          setTimeout(() => {
            const box = mdContainerRef.current;
            if (!box) return;
            list.forEach((a) => highlightByOffsets(box, a.anchor.start, a.anchor.end, a.id, a.color));
            computeSidebarLayout(); // 恢复后计算侧栏
          }, 0);
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, md]);

  // 监听选区
  React.useEffect(() => {
    const box = mdContainerRef.current;
    if (!box) return;

    const onMouseUp = (e: MouseEvent) => {
      if (isInFloating(e.target)) return;
      const info = selectionToOffsets(box);
      if (!info || info.quote.trim().length === 0) {
        setSelectionBox((s) => ({ ...s, show: false }));
        setSelPayload(null);
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const host = box.getBoundingClientRect();
      setSelectionBox({ x: rect.left - host.left + rect.width / 2, y: rect.top - host.top - 8, show: true });
      setSelPayload(info);
      setCtxMenu({ show: false, x: 0, y: 0, annId: null });
    };

    const onContextMenu = (e: MouseEvent) => {
      if (isInFloating(e.target)) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const host = mdContainerRef.current!;
      if (!host.contains(target)) return;

      const mark = (target.closest("[data-ann-id]") as HTMLElement) || null;
      if (!mark) return;

      e.preventDefault();
      const r = (e as MouseEvent);
      const hostRect = host.getBoundingClientRect();
      setCtxMenu({ show: true, x: r.clientX - hostRect.left, y: r.clientY - hostRect.top, annId: mark.dataset.annId || null });
      setSelectionBox((s) => ({ ...s, show: false }));
    };

    const onScrollOrResize = () => {
      recomputeLayout();
      const host = mdContainerRef.current;
      const notes = notesPaneRef.current;
      if (host && notes && Math.abs(notes.scrollTop - host.scrollTop) > 1) {
        notes.scrollTop = host.scrollTop;  // 关键：同步滚动
      }
    };

    // Add: notes pane to markdown host scroll sync
    const notes = notesPaneRef.current;
    const onNotesScroll = () => {
      const host = mdContainerRef.current;
      const notes = notesPaneRef.current;
      if (host && notes && Math.abs(host.scrollTop - notes.scrollTop) > 1) {
        host.scrollTop = notes.scrollTop;
      }
    };

    box.addEventListener("mouseup", onMouseUp);
    box.addEventListener("contextmenu", onContextMenu);
    box.addEventListener("scroll", onScrollOrResize);
    window.addEventListener("resize", onScrollOrResize);
    notes?.addEventListener("scroll", onNotesScroll);
    return () => {
      box.removeEventListener("mouseup", onMouseUp);
      box.removeEventListener("contextmenu", onContextMenu);
      box.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      notes?.removeEventListener("scroll", onNotesScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md]);
  const [sidebarHeight, setSidebarHeight] = React.useState<number>(0);
  // 计算侧栏布局
  const computeSidebarLayout = React.useCallback(() => {
    const host = mdContainerRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const arr: { id: string; top: number }[] = [];
    annos.forEach((a) => {
      const el = host.querySelector<HTMLElement>(`[data-ann-id="${a.id}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = r.top - hostRect.top + host.scrollTop; // 统一到 host 的滚动坐标
      arr.push({ id: a.id, top: Math.max(0, top) });
    });
    setNoteLayout(arr);
    setSidebarHeight(host.scrollHeight);               // 关键：侧栏内容高度=正文总高度
  }, [annos]);

  const recomputeLayout = React.useMemo(() => {
    let ticking = false;
    return () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        computeSidebarLayout();
        ticking = false;
      });
    };
  }, [computeSidebarLayout]);

  // LLM 聊天
  const [chat, setChat] = React.useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [promptText, setPromptText] = React.useState('');
  const askLLM = () => {
    if (!selPayload) return;
    setLlmOpen(true);
    setPromptText(`请基于以下摘录进行解释/总结，并指出关键点：\n\n${selPayload.quote}`);
    setChat([]);
    setLlmLoading(false);
  };
  const sendLLM = async () => {
    if (!promptText.trim()) return;
    setLlmLoading(true);
    setChat((c) => [...c, { role: 'user', text: promptText }]);
    try {
      const r = await fetch(api(`/api/v1/llm/ask`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText, context: `Paper #${id}` }),
      });
      if (!r.ok) {
        const t = await r.text();
        setChat((c) => [...c, { role: 'assistant', text: `服务错误：${r.status} ${t}` }]);
      } else {
        const data = await r.json();
        setChat((c) => [...c, { role: 'assistant', text: data?.text || "(空)" }]);
      }
    } catch (e: any) {
      setChat((c) => [...c, { role: 'assistant', text: `调用失败：${e?.message || e}` }]);
    } finally {
      setLlmLoading(false);
    }
  };

  // 备注弹窗
  const [noteEditor, setNoteEditor] = React.useState<{ show: boolean; x: number; y: number; text: string }>({ show: false, x: 0, y: 0, text: "" });

  // 弹出备注编辑器
  const openNoteEditor = () => {
    if (!selectionBox.show) return;
    const host = mdContainerRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const absX = hostRect.left + selectionBox.x;
    const absY = hostRect.top + selectionBox.y;
    setNoteEditor({ show: true, x: absX, y: absY, text: "" });
  };

  const doAddAnnotation = async (note: string) => {
    if (!selPayload || !id) return;
    const color = pickedColor || "#FFE58F";
    const annId = crypto.randomUUID();

    const box = mdContainerRef.current;
    if (box) highlightByOffsets(box, selPayload.start, selPayload.end, annId, color);

    try {
      const r = await fetch(api(`/api/v1/annotations/${id}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: annId, paper_id: Number(id), anchor: selPayload, note, color }),
      });
      if (r.ok) {
        const saved = await r.json();
        setAnnos((a) => [...a, saved]);
        setTimeout(() => computeSidebarLayout(), 0);
      }
    } catch {}
    setSelectionBox((s) => ({ ...s, show: false }));
    setSelPayload(null);
    setNoteEditor({ show: false, x: 0, y: 0, text: "" });
  };

  // 改色 & 删除（右键菜单）
  const applyAnnColor = async (annId: string, color: string) => {
    const host = mdContainerRef.current;
    if (!host) return;
    host.querySelectorAll<HTMLElement>(`[data-ann-id="${annId}"]`).forEach((el) => (el.style.background = color));
    setAnnos((list) => list.map((x) => (x.id === annId ? { ...x, color } : x)));
    try {
      await fetch(api(`/api/v1/annotations/${id}/${annId}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ color }) });
    } catch {}
    setCtxMenu({ show: false, x: 0, y: 0, annId: null });
  };

  const deleteAnnotation = async (annId: string) => {
    const host = mdContainerRef.current;
    if (host) {
      host.querySelectorAll<HTMLElement>(`[data-ann-id="${annId}"]`).forEach((el) => {
        const parent = el.parentNode as Node;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      });
    }
    setAnnos((list) => list.filter((x) => x.id !== annId));
    setTimeout(() => computeSidebarLayout(), 0);
    try {
      await fetch(api(`/api/v1/annotations/${id}/${annId}`), { method: "DELETE" });
    } catch {}
    setCtxMenu({ show: false, x: 0, y: 0, annId: null });
  };

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

        const r = await fetch(api(`/api/v1/mineru/parse`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pdfFromQuery, buildPdfUrls, api]);
  React.useEffect(() => {
    const host = mdContainerRef.current;
    if (!host) return;
  
    const ro = new ResizeObserver(() => recomputeLayout());
    ro.observe(host);
  
    const imgs = host.querySelectorAll('img');
    const onImgLoad = () => recomputeLayout();
    imgs.forEach(img => img.addEventListener('load', onImgLoad));
  
    // 首屏延迟重算，等字体/KaTeX样式生效
    const t1 = setTimeout(recomputeLayout, 200);
    const t2 = setTimeout(recomputeLayout, 800);
  
    return () => {
      ro.disconnect();
      imgs.forEach(img => img.removeEventListener('load', onImgLoad));
      clearTimeout(t1); clearTimeout(t2);
    };
  }, [md, recomputeLayout]);
  /* -------------------- 渲染 -------------------- */
  return (
    <div className="h-screen w-screen flex flex-col">
      <Head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-light.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css" />
        <link rel="stylesheet" href="/css/reader.css" />
      </Head>

      <div className="flex items-center gap-3 px-3 py-2 border-b bg-gradient-to-r from-white to-indigo-50/30">
        <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => router.back()}>
          ← 返回
        </button>
        <div className="text-sm text-gray-500">{id ? `Paper #${id}` : "文档"} · {loading ? "解析中…" : "已加载"}</div>
        {err && <div className="text-red-600 text-sm ml-4">错误：{err}</div>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400 mr-2">MinerU 对照阅读</span>
          <span className="text-xs text-gray-500">字体</span>
          <button className="px-2 py-1 rounded border text-sm hover:bg-gray-50" onClick={decFont}>A-</button>
          <button className="px-2 py-1 rounded border text-sm hover:bg-gray-50" onClick={incFont}>A+</button>
        </div>
      </div>

      {/* 三列布局：40% / 40% / 20% */}
      <div className="flex-1 grid" style={{ gridTemplateColumns: "40% 40% 20%" }}>
        {/* LEFT: PDF */}
        <div className="relative border-r">
          {pdfUrl ? <PdfPane fileUrl={viewerUrl} className="h-full" /> : <div className="p-6 text-gray-500">未找到 PDF 地址</div>}
        </div>

        {/* MIDDLE: Markdown + tools */}
        <div className="relative border-r">
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
              <div className="animate-spin w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full" />
              <div className="mt-3 text-sm text-gray-600">MinerU 正在解析/读取缓存…</div>
            </div>
          )}

          <div
            className="h-full overflow-auto p-4 relative"
            style={{ ["--md-font-size" as any]: `${mdFont}px` }}
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
                      const isCite = cls.includes("cite-link") || (typeof href === "string" && href.startsWith("#ref-"));
                      if (isCite) {
                        return (
                          <a
                            href={href}
                            className={className}
                            onClick={(e) => {
                              try {
                                if (!href) return;
                                if (href.startsWith("#")) {
                                  e.preventDefault();
                                  const id = href.slice(1);
                                  const el = document.getElementById(id);
                                  if (el) {
                                    el.scrollIntoView({ block: "start", behavior: "smooth" });
                                    if (history?.replaceState) history.replaceState(null, "", href);
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
                    table: ({ node, ...props }) => (
                      <div className="md-table">
                        <table {...props} />
                      </div>
                    ),
                    img: ({ node, src = "", alt, ...props }) => {
                      let finalSrc = src;
                      if (!/^https?:\/\//i.test(finalSrc)) {
                        const base = assetsBase || (cacheKey ? `${apiBase}/api/v1/mineru/assets/${cacheKey}` : "");
                        if (base) {
                          const relBase = (mdBase || mdRel || "").replace(/^\/+|\/+$/g, "");
                          const prefix = relBase ? `${base.replace(/\/+$/, "")}/${relBase}/` : `${base.replace(/\/+$/, "")}/`;
                          try { finalSrc = new URL(finalSrc.replace(/^\/+/, ""), prefix).toString(); }
                          catch { finalSrc = `${prefix}${finalSrc.replace(/^\/+/, "")}`; }
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

                {/* 连接线层（横线对齐到右侧批注栏边缘） */}
                <div className="pointer-events-none absolute inset-0">
                  {noteLayout.map(({ id, top }) => (
                    <div key={`line-${id}`} className="absolute h-[1px] bg-indigo-100" style={{ top: top + 12, left: 0, right: 0 }} />
                  ))}
                </div>
              </article>
            ) : (
              !loading && <div className="text-gray-500">暂无解析内容</div>
            )}

            {/* 选区浮动工具条 */}
            {selectionBox.show && selPayload && (
              <div
                data-floating-ui
                className="absolute z-20 bg-white shadow-lg border border-indigo-100 rounded flex items-center gap-1 px-1 py-1"
                style={{ left: selectionBox.x, top: selectionBox.y, transform: "translate(-50%, -100%)" }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {/* 色板 */}
                {["#FFE58F", "#C7F5D9", "#CDE9FF", "#FFD6E7"].map((c) => (
                  <button
                    key={c}
                    title={c}
                    className="w-4 h-4 rounded-full border"
                    style={{ background: c, outline: pickedColor === c ? "2px solid #555" : "none" }}
                    onClick={() => setPickedColor(c)}
                  />
                ))}
                <span className="mx-1 text-gray-300">|</span>
                <button className="px-2 py-1 text-sm hover:bg-gray-50 border rounded" onClick={askLLM}>询问 LLM</button>
                <button className="px-2 py-1 text-sm hover:bg-gray-50 border rounded" onClick={openNoteEditor}>添加批注</button>
                <button className="px-2 py-1 text-sm text-gray-500 hover:bg-gray-50" onClick={() => setSelectionBox((s) => ({ ...s, show: false }))}>×</button>
              </div>
            )}


            {/* 右键菜单：改色/删除 */}
            {ctxMenu.show && ctxMenu.annId && (
              <div
                data-floating-ui
                className="absolute z-30 bg-white border shadow rounded p-2 text-sm"
                style={{ left: ctxMenu.x, top: ctxMenu.y }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs text-gray-500">颜色</span>
                  {["#FFE58F", "#C7F5D9", "#CDE9FF", "#FFD6E7"].map((c) => (
                    <button
                      key={c}
                      className="w-4 h-4 rounded-full border"
                      style={{ background: c }}
                      onClick={() => applyAnnColor(ctxMenu.annId!, c)}
                    />
                  ))}
                </div>
                <button className="px-2 py-1 rounded hover:bg-gray-50" onClick={() => deleteAnnotation(ctxMenu.annId!)}>删除高亮</button>
                <button className="ml-2 px-2 py-1 text-gray-500 hover:bg-gray-50" onClick={() => setCtxMenu({ show: false, x: 0, y: 0, annId: null })}>取消</button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: 批注侧栏 */}
        <div className="relative">
          <div ref={notesPaneRef} className="absolute inset-0 overflow-auto p-3">
            <div className="relative" style={{ height: sidebarHeight || 0 }}>
              {annos.map((a) => {
                const pos = noteLayout.find((x) => x.id === a.id)?.top ?? 0;
                return (
                  <div key={`note-${a.id}`} className="absolute left-0 right-0" style={{ top: pos }}>
                    <div className="absolute -left-4 top-3 w-3 h-[1px] bg-gray-300" />
                    <div className="bg-white/95 border border-indigo-100 rounded-lg shadow-sm p-2 text-xs leading-5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-block w-3 h-3 rounded-full border" style={{ background: a.color }} />
                        <span className="text-gray-500">批注</span>
                        <button className="ml-auto text-gray-400 hover:text-gray-600" title="删除" onClick={() => deleteAnnotation(a.id)}>×</button>
                      </div>
                      <div className="text-gray-800 whitespace-pre-wrap">{a.note || "（无备注）"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 备注编辑弹窗（固定在视口，避免打断选区） */}
      {noteEditor.show && (
        <div
          data-floating-ui
          className="fixed z-40 bg-white border shadow-xl rounded p-3 w-[min(380px,90%)]"
          style={{ left: noteEditor.x, top: noteEditor.y, transform: "translate(-50%, 8px)" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="text-sm text-gray-600 mb-2">给当前高亮添加备注</div>
          <textarea
            className="w-full h-24 border rounded p-2 text-sm"
            value={noteEditor.text}
            onChange={(e) => setNoteEditor((s) => ({ ...s, text: e.target.value }))}
            placeholder="写点想法、问题或待办…"
          />
          <div className="mt-2 flex items-center gap-2">
            <button className="px-3 py-1 rounded bg-black text-white text-sm" onClick={() => doAddAnnotation(noteEditor.text)}>保存</button>
            <button className="px-3 py-1 rounded border text-sm" onClick={() => setNoteEditor({ show: false, x: 0, y: 0, text: "" })}>取消</button>
          </div>
        </div>
      )}

      {/* LLM 弹窗 */}
      {llmOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center" onClick={() => setLlmOpen(false)}>
          <div className="bg-white w-[min(760px,92%)] max-h-[80%] overflow-auto rounded-2xl shadow-2xl p-4 border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center mb-3">
              <div className="font-semibold text-lg">本地 LLM 对话</div>
              <div className="ml-auto">
                <button className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 rounded" onClick={() => setLlmOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="space-y-3">
              <div className="max-h-64 overflow-auto space-y-2">
                {chat.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? "text-sm p-2 rounded bg-indigo-50" : "text-sm p-2 rounded bg-gray-50"}>
                    <div className="text-xs text-gray-500 mb-1">{m.role === 'user' ? "你" : "助手"}</div>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  </div>
                ))}
                {llmLoading && <div className="text-sm text-gray-500">思考中…</div>}
              </div>
              <textarea
                className="w-full h-28 border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="在这里编辑你的提问，支持粘贴当前选中内容"
              />
              <div className="flex items-center justify-end gap-2">
                <button className="px-3 py-1 rounded border text-sm" onClick={() => setLlmOpen(false)}>取消</button>
                <button className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-60" disabled={llmLoading} onClick={sendLLM}>发送</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}