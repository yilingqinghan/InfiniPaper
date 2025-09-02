// The new file content begins here
"use client";

import React from "react";
import { createPortal } from "react-dom";
import Head from "next/head";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import { getByPaper, upsertByPaper, exportMarkdown } from "@/lib/richNoteApi";
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
    // 跳过纯空白/换行，避免空行整行着色
    const slice = (seg.node.nodeValue || '').slice(L - seg.start, R - seg.start);
    if (!slice || slice.trim() === '') {
      return; // 跳过纯空白/换行，避免空行整行着色
    }
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
  const [bubble, setBubble] = React.useState<{show:boolean; text:string; type:'info'|'error'}>({
    show: false, text: '', type: 'info'
  });
  const showBubble = (text: string, type: 'info'|'error'='info') => {
    setBubble({ show: true, text, type });
    window.setTimeout(() => setBubble(s => ({ ...s, show: false })), 2500);
  };
  // --- 笔记（Markdown 富文本）---
  const [noteOpen, setNoteOpen] = React.useState(false);
  // 笔记停靠：overlay=覆盖左侧PDF；float=悬浮独立滚动
  const [noteDock, setNoteDock] = React.useState<'overlay' | 'float'>('overlay');
  // 悬浮面板：左右贴边与自适应宽度
  const [floatSide, setFloatSide] = React.useState<'left' | 'right'>('left');
  const [viewportKey, setViewportKey] = React.useState(0);
  React.useEffect(() => {
    const onResize = () => setViewportKey((k) => k + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const floatStyle = React.useMemo<React.CSSProperties>(() => {
    const base: React.CSSProperties = { top: '80px', height: 'min(76vh, 900px)', overflow: 'hidden' };
    if (floatSide === 'left') {
      let left = 16, width = 680;
      try {
        const leftCol = document.querySelector('.page-col--left') as HTMLElement | null;
        if (leftCol) {
          const r = leftCol.getBoundingClientRect();
          left = Math.max(8, r.left + 8);                               // 贴左列内边 8px
          width = Math.max(520, Math.min(r.width - 16, 1200));          // 宽度不超出左列
        } else if (typeof window !== 'undefined') {
          width = Math.max(520, Math.min(window.innerWidth * 0.4 - 24, 1200));
        }
      } catch {}
      return { ...base, left: `${left}px`, width: `${width}px` };
    }
    // 右侧贴边
    return { ...base, right: '16px', width: 'clamp(680px, 56vw, 1200px)' };
  }, [floatSide, viewportKey, noteOpen]);
  const savedWinScrollRef = React.useRef<number>(0);
  // 切换停靠模式时，保留中栏/右栏的滚动位置，避免跳到底部
  const savedScrollRef = React.useRef<{ mid: number; right: number }>({ mid: 0, right: 0 });
  const switchDock = (next: 'overlay' | 'float') => {
    // 记录窗口与中栏/右栏滚动
    savedWinScrollRef.current = typeof window !== 'undefined'
      ? (window.scrollY || document.documentElement.scrollTop || 0)
      : 0;
    const host = mdContainerRef.current;
    const notes = notesPaneRef.current;
    savedScrollRef.current.mid = host?.scrollTop || 0;
    savedScrollRef.current.right = notes?.scrollTop || 0;
  
    setNoteDock(next);
  
    // 下一帧恢复（包含 window）
    requestAnimationFrame(() => {
      if (typeof window !== 'undefined') {
        try { window.scrollTo({ top: savedWinScrollRef.current, left: window.scrollX || 0, behavior: 'instant' as any }); } catch {}
      }
      const h2 = mdContainerRef.current;
      const n2 = notesPaneRef.current;
      if (h2) h2.scrollTop = savedScrollRef.current.mid;
      if (n2) n2.scrollTop = savedScrollRef.current.right;
    });
  };
  const [noteMd, setNoteMd] = React.useState<string>("");
  const [noteTab, setNoteTab] = React.useState<'edit' | 'preview'>("edit");
  const [noteSavedAt, setNoteSavedAt] = React.useState<string | null>(null);
  const noteTextRef = React.useRef<HTMLTextAreaElement | null>(null);

  // 编辑器本地草稿与保存调度
  const noteDraftRef = React.useRef<string>("");
  const saveDebounceRef = React.useRef<number | null>(null);
  const saveAbortRef = React.useRef<AbortController | null>(null);
  const [editorKey, setEditorKey] = React.useState(0); // 触发 textarea 重新挂载以刷新 defaultValue

  // --- 简易撤销/重做历史 ---
  const historyRef = React.useRef<{ v: string; s: number; e: number }[]>([]);
  const histIdxRef = React.useRef<number>(-1);
  const pushHistory = (v: string, s: number, e: number) => {
    const arr = historyRef.current;
    const idx = histIdxRef.current;
    if (idx < arr.length - 1) arr.splice(idx + 1); // 丢弃重做分支
    arr.push({ v, s, e });
    if (arr.length > 200) arr.splice(0, arr.length - 200); // 限制大小
    histIdxRef.current = arr.length - 1;
  };
  const snapshotFromTextarea = (el: HTMLTextAreaElement) => {
    pushHistory(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
  };
  const doUndo = () => {
    const el = noteTextRef.current; if (!el) return;
    if (histIdxRef.current <= 0) return;
    histIdxRef.current -= 1;
    const snap = historyRef.current[histIdxRef.current];
    el.value = snap.v; noteDraftRef.current = snap.v;
    el.setSelectionRange(snap.s, snap.e);
    updateCaretFromTextarea(el);
    queueLivePreview();
    queueSave();
  };
  const doRedo = () => {
    const el = noteTextRef.current; if (!el) return;
    if (histIdxRef.current >= historyRef.current.length - 1) return;
    histIdxRef.current += 1;
    const snap = historyRef.current[histIdxRef.current];
    el.value = snap.v; noteDraftRef.current = snap.v;
    el.setSelectionRange(snap.s, snap.e);
    updateCaretFromTextarea(el);
    queueLivePreview();
    queueSave();
  };

  // 笔记持久化相关状态（后端）
  const [noteId, setNoteId] = React.useState<number | null>(null);
  const [noteSaving, setNoteSaving] = React.useState(false);
  const [noteError, setNoteError] = React.useState<string | null>(null);

  // 实时预览（轻量节流） & 图片上传
  const [noteLive, setNoteLive] = React.useState<string>("");
  const liveDebounceRef = React.useRef<number | null>(null);
  const imgInputRef = React.useRef<HTMLInputElement | null>(null);
  const [noteCaret, setNoteCaret] = React.useState<number>(0); // 当前光标位置
  const [noteLiveDecorated, setNoteLiveDecorated] = React.useState<string>(""); // 高亮当前段落的预览

  const [cacheKey, setCacheKey] = React.useState<string | null>(null);
  const [assetsBase, setAssetsBase] = React.useState<string | null>(null);
  const [mdRel, setMdRel] = React.useState<string | null>(null);
  const [mdBase, setMdBase] = React.useState<string | null>(null);

  const PDFJS_VIEWER = process.env.NEXT_PUBLIC_PDFJS_URL || "/pdfjs/web/viewer.html";
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  const api = React.useCallback((path: string) => (apiBase ? `${apiBase}${path}` : path), [apiBase]);

  // 主题：plain（素雅）/ aurora（炫彩）
  const [theme, setTheme] = React.useState<'plain' | 'aurora'>('aurora');
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
  // 笔记分屏（布局切换：左右/上下自动）
  const noteOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const [noteLayoutMode, setNoteLayoutMode] = React.useState<'horizontal' | 'vertical'>('horizontal'); // 默认左右分屏
  const lrDraggingRef = React.useRef(false);
  const [noteSplitRatioLR, setNoteSplitRatioLR] = React.useState(0.5); // 左侧编辑区宽度占比

  const startLRDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    lrDraggingRef.current = true;
  };

  React.useEffect(() => {
    if (!noteOpen || noteLayoutMode !== 'horizontal') return;
    const onMove = (e: MouseEvent) => {
      if (!lrDraggingRef.current) return;
      const host = noteOverlayRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.min(0.85, Math.max(0.15, x / rect.width));
      setNoteSplitRatioLR(ratio);
    };
    const onUp = () => { lrDraggingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [noteOpen, noteLayoutMode]);
  // Markdown 工具函数
  const insertMd = (before: string, after = "") => {
    const el = noteTextRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const sel = noteMd.slice(start, end);
    const newText = noteMd.slice(0, start) + before + sel + after + noteMd.slice(end);
    setNoteMd(newText);
    // 维持光标位置
    requestAnimationFrame(() => {
      const pos = start + before.length + sel.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const insertAtLineStart = (prefix: string) => {
    const el = noteTextRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const lineStart = noteMd.lastIndexOf('\n', start - 1) + 1;
    const newText = noteMd.slice(0, lineStart) + prefix + noteMd.slice(lineStart);
    setNoteMd(newText);
    requestAnimationFrame(() => {
      const pos = start + prefix.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  // --- 笔记编辑器无状态保存与快捷键 ---
  const queueSave = React.useCallback(() => {
    if (saveDebounceRef.current) window.clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = window.setTimeout(async () => {
      if (!id) return;
      try {
        setNoteSaving(true);
        setNoteError(null);
        if (saveAbortRef.current) saveAbortRef.current.abort();
        const ctrl = new AbortController();
        saveAbortRef.current = ctrl;
        const saved = await upsertByPaper(api, Number(id), noteDraftRef.current || "");
        setNoteId(saved.id);
        setNoteSavedAt(new Date().toISOString());
      } catch (e: any) {
        setNoteError(e?.message || String(e));
      } finally {
        setNoteSaving(false);
      }
    }, 600);
  }, [id, api]);

  const queueLivePreview = React.useCallback(() => {
    if (liveDebounceRef.current) window.clearTimeout(liveDebounceRef.current);
    liveDebounceRef.current = window.setTimeout(() => {
      setNoteLive(noteDraftRef.current || "");
    }, 120);
  }, []);

  // 根据光标位置高亮当前编辑段落（以空行分段）
  const decorateEditingParagraph = (text: string, caret: number) => {
    if (!text) return "";
    const c = Math.max(0, Math.min(caret, text.length));
    const prevSep = text.lastIndexOf("\n\n", c - 1);
    const pStart = prevSep >= 0 ? prevSep + 2 : 0;
    const nextSep = text.indexOf("\n\n", c);
    const pEnd = nextSep >= 0 ? nextSep : text.length;
    // 避免在代码块内高亮：若 pStart 前的 ``` 为奇数次，直接返回原文
    const beforeP = text.slice(0, pStart);
    const fenceCount = (beforeP.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) return text; // 代码块中，不装饰
    const before = text.slice(0, pStart);
    const para = text.slice(pStart, pEnd);
    const after = text.slice(pEnd);
    return `${before}<span class="editing-paragraph">${para || "&nbsp;"}</span>${after}`;
  };

  const updateCaretFromTextarea = (el: HTMLTextAreaElement) => {
    const p = el.selectionStart ?? 0;
    setNoteCaret(p);
  };

  React.useEffect(() => {
    setNoteLiveDecorated(decorateEditingParagraph(noteLive || "", noteCaret));
  }, [noteLive, noteCaret]);

  // 垂直布局下：textarea 自动增高，预览紧随其后
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    const h = Math.min(800, Math.max(120, el.scrollHeight));
    el.style.height = h + 'px';
  };
  React.useEffect(() => {
    if (noteLayoutMode === 'vertical' && noteTextRef.current) {
      autoGrow(noteTextRef.current);
    }
  }, [editorKey, noteLayoutMode]);

  // 编辑器挂载时，捕获初始历史快照
  React.useEffect(() => {
    const el = noteTextRef.current;
    if (el) requestAnimationFrame(() => snapshotFromTextarea(el));
  }, [editorKey]);

  const applyWrapDirect = (el: HTMLTextAreaElement, before: string, after = "") => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const val = el.value;
    const sel = val.slice(start, end);
    const next = val.slice(0, start) + before + sel + after + val.slice(end);
    el.value = next;
    noteDraftRef.current = next;
    const pos = start + before.length + sel.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      updateCaretFromTextarea(el);
    });
    queueLivePreview();
    queueSave();
    snapshotFromTextarea(el);
  };

  const applyLinePrefixDirect = (el: HTMLTextAreaElement, prefix: string) => {
    const start = el.selectionStart ?? 0;
    const val = el.value;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const next = val.slice(0, lineStart) + prefix + val.slice(lineStart);
    el.value = next;
    noteDraftRef.current = next;
    requestAnimationFrame(() => {
      const pos = start + prefix.length;
      el.focus();
      el.setSelectionRange(pos, pos);
      updateCaretFromTextarea(el);
    });
    queueLivePreview();
    queueSave();
    snapshotFromTextarea(el);
  };

  const applyUnorderedListDirect = (el: HTMLTextAreaElement) => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const val = el.value;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    let endIdx = val.indexOf('\n', end);
    if (endIdx === -1) endIdx = val.length;
    const block = val.slice(lineStart, endIdx);
    const lines = block.split('\n');
    const mod = lines.map(l => {
      if (!l.trim()) return l; // 保留空行
      return l.startsWith('- ') ? l : `- ${l}`;
    }).join('\n');
    const next = val.slice(0, lineStart) + mod + val.slice(endIdx);
    el.value = next;
    noteDraftRef.current = next;
    requestAnimationFrame(() => { updateCaretFromTextarea(el); });
    queueLivePreview();
    queueSave();
    snapshotFromTextarea(el);
  };

  const applyOrderedListDirect = (el: HTMLTextAreaElement) => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const val = el.value;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    let endIdx = val.indexOf('\n', end);
    if (endIdx === -1) endIdx = val.length;
    const block = val.slice(lineStart, endIdx);
    const lines = block.split('\n');
    let idx = 1;
    const mod = lines.map(l => {
      if (!l.trim()) return l;
      const stripped = l.replace(/^\s*\d+\.\s+/, '');
      return `${idx++}. ${stripped}`;
    }).join('\n');
    const next = val.slice(0, lineStart) + mod + val.slice(endIdx);
    el.value = next;
    noteDraftRef.current = next;
    requestAnimationFrame(() => { updateCaretFromTextarea(el); });
    queueLivePreview();
    queueSave();
    snapshotFromTextarea(el);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = noteTextRef.current;
    if (!el) return;
    const mod = e.metaKey || e.ctrlKey; // Cmd/Ctrl
    const opt = e.altKey;               // Option/Alt
    const sh = e.shiftKey;              // Shift
    if (!mod) return;
    const k = e.key.toLowerCase();

    // --- 撤销/重做 ---
    if (k === 'z' && !sh) { e.preventDefault(); doUndo(); return; }
    if ((k === 'z' && sh) || k === 'y') { e.preventDefault(); doRedo(); return; }

    // --- 常用包裹 ---
    if (!opt && !sh && k === 'b') { e.preventDefault(); applyWrapDirect(el, '**', '**'); return; }
    if (!opt && !sh && k === 'i') { e.preventDefault(); applyWrapDirect(el, '*', '*'); return; }
    if (!opt && !sh && k === 'k') { e.preventDefault();
      const start = el.selectionStart ?? 0; const end = el.selectionEnd ?? 0; const sel = el.value.slice(start, end) || '文本';
      const before = `[${sel}](链接)`; const next = el.value.slice(0, start) + before + el.value.slice(end);
      el.value = next; noteDraftRef.current = next; queueLivePreview(); queueSave();
      const linkStart = start + before.indexOf('链接'); const linkEnd = linkStart + 2;
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(linkStart, linkEnd); updateCaretFromTextarea(el); });
      snapshotFromTextarea(el);
      return;
    }
    if (!opt && !sh && k === '1') { e.preventDefault(); applyLinePrefixDirect(el, '# '); return; }
    if (!opt && !sh && k === '2') { e.preventDefault(); applyLinePrefixDirect(el, '## '); return; }
    if (!opt && !sh && k === '3') { e.preventDefault(); applyLinePrefixDirect(el, '### '); return; }

    // --- 下划线（浏览器保留了 Cmd+U/View Source），使用 Cmd+Shift+U；同时尝试兜底 Cmd+U ---
    if (sh && k === 'u') { e.preventDefault(); applyWrapDirect(el, '<u>', '</u>'); return; }
    if (!sh && !opt && k === 'u') { e.preventDefault(); applyWrapDirect(el, '<u>', '</u>'); return; }

    // --- 列表：提供两套键位，避免被浏览器占用 ---
    // 无序：Cmd+Shift+8  或  Cmd+Alt+U
    if ((sh && k === '8') || (opt && k === 'u')) { e.preventDefault(); applyUnorderedListDirect(el); return; }
    // 有序：Cmd+Shift+7  或  Cmd+Alt+I
    if ((sh && k === '7') || (opt && k === 'i')) { e.preventDefault(); applyOrderedListDirect(el); return; }
  };

  const MiniToolbar: React.FC = () => {
    const el = noteTextRef.current;
    const safe = (fn: () => void) => () => { if (noteTextRef.current) fn(); };
    return (
      <div className="flex items-center gap-1 ml-2 text-sm">
        <span className="text-xs text-gray-400 mr-1">格式</span>
        <button className="px-2 py-0.5 border rounded hover:bg-gray-50" onClick={safe(() => applyWrapDirect(noteTextRef.current!, '**', '**'))}>B</button>
        <button className="px-2 py-0.5 border rounded hover:bg-gray-50" onClick={safe(() => applyWrapDirect(noteTextRef.current!, '*', '*'))}>I</button>
        <button className="px-2 py-0.5 border rounded hover:bg-gray-50" onClick={safe(() => applyWrapDirect(noteTextRef.current!, '<u>', '</u>'))}>U</button>
        <button className="px-2 py-0.5 border rounded hover:bg-gray-50" onClick={safe(() => {
          const el = noteTextRef.current!; const s = el.selectionStart ?? 0; const e = el.selectionEnd ?? 0;
          const sel = el.value.slice(s, e) || '文本';
          const before = `[${sel}](链接)`; const next = el.value.slice(0, s) + before + el.value.slice(e);
          el.value = next; noteDraftRef.current = next; queueLivePreview(); queueSave();
          const linkStart = s + before.indexOf('链接'); const linkEnd = linkStart + 2;
          requestAnimationFrame(() => { el.focus(); el.setSelectionRange(linkStart, linkEnd); updateCaretFromTextarea(el); });
          snapshotFromTextarea(el);
        })}>Link</button>
        <button className="px-2 py-0.5 border rounded hover:bg-gray-50" onClick={safe(() => applyUnorderedListDirect(noteTextRef.current!))}>• 列表</button>
        <button className="px-2 py-0.5 border rounded hover:bg-gray-50" onClick={safe(() => applyOrderedListDirect(noteTextRef.current!))}>1. 列表</button>
        <button className="px-2 py-0.5 border rounded hover:bg-gray-50" onClick={safe(() => handlePickImage())}>图</button>
      </div>
    );
  };

  const exportNoteAsMd = () => {
    try {
      const name = `paper-${id || 'note'}.md`;
      const blob = new Blob([noteMd || ""], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {}
  };
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

  React.useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setNoteError(null);
        const got = await getByPaper(api, Number(id));
        if (got) { setNoteMd(got.content || ""); setNoteId(got.id); }
        else { setNoteMd(""); setNoteId(null); }
        noteDraftRef.current = got ? (got.content || "") : "";
        setNoteLive(noteDraftRef.current);
        setEditorKey((k) => k + 1);
      } catch (e: any) { setNoteError(e?.message || String(e)); }
    })();
  }, [id, api]);

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
        if (gemOpen) return;
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

  // === Gemini 对接（通过后端 /api/v1/gemini/ask）===
  const [gemOpen, setGemOpen] = React.useState(false);
  const [gemDock, setGemDock] = React.useState<'sidebar' | 'modal'>('sidebar'); // 默认借用右侧栏
  const [gemLoading, setGemLoading] = React.useState(false);
  const [gemChat, setGemChat] = React.useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [gemPrompt, setGemPrompt] = React.useState('');
  const [gemEditText, setGemEditText] = React.useState(''); // 可编辑的“最后回复”，用于保存为批注

  const askGemini = () => {
    if (!selPayload) return;
    const q = `请基于以下摘录进行解释/总结，并指出关键点，中文回答：\n\n${selPayload.quote}`;
    setGemOpen(true);
    setGemPrompt(q);     // 先允许编辑
    setGemChat([]);
    setGemEditText('');
  };

  const sendGemini = async (override?: string) => {
    const text = (override ?? gemPrompt).trim();
    if (!text) return;
    setGemLoading(true);
    setGemChat((c) => [...c, { role: 'user', text }]);
    try {
      const r = await fetch(api(`/api/v1/gemini/ask`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, context: `Paper #${id}` }),
      });
  
      if (!r.ok) {
        const t = await r.text();
        // 针对网路/超时/502，不把原文打印到会话，改为气泡提示
        if (r.status === 502 || /Read timed out|timeout/i.test(t)) {
          showBubble("网络波动或服务繁忙，请稍后再试", "error");
        } else {
          showBubble(`服务暂不可用（${r.status}）`, "error");
        }
        // 给出一条简短的助手提示（可选：也可以不追加）
        setGemChat((c) => [...c, { role: 'assistant', text: "（暂时无法获取回复，请稍后重试）" }]);
      } else {
        const data = await r.json();
        const atext = data?.text || "(空)";
        setGemChat((c) => [...c, { role: 'assistant', text: atext }]);
        setGemEditText(atext); // 同步到“保存为批注”可编辑区
      }
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (/timed out|timeout|Failed to fetch|NetworkError/i.test(msg)) {
        showBubble("网络波动或服务繁忙，请稍后再试", "error");
      } else {
        showBubble("请求失败，请稍后重试", "error");
      }
      setGemChat((c) => [...c, { role: 'assistant', text: "（暂时无法获取回复，请稍后重试）" }]);
    } finally {
      setGemLoading(false);
    }
  };

  // === ChatGPT Bridge（Chrome 扩展控制 chat.openai.com）===
  // 构造要发送到 ChatGPT 的问题（含选区与上下文）
  const buildChatGPTQuestion = React.useCallback(() => {
    const quote = selPayload?.quote?.trim() || "";
    const prefix = quote ? `请基于以下摘录进行解释/总结，并指出关键点：\n\n${quote}\n\n` : "";
    const ctx = id ? `（来源：Paper #${id}）` : "";
    return `${prefix}${ctx}`.trim();
  }, [selPayload, id]);

  // 触发 Chrome 扩展：把问题发到已打开的 ChatGPT 标签页并自动发送
  const askChatGPT = React.useCallback(() => {
    const text = buildChatGPTQuestion();
    if (!text) return;
    try {
      // 方案A：自定义事件（content-bridge.js 监听 INFINIPAPER_ASK_CHATGPT）
      window.dispatchEvent(new CustomEvent("INFINIPAPER_ASK_CHATGPT", { detail: { text } }));
      // 方案B：postMessage（content-bridge.js 也兼容）
      window.postMessage({ source: "InfiniPaper", type: "ASK_CHATGPT", text }, "*");
    } catch {}
  }, [buildChatGPTQuestion]);

  // 备注编辑弹窗优化
  const annoTextRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [noteEditor, setNoteEditor] = React.useState<{ show: boolean; x: number; y: number }>({ show: false, x: 0, y: 0 });
  // 图片上传相关
  const uploadImage = async (file: File) => {
    if (!id) throw new Error("paper id missing");
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(api(`/api/v1/richnotes/by-paper/${id}/images`), { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    return (data.url as string) || "";
  };

  const handlePickImage = () => imgInputRef.current?.click();

  const onImageChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!f) return;
    try {
      const url = await uploadImage(f);
      const el = noteTextRef.current;
      if (el) {
        const snippet = `![${f.name}](${url})`;
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const val = el.value;
        const next = val.slice(0, start) + snippet + val.slice(end);
        el.value = next;
        noteDraftRef.current = next;
        queueLivePreview();
        queueSave();
        const pos = start + snippet.length;
        requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
      }
    } catch (err: any) {
      setNoteError(err?.message || String(err));
    }
  };
  // 弹出备注编辑器
  const openNoteEditor = () => {
    if (!selectionBox.show) return;
    const host = mdContainerRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const absX = hostRect.left + selectionBox.x;
    const absY = hostRect.top + selectionBox.y;
    setNoteEditor({ show: true, x: absX, y: absY });
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
    setNoteEditor({ show: false, x: 0, y: 0 });
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
    <div className="h-screen w-screen flex flex-col" data-theme={theme}>
      <Head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-light.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css" />
        <link rel="stylesheet" href="/css/reader.css" />
      </Head>

      <div className="flex items-center gap-3 px-3 py-2 border-b bg-gradient-to-r from-white to-indigo-50/30 page-header">
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
          <span className="mx-2 text-gray-300">|</span>
          <span className="text-xs text-gray-500">主题</span>
          <button
            className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
            onClick={() => setTheme((t) => (t === 'aurora' ? 'plain' : 'aurora'))}
          >{theme === 'aurora' ? '素雅' : '炫彩'}</button>
          <span className="mx-2 text-gray-300">|</span>
          <span className="text-xs text-gray-500">笔记</span>
          <button
            className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
            onClick={() => { setNoteOpen((s) => { const nxt = !s; if (!s && noteTextRef.current) { /* opening */ setEditorKey((k)=>k+1); } return nxt; }); }}
          >{noteOpen ? '关闭' : '打开'}</button>
          {noteSaving && <span className="text-[11px] text-indigo-600">保存中…</span>}
          {noteSavedAt && !noteSaving && (
            <span className="text-[11px] text-gray-400">已保存 {new Date(noteSavedAt).toLocaleTimeString()}</span>
          )}
          {noteError && <span className="text-[11px] text-red-500">保存失败</span>}
        </div>
      </div>

      {/* 三列布局：40% / 40% / 20% */}
      <div className="flex-1 grid page-grid" style={{ gridTemplateColumns: "40% 40% 20%" }}>
        {/* LEFT: PDF */}
        <div className="relative border-r page-col page-col--left">
          {pdfUrl ? <PdfPane fileUrl={viewerUrl} className="h-full" /> : <div className="p-6 text-gray-500">未找到 PDF 地址</div>}

            {/* 覆盖左侧PDF：overlay 模式 */}
            {noteOpen && noteDock === 'overlay' && (
              <div ref={noteOverlayRef} className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm flex flex-col note-overlay">
                {/* 顶部工具栏 */}
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-white/80">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded text-xs border bg-gray-50 text-gray-600">编辑 + 预览（{noteLayoutMode === 'horizontal' ? '左右分屏' : '上下自动'}）</span>
                    <button
                      className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                      onClick={() => { setNoteLayoutMode(noteLayoutMode === 'horizontal' ? 'vertical' : 'horizontal'); setEditorKey((k) => k + 1); }}
                    >切换为{noteLayoutMode === 'horizontal' ? '上下' : '左右'}</button>
                    {noteLayoutMode === 'horizontal' && (
                      <button className="px-2 py-1 rounded border text-sm hover:bg-gray-50" onClick={() => setNoteSplitRatioLR(0.5)}>重置分屏</button>
                    )}
                    <button
                      className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                      onClick={(e) => { (e.currentTarget as HTMLButtonElement)?.blur(); switchDock('float'); }}
                    >切到悬浮</button>
                  </div>
                  <MiniToolbar />
                  <div className="ml-auto flex items-center gap-2">
                    <button className="px-2 py-1 rounded border text-sm hover:bg-gray-50" onClick={() => exportMarkdown(api, Number(id))}>导出 .md</button>
                    <button className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-50" onClick={() => setNoteOpen(false)}>关闭</button>
                  </div>
                </div>

                {/* 内容区：与悬浮模式一致（左右/上下可切） */}
                {noteLayoutMode === 'horizontal' ? (
                  <div className="flex-1 min-h-0 flex">
                    <div className="min-w-0" style={{ width: `calc(${noteSplitRatioLR * 100}% - 6px)` }}>
                      <textarea
                        key={editorKey}
                        ref={noteTextRef}
                        defaultValue={noteDraftRef.current || noteMd}
                        onInput={(e) => {
                          const el = e.currentTarget as HTMLTextAreaElement;
                          noteDraftRef.current = el.value;
                          updateCaretFromTextarea(el);
                          queueLivePreview();
                          queueSave();
                          snapshotFromTextarea(e.currentTarget as HTMLTextAreaElement);
                        }}
                        onClick={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onKeyUp={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onSelect={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onKeyDown={handleEditorKeyDown}
                        placeholder="在此记录你的 Markdown 笔记…（自动保存到服务器；⌘B 粗体、⌘I 斜体、⌘K 链接、⌘1/2/3 标题、⌘⇧U 下划线、⌘⇧8 无序、⌘⇧7 有序、⌘Z 撤销、⌘⇧Z 重做）"
                        className="w-full h-full p-3 outline-none resize-none font-mono text-sm"
                        spellCheck={false}
                      />
                    </div>
                    <div
                      className="w-3 cursor-col-resize bg-gradient-to-r from-gray-100 to-gray-200 border-l border-r"
                      onMouseDown={startLRDrag}
                      title="拖动调整编辑/预览宽度"
                    />
                    <div className="min-w-0 flex-1 overflow-auto p-3 markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}>
                        {noteLiveDecorated || noteLive || noteDraftRef.current || ""}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="p-3 overflow-auto">
                      <textarea
                        key={editorKey}
                        ref={noteTextRef}
                        defaultValue={noteDraftRef.current || noteMd}
                        onInput={(e) => {
                          const el = e.currentTarget as HTMLTextAreaElement;
                          noteDraftRef.current = el.value;
                          updateCaretFromTextarea(el);
                          autoGrow(el);
                          queueLivePreview();
                          queueSave();
                          snapshotFromTextarea(e.currentTarget as HTMLTextAreaElement);
                        }}
                        onClick={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onKeyUp={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onSelect={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onKeyDown={handleEditorKeyDown}
                        placeholder="在此记录你的 Markdown 笔记…（自动保存到服务器；⌘B 粗体、⌘I 斜体、⌘K 链接、⌘1/2/3 标题、⌘⇧U 下划线、⌘⇧8 无序、⌘⇧7 有序、⌘Z 撤销、⌘⇧Z 重做）"
                        className="w-full outline-none resize-none font-mono text-sm"
                        style={{ height: 120 }}
                        spellCheck={false}
                      />
                    </div>
                    <div className="h-2" />
                    <div className="min-h-0 flex-1 overflow-auto p-3 markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}>
                        {noteLiveDecorated || noteLive || noteDraftRef.current || ""}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 悬浮：独立滚动的富文本编辑器（通过 Portal 固定在视口，完全不受列滚动影响） */}
            {noteOpen && noteDock === 'float' && typeof window !== 'undefined' && createPortal(
              <div
                ref={noteOverlayRef}
                className="fixed z-50 bg-white/95 border border-indigo-100 rounded-xl shadow-2xl flex flex-col note-overlay"
                style={floatStyle}
              >
                {/* 顶部工具栏（同覆盖模式） */}
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-white/80">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded text-xs border bg-gray-50 text-gray-600">编辑 + 预览（{noteLayoutMode === 'horizontal' ? '左右分屏' : '上下自动'}）</span>
                    <button
                      className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                      onClick={() => { setNoteLayoutMode(noteLayoutMode === 'horizontal' ? 'vertical' : 'horizontal'); setEditorKey((k) => k + 1); }}
                    >切换为{noteLayoutMode === 'horizontal' ? '上下' : '左右'}</button>
                    {noteLayoutMode === 'horizontal' && (
                      <button className="px-2 py-1 rounded border text-sm hover:bg-gray-50" onClick={() => setNoteSplitRatioLR(0.5)}>重置分屏</button>
                    )}
                    <button
                      className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                      onClick={() => setFloatSide((s) => (s === 'left' ? 'right' : 'left'))}
                    >{floatSide === 'left' ? '靠右' : '靠左'}</button>
                    <button
                      className="px-2 py-1 rounded border text-sm hover:bg-gray-50"
                      onClick={(e) => { (e.currentTarget as HTMLButtonElement)?.blur(); switchDock('overlay'); }}
                    >贴回左侧</button>
                  </div>
                  <MiniToolbar />
                  <div className="ml-auto flex items-center gap-2">
                    <button className="px-2 py-1 rounded border text-sm hover:bg-gray-50" onClick={() => exportMarkdown(api, Number(id))}>导出 .md</button>
                    <button className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-50" onClick={() => setNoteOpen(false)}>关闭</button>
                  </div>
                </div>

                {/* 内容区：与覆盖模式一致（左右/上下可切） */}
                {noteLayoutMode === 'horizontal' ? (
                  <div className="flex-1 min-h-0 flex">
                    <div className="min-w-0" style={{ width: `calc(${noteSplitRatioLR * 100}% - 6px)` }}>
                      <textarea
                        key={editorKey}
                        ref={noteTextRef}
                        defaultValue={noteDraftRef.current || noteMd}
                        onInput={(e) => {
                          const el = e.currentTarget as HTMLTextAreaElement;
                          noteDraftRef.current = el.value;
                          updateCaretFromTextarea(el);
                          queueLivePreview();
                          queueSave();
                          snapshotFromTextarea(e.currentTarget as HTMLTextAreaElement);
                        }}
                        onClick={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onKeyUp={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onSelect={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onKeyDown={handleEditorKeyDown}
                        placeholder="在此记录你的 Markdown 笔记…（自动保存到服务器；⌘B 粗体、⌘I 斜体、⌘K 链接、⌘1/2/3 标题、⌘⇧U 下划线、⌘⇧8 无序、⌘⇧7 有序、⌘Z 撤销、⌘⇧Z 重做）"
                        className="w-full h-full p-3 outline-none resize-none font-mono text-sm"
                        spellCheck={false}
                      />
                    </div>
                    <div
                      className="w-3 cursor-col-resize bg-gradient-to-r from-gray-100 to-gray-200 border-l border-r"
                      onMouseDown={startLRDrag}
                      title="拖动调整编辑/预览宽度"
                    />
                    <div className="min-w-0 flex-1 overflow-auto p-3 markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}>
                        {noteLiveDecorated || noteLive || noteDraftRef.current || ""}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="p-3 overflow-auto">
                      <textarea
                        key={editorKey}
                        ref={noteTextRef}
                        defaultValue={noteDraftRef.current || noteMd}
                        onInput={(e) => {
                          const el = e.currentTarget as HTMLTextAreaElement;
                          noteDraftRef.current = el.value;
                          updateCaretFromTextarea(el);
                          autoGrow(el);
                          queueLivePreview();
                          queueSave();
                          snapshotFromTextarea(e.currentTarget as HTMLTextAreaElement);
                        }}
                        onClick={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onKeyUp={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onSelect={(e) => updateCaretFromTextarea(e.currentTarget)}
                        onKeyDown={handleEditorKeyDown}
                        placeholder="在此记录你的 Markdown 笔记…（自动保存到服务器；⌘B 粗体、⌘I 斜体、⌘K 链接、⌘1/2/3 标题、⌘⇧U 下划线、⌘⇧8 无序、⌘⇧7 有序、⌘Z 撤销、⌘⇧Z 重做）"
                        className="w-full outline-none resize-none font-mono text-sm"
                        style={{ height: 120 }}
                        spellCheck={false}
                      />
                    </div>
                    <div className="h-2" />
                    <div className="min-h-0 flex-1 overflow-auto p-3 markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}>
                        {noteLiveDecorated || noteLive || noteDraftRef.current || ""}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>,
              document.body
            )}
        </div>

        {/* MIDDLE: Markdown + tools */}
        <div className="relative border-r page-col page-col--mid">
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
                <button className="px-2 py-1 text-sm hover:bg-gray-50 border rounded" onClick={askGemini}>问 Gemini</button>
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
                <button
                  className="px-2 py-1 rounded hover:bg-gray-50"
                  onClick={() => {
                    const quote = selPayload?.quote || "";
                    const text = quote ? `请基于以下摘录进行解释/总结，并指出关键点：\n\n${quote}` : "请帮我就所选内容给出解释/总结。";
                    setCtxMenu({ show: false, x: 0, y: 0, annId: null });
                    setGemDock('sidebar');
                    setGemOpen(true);
                    setGemPrompt(text);   // 允许先编辑
                    setGemChat([]);
                    setGemEditText('');
                  }}
                >
                  问 Gemini
                </button>
                <button className="ml-2 px-2 py-1 rounded hover:bg-gray-50" onClick={() => deleteAnnotation(ctxMenu.annId!)}>删除高亮</button>
                <button className="ml-2 px-2 py-1 text-gray-500 hover:bg-gray-50" onClick={() => setCtxMenu({ show: false, x: 0, y: 0, annId: null })}>取消</button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: 批注侧栏（常驻） + Gemini 悬浮窗（不遮挡列表） */}
        <div className="relative page-col page-col--right">
          {/* 常驻：批注侧栏 */}
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
                      <div className="markdown-body text-[13px]">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}>
                          {a.note || "（无备注）"}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 悬浮：Gemini 固定面板（右上，固定高度 70vh，不影响右侧列表滚动） */}
          {gemOpen && (
            <div
              className="fixed z-40 bg-white/95 border border-indigo-100 rounded-xl shadow-2xl flex flex-col"
              style={{ right: '16px', top: '80px', width: 'min(520px, 30vw)', height: '70vh' }}
            >
              <div className="px-3 py-2 border-b flex items-center gap-2">
                <div className="font-medium">Gemini 对话</div>
                <div className="text-xs text-gray-400">（悬浮窗口）</div>
                <button className="ml-auto px-2 py-1 text-xs rounded border hover:bg-gray-50" onClick={() => setGemOpen(false)}>关闭</button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto space-y-2 p-2">
                {gemChat.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? "text-sm p-2 rounded bg-indigo-50" : "text-sm p-2 rounded bg-gray-50"}>
                    <div className="text-[11px] text-gray-500 mb-1">{m.role === 'user' ? "你" : "Gemini"}</div>
                    {m.role === 'assistant' ? (
                      <div className="markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}>
                          {m.text}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{m.text}</div>
                    )}
                  </div>
                ))}
                {gemLoading && <div className="text-sm text-gray-500 px-2">思考中…</div>}
              </div>
              <div className="border-t p-2 space-y-2">
                <textarea
                  className="w-full h-20 border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  value={gemPrompt}
                  onChange={(e) => setGemPrompt(e.target.value)}
                  placeholder="在这里编辑你的提问，然后发送给 Gemini"
                />
                <div className="flex items-center justify-end gap-2">
                  <button className="px-3 py-1 rounded border text-sm" onClick={() => setGemOpen(false)}>关闭</button>
                  <button className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-60" disabled={gemLoading || !gemPrompt.trim()} onClick={() => sendGemini()}>
                    发送
                  </button>
                </div>
              </div>
              <div className="border-t p-2 space-y-2">
                <div className="text-xs text-gray-500">编辑下面的文本，点击保存可直接生成批注（使用当前选区位置）。</div>
                <textarea
                  className="w-full h-24 border rounded p-2 text-sm"
                  value={gemEditText}
                  onChange={(e) => setGemEditText(e.target.value)}
                  placeholder="这里会自动填入上一条 Gemini 回复，你可以修改后保存为批注"
                />
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-400">{selPayload ? "将保存到当前选区的批注列表" : "（无选区：无法保存为批注）"}</div>
                  <button
                    className="px-3 py-1 rounded bg-black text-white text-sm disabled:opacity-50"
                    disabled={!selPayload || !gemEditText.trim()}
                    onClick={() => doAddAnnotation(gemEditText.trim())}
                  >
                    保存为批注
                  </button>
                </div>
              </div>
            </div>
          )}
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
            ref={annoTextRef}
            placeholder="写点想法、问题或待办…"
          />
          <div className="mt-2 flex items-center gap-2">
            <button className="px-3 py-1 rounded bg-black text-white text-sm" onClick={() => doAddAnnotation(annoTextRef.current?.value || "")}>保存</button>
            <button className="px-3 py-1 rounded border text-sm" onClick={() => setNoteEditor({ show: false, x: 0, y: 0 })}>取消</button>
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
      <style jsx global>{`
        /* ---- Aurora 彩色主题 ---- */
        [data-theme="aurora"] .page-header {
          background: linear-gradient(90deg, rgba(99,102,241,.12), rgba(236,72,153,.12));
          border-bottom-color: rgba(99,102,241,.35);
          box-shadow: 0 10px 22px rgba(99,102,241,.08);
        }
        [data-theme="aurora"] .page-grid {
          background:
            radial-gradient(900px 400px at 0% -20%, rgba(99,102,241,.10), transparent 70%),
            radial-gradient(900px 400px at 100% 0%, rgba(236,72,153,.10), transparent 70%),
            linear-gradient(180deg, #fbfcff, #ffffff 50%, #fbfcff 100%);
        }
        [data-theme="aurora"] .page-col {
          backdrop-filter: blur(2px);
        }
        [data-theme="aurora"] .page-col--left {
          background: linear-gradient(180deg, rgba(59,130,246,0.05), rgba(99,102,241,0.05));
          box-shadow: inset -1px 0 0 rgba(99,102,241,.18), 0 10px 26px rgba(99,102,241,.10);
        }
        [data-theme="aurora"] .page-col--mid {
          background: linear-gradient(180deg, rgba(16,185,129,0.05), rgba(59,130,246,0.04));
          box-shadow: inset -1px 0 0 rgba(99,102,241,.12), 0 10px 26px rgba(16,185,129,.10);
        }
        [data-theme="aurora"] .page-col--right {
          background: linear-gradient(180deg, rgba(236,72,153,0.06), rgba(99,102,241,0.05));
          box-shadow: inset 1px 0 0 rgba(99,102,241,.14), 0 10px 26px rgba(236,72,153,.10);
        }
        [data-theme="aurora"] .note-overlay {
          background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(255,255,255,.92));
          box-shadow: 0 14px 46px rgba(99,102,241,.18);
        }
        [data-theme="aurora"] .page-header button {
          border-color: rgba(99,102,241,.35);
        }
        [data-theme="aurora"] .page-header button:hover {
          background: linear-gradient(90deg, rgba(99,102,241,.16), rgba(236,72,153,.16));
        }
        [data-theme="aurora"] .markdown-body code {
          background: rgba(99,102,241,.10);
          border-radius: 4px;
          padding: .1em .4em;
        }
        [data-theme="aurora"] .markdown-body pre {
          background: linear-gradient(180deg, rgba(17,24,39,.9), rgba(17,24,39,.92));
          color: #e6edf3;
          border: 1px solid rgba(99,102,241,.28);
          border-radius: 8px;
          box-shadow: 0 18px 40px rgba(2,6,23,.35);
        }
        [data-theme="aurora"] .markdown-body a {
          color: #4f46e5;
          text-decoration-color: rgba(99,102,241,.45);
        }
        [data-theme="aurora"] .markdown-body a:hover {
          color: #ec4899;
          text-decoration-color: rgba(236,72,153,.5);
        }
        [data-theme="aurora"] .markdown-body hr.body-hr {
          border: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(99,102,241,.35), transparent);
        }
        [data-theme="aurora"] .ann-mark {
          border-radius: 4px;
          box-shadow: inset 0 1px 0 rgba(0,0,0,.06);
        }
        [data-theme="aurora"] ::selection {
          background: rgba(99,102,241,.25);
        }
        .markdown-body .editing-paragraph{
          background: rgba(255, 243, 206, .65);
          border-radius: 4px;
          padding: 2px 2px;
          box-shadow: inset 0 0 0 1px rgba(255, 200, 0, .20);
        }
      `}</style>
      {bubble.show && (
    <div
        className="fixed right-4 bottom-6 z-[100] px-3 py-2 rounded-lg shadow-lg text-sm"
        style={{ background: bubble.type === 'error' ? 'rgba(220,38,38,.92)' : 'rgba(0,0,0,.82)', color: '#fff' }}
    >
        {bubble.text}
    </div>
    )}
    <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={onImageChosen} />
    </div>
  );
}