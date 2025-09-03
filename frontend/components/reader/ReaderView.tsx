"use client";

import React from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";

// APIs
import { getByPaper, upsertByPaper, exportMarkdown } from "@/lib/richNoteApi";

// 动态组件
const PdfPane = dynamic(() => import("@/components/PdfPane"), { ssr: false });
const TuiEditor: any = dynamic(
  () => import("@toast-ui/react-editor").then((m: any) => m.Editor),
  { ssr: false }
);

// 子组件
import WysiwygMdEditor from "./WysiwygMdEditor";
import MiniToolbar from "./MiniToolbar";
import MarkdownPane from "./MarkdownPane";
import TocPanel from "./TocPanel";
import GemChatItems from "./GemChatItems";

// Markdown & 高亮
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";

// 批注/装饰工具
import {
  highlightByOffsets,
  isInFloating,
  selectionToOffsets,
} from "@/components/Reading/Highlight";
import {
  decorateAuthorBlock,
  remarkCiteAnchorsAndLinks,
} from "@/components/Reading/MarkdownDecor";

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

// --- stable hash for memo key ---
function hash32(str: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// Client-only plugin loader to avoid SSR `window` reference
function useTuiPlugins() {
  const plugins = React.useMemo(() => {
    if (typeof window === "undefined") return [] as any[];
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("@toast-ui/editor-plugin-code-syntax-highlight");
      return [mod?.default || mod];
    } catch {
      return [] as any[];
    }
  }, []);
  return plugins;
}

export default function ReaderView() {
  const router = useRouter();
  const tuiPlugins = useTuiPlugins();

  // ------- 路由参数 -------
  const [id, setId] = React.useState<string | undefined>(undefined);
  const [pdfFromQuery, setPdfFromQuery] = React.useState<string>("");

  React.useEffect(() => {
    if (!router.isReady) return;
    const q = router.query || {};
    const rid =
      typeof q.id === "string" ? q.id : Array.isArray(q.id) ? q.id[0] : undefined;
    setId(rid);
    setPdfFromQuery(typeof q.pdf === "string" ? q.pdf : "");
  }, [router.isReady, router.query]);

  // ------- 基本状态 -------
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [html, setHtml] = React.useState<string | null>(null);
  const [md, setMd] = React.useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = React.useState<string>("");

  const [bubble, setBubble] = React.useState<{
    show: boolean;
    text: string;
    type: "info" | "error";
  }>({ show: false, text: "", type: "info" });
  const showBubble = (text: string, type: "info" | "error" = "info") => {
    setBubble({ show: true, text, type });
    window.setTimeout(() => setBubble((s) => ({ ...s, show: false })), 2500);
  };

  // --- 笔记（Markdown 富文本）---
  const [noteOpen, setNoteOpen] = React.useState(true);
  const [noteDock, setNoteDock] = React.useState<"overlay" | "float">("overlay");
  const [editMode, setEditMode] = React.useState<"wysiwyg" | "markdown" | "toast">(
    "wysiwyg"
  );

  // ---- Fixed-left editor bounds (match the left PDF column exactly) ----
  const [leftFixedStyle, setLeftFixedStyle] =
    React.useState<React.CSSProperties | null>(null);
  const updateLeftFixedStyle = React.useCallback(() => {
    const leftCol = document.querySelector(
      ".page-col--left"
    ) as HTMLElement | null;
    if (!leftCol || typeof window === "undefined") return;

    const colRect = leftCol.getBoundingClientRect();

    // 顶部用页头高度；当页头滚出视口时则为 0
    const headerEl = document.querySelector(".page-header") as HTMLElement | null;
    const headerRect = headerEl ? headerEl.getBoundingClientRect() : null;
    const top = Math.max(0, headerRect ? headerRect.bottom : 0);

    const height = Math.max(0, window.innerHeight - top);

    setLeftFixedStyle({
      position: "fixed",
      left: `${colRect.left}px`,
      top: `${top}px`,
      width: `${colRect.width}px`,
      height: `${height}px`,
      overflow: "hidden", // 外层不滚
      background: "white",
      zIndex: 40,
    } as React.CSSProperties);
  }, []);
  React.useEffect(() => {
    updateLeftFixedStyle();
    const onScroll = () => updateLeftFixedStyle();
    const onResize = () => updateLeftFixedStyle();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => updateLeftFixedStyle());
    const leftCol = document.querySelector(".page-col--left") as HTMLElement | null;
    if (leftCol) ro.observe(leftCol);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, [updateLeftFixedStyle, noteOpen]);

  // ---- Fixed-right overlay bounds (match the right notes column exactly) ----
  const [rightFixedStyle, setRightFixedStyle] =
    React.useState<React.CSSProperties | null>(null);
  const updateRightFixedStyle = React.useCallback(() => {
    const rightCol = document.querySelector(
      ".page-col--right"
    ) as HTMLElement | null;
    if (!rightCol || typeof window === "undefined") return;

    const colRect = rightCol.getBoundingClientRect();

    // 顶部同页头底部；滚出视口则为 0
    const headerEl = document.querySelector(".page-header") as HTMLElement | null;
    const headerRect = headerEl ? headerEl.getBoundingClientRect() : null;
    const top = Math.max(0, headerRect ? headerRect.bottom : 0);
    const height = Math.max(0, window.innerHeight - top);

    setRightFixedStyle({
      position: "fixed",
      left: `${colRect.left}px`,
      top: `${top}px`,
      width: `${colRect.width}px`,
      height: `${height}px`,
      overflow: "hidden",
      pointerEvents: "none", // 外层不拦截滚动；面板本身再开启
      zIndex: 50,
    } as React.CSSProperties);
  }, []);
  React.useEffect(() => {
    updateRightFixedStyle();
    const onScroll = () => updateRightFixedStyle();
    const onResize = () => updateRightFixedStyle();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => updateRightFixedStyle());
    const rightCol = document.querySelector(".page-col--right") as HTMLElement | null;
    if (rightCol) ro.observe(rightCol);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, [updateRightFixedStyle, noteOpen]);


  // ---- TOC ----
  const [tocOpen, setTocOpen] = React.useState(false);
  const [tocItems, setTocItems] = React.useState<
    { id: string; text: string; depth: number }[]
  >([]);
  const [tocPinned, setTocPinned] = React.useState(true);

  const slugify = React.useCallback((txt: string) => {
    return (txt || "")
      .toLowerCase()
      .trim()
      .replace(/<\/?[^>]+(>|$)/g, "")
      .replace(/[\s\W-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }, []);
  const mdContainerRef = React.useRef<HTMLDivElement | null>(null);
  const buildTocFromDom = React.useCallback(() => {
    const host = mdContainerRef.current;
    if (!host) return;
    const hs = host.querySelectorAll("h1, h2, h3, h4, h5, h6");
    const used = new Set<string>();
    const items: { id: string; text: string; depth: number }[] = [];
    hs.forEach((el) => {
      const depth = Number(el.tagName[1]) || 1;
      const text = (el.textContent || "").trim();
      let id = el.id && el.id.trim() ? el.id.trim() : "";
      if (!id) id = slugify(text);
      // ensure unique
      let uniq = id,
        i = 2;
      while (used.has(uniq) || !uniq) {
        uniq = `${id || "section"}-${i++}`;
      }
      used.add(uniq);
      if (!el.id || el.id !== uniq) el.id = uniq;
      items.push({ id: uniq, text, depth });
    });
    setTocItems(items);
  }, [slugify]);
  React.useEffect(() => {
    // Recompute TOC after markdown/html content changes and next paint
    const t = setTimeout(buildTocFromDom, 0);
    return () => clearTimeout(t);
  }, [md, html, buildTocFromDom]);

  const scrollToHeading = React.useCallback((id: string) => {
    const host = mdContainerRef.current;
    if (!host) return;

    // 用属性选择器，避免 #id 在以数字开头或含特殊字符时抛 SyntaxError
    const safeId = id.replace(/"/g, '\\"');
    const el = host.querySelector<HTMLElement>(`[id=\"${safeId}\"]`);
    if (!el) return;

    try {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch {
      // 兜底：手动计算滚动偏移
      const hostRect = host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const top = r.top - hostRect.top + host.scrollTop - 8;
      host.scrollTop = top;
    }
  }, []);

  // ------- 笔记状态 & 导出 -------
  const [noteMd, setNoteMd] = React.useState<string>("");
  const [noteSavedAt, setNoteSavedAt] = React.useState<string | null>(null);
  const noteTextRef = React.useRef<HTMLTextAreaElement | null>(null);
  const toastRef = React.useRef<any>(null);
  const toastExec = React.useCallback((cmd: string, payload?: any) => {
    const inst = toastRef.current?.getInstance?.();
    if (!inst) return;
    try {
      inst.exec(cmd, payload);
    } catch {}
  }, []);
  const toastInsert = React.useCallback((text: string) => {
    const inst = toastRef.current?.getInstance?.();
    if (!inst) return;
    try {
      inst.insertText(text);
    } catch {}
  }, []);
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

  const [noteId, setNoteId] = React.useState<number | null>(null);
  const [noteSaving, setNoteSaving] = React.useState(false);
  const [noteError, setNoteError] = React.useState<string | null>(null);

  // 实时预览（轻量节流） & 图片上传
  const [noteLive, setNoteLive] = React.useState<string>("");
  const imgInputRef = React.useRef<HTMLInputElement | null>(null);
  const [noteCaret, setNoteCaret] = React.useState<number>(0);
  const [noteLiveDecorated, setNoteLiveDecorated] = React.useState<string>("");
  const caretDebounceRef = React.useRef<number | null>(null);
  const decorateDebounceRef = React.useRef<number | null>(null);

  const [cacheKey, setCacheKey] = React.useState<string | null>(null);
  const [assetsBase, setAssetsBase] = React.useState<string | null>(null);
  const [mdRel, setMdRel] = React.useState<string | null>(null);
  const [mdBase, setMdBase] = React.useState<string | null>(null);

  // 环境
  const PDFJS_VIEWER =
    process.env.NEXT_PUBLIC_PDFJS_URL || "/pdfjs/web/viewer.html";
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  const api = React.useCallback(
    (path: string) => (apiBase ? `${apiBase}${path}` : path),
    [apiBase]
  );

  // 主题/字体
  const [theme, setTheme] = React.useState<"plain" | "aurora" | "immersive">(
    "immersive"
  );
  const [mdFont, setMdFont] = React.useState(16);
  const incFont = () => setMdFont((s) => Math.min(22, s + 1));
  const decFont = () => setMdFont((s) => Math.max(14, s - 1));
  const gridCols = theme === "immersive" ? "34% 46% 20%" : "40% 40% 20%";

  const viewerUrl = React.useMemo(() => {
    if (!pdfUrl) return "";
    const abs = /^https?:\/\//i.test(pdfUrl)
      ? pdfUrl
      : `${typeof window !== "undefined" ? window.location.origin : ""}${pdfUrl}`;
    return `${PDFJS_VIEWER}?file=${encodeURIComponent(abs)}#zoom=page-width`;
  }, [pdfUrl, PDFJS_VIEWER]);

  // 笔记保存/导出
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

  const exportNow = React.useCallback(async () => {
    if (!id) return;
    try {
      if (saveDebounceRef.current) {
        window.clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      setNoteSaving(true);
      setNoteError(null);
      if (saveAbortRef.current) saveAbortRef.current.abort();
      const ctrl = new AbortController();
      saveAbortRef.current = ctrl;
      await upsertByPaper(api, Number(id), noteDraftRef.current || "");
    } catch (e: any) {
      setNoteError(e?.message || String(e));
    } finally {
      setNoteSaving(false);
    }
    await exportMarkdown(api, Number(id));
  }, [id, api]);

  const updateCaretFromTextarea = (el: HTMLTextAreaElement) => {
    const p = el.selectionStart ?? 0;
    if (caretDebounceRef.current) window.clearTimeout(caretDebounceRef.current);
    caretDebounceRef.current = window.setTimeout(() => setNoteCaret(p), 80);
  };

  React.useEffect(() => {
    if (decorateDebounceRef.current) window.clearTimeout(decorateDebounceRef.current);
    decorateDebounceRef.current = window.setTimeout(() => {
      const src = noteLive || "";
      if (src.length > 20000) {
        setNoteLiveDecorated(src);
      } else {
        // 高亮当前段落
        const c = Math.max(0, Math.min(noteCaret, src.length));
        const prevSep = src.lastIndexOf("\\n\\n", c - 1);
        const pStart = prevSep >= 0 ? prevSep + 2 : 0;
        const nextSep = src.indexOf("\\n\\n", c);
        const pEnd = nextSep >= 0 ? nextSep : src.length;
        const beforeP = src.slice(0, pStart);
        const fenceCount = (beforeP.match(/```/g) || []).length;
        if (fenceCount % 2 === 1) {
          setNoteLiveDecorated(src);
        } else {
          const before = src.slice(0, pStart);
          const para = src.slice(pStart, pEnd);
          const after = src.slice(pEnd);
          setNoteLiveDecorated(
            `${before}<span class=\"editing-paragraph\">${para || "&nbsp;"}</span>${after}`
          );
        }
      }
    }, 120);
  }, [noteLive, noteCaret]);

  React.useEffect(() => {
    const el = noteTextRef.current;
    if (el) requestAnimationFrame(() => snapshotFromTextarea(el));
  }, [editorKey]);

  // 图片上传
  const uploadImage = async (file: File) => {
    if (!id) throw new Error("paper id missing");
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(api(`/api/v1/richnotes/by-paper/${id}/images`), {
      method: "POST",
      body: fd,
    });
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
      const snippet = `![${f.name}](${url})`;
      if (!noteTextRef.current) {
        window.dispatchEvent(
          new CustomEvent("IP_WYSIWYG_INSERT_TEXT", { detail: { text: snippet } })
        );
        return;
      }
      const el = noteTextRef.current;
      if (el) {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const val = el.value;
        const next = val.slice(0, start) + snippet + val.slice(end);
        el.value = next;
        noteDraftRef.current = next;
        queueSave();
        const pos = start + snippet.length;
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(pos, pos);
        });
      }
    } catch (err: any) {
      setNoteError(err?.message || String(err));
    }
  };

  // ------- PDF 地址 & MinerU 解析 -------
  const buildPdfUrls = React.useCallback(
    (raw: string) => {
      let viewer = "";
      let backend = "";
      if (!raw) return { viewer, backend };
      if (/^https?:\/\//i.test(raw)) viewer = raw;
      else if (raw.startsWith("/")) viewer = `${window.location.origin}${raw}`;
      else viewer = raw;

      if (/^https?:\/\//i.test(raw)) backend = raw;
      else if (raw.startsWith("/files/"))
        backend = `${apiBase || "http://127.0.0.1:8000"}${raw}`;
      else backend = raw;
      return { viewer, backend };
    },
    [apiBase]
  );

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

  React.useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setNoteError(null);
        const got = await getByPaper(api, Number(id));
        if (got) {
          setNoteMd(got.content || "");
          setNoteId(got.id);
        } else {
          setNoteMd("");
          setNoteId(null);
        }
        noteDraftRef.current = got ? got.content || "" : "";
        setNoteLive(noteDraftRef.current);
        setEditorKey((k) => k + 1);
      } catch (e: any) {
        setNoteError(e?.message || String(e));
      }
    })();
  }, [id, api]);

  const [cacheReady, setCacheReady] = React.useState(false);
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
        setCacheReady(true);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pdfFromQuery, buildPdfUrls, api]);

  // ------- 批注 -------
  const [annos, setAnnos] = React.useState<Ann[]>([]);
  const notesPaneRef = React.useRef<HTMLDivElement | null>(null);
  const [selectionBox, setSelectionBox] = React.useState<{
    x: number;
    y: number;
    show: boolean;
  }>({ x: 0, y: 0, show: false });
  const [selPayload, setSelPayload] = React.useState<{
    start: number;
    end: number;
    quote: string;
  } | null>(null);
  const [pickedColor, setPickedColor] = React.useState<string>("#FFE58F");

  const [ctxMenu, setCtxMenu] = React.useState<{
    show: boolean;
    x: number;
    y: number;
    annId: string | null;
  }>({ show: false, x: 0, y: 0, annId: null });

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
            list.forEach((a) =>
              highlightByOffsets(
                box,
                a.anchor.start,
                a.anchor.end,
                a.id,
                a.color
              )
            );
            computeSidebarLayout(); // 恢复后计算侧栏
          }, 0);
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, md]);

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
      setSelectionBox({
        x: rect.left - host.left + rect.width / 2,
        y: rect.top - host.top - 8,
        show: true,
      });
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
      const r = e as MouseEvent;
      const hostRect = host.getBoundingClientRect();
      setCtxMenu({
        show: true,
        x: r.clientX - hostRect.left,
        y: r.clientY - hostRect.top,
        annId: mark.dataset.annId || null,
      });
      setSelectionBox((s) => ({ ...s, show: false }));
    };

    const onScrollOrResize = () => {
      recomputeLayout();
      const host = mdContainerRef.current;
      const notes = notesPaneRef.current;
      if (host && notes && Math.abs(notes.scrollTop - host.scrollTop) > 1) {
        if (gemOpen) return;
        notes.scrollTop = host.scrollTop; // 同步滚动
      }
    };

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
  const [noteLayout, setNoteLayout] = React.useState<{ id: string; top: number }[]>(
    []
  );
  const computeSidebarLayout = React.useCallback(() => {
    const host = mdContainerRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const arr: { id: string; top: number }[] = [];
    annos.forEach((a) => {
      const el = host.querySelector<HTMLElement>(`[data-ann-id=\"${a.id}\"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = r.top - hostRect.top + host.scrollTop;
      arr.push({ id: a.id, top: Math.max(0, top) });
    });
    setNoteLayout(arr);
    setSidebarHeight(host.scrollHeight);
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

  // 弹出“添加备注”编辑器
  const annoTextRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [noteEditor, setNoteEditor] = React.useState<{
    show: boolean;
    x: number;
    y: number;
  }>({ show: false, x: 0, y: 0 });
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
        body: JSON.stringify({
          id: annId,
          paper_id: Number(id),
          anchor: selPayload,
          note,
          color,
        }),
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

  const applyAnnColor = async (annId: string, color: string) => {
    const host = mdContainerRef.current;
    if (!host) return;
    host
      .querySelectorAll<HTMLElement>(`[data-ann-id=\"${annId}\"]`)
      .forEach((el) => (el.style.background = color));
    setAnnos((list) => list.map((x) => (x.id === annId ? { ...x, color } : x)));
    try {
      await fetch(api(`/api/v1/annotations/${id}/${annId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
    } catch {}
    setCtxMenu({ show: false, x: 0, y: 0, annId: null });
  };

  const deleteAnnotation = async (annId: string) => {
    const host = mdContainerRef.current;
    if (host) {
      host.querySelectorAll<HTMLElement>(`[data-ann-id=\"${annId}\"]`).forEach((el) => {
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

  // ------- LLM / Gemini -------
  const [llmOpen, setLlmOpen] = React.useState(false);
  const [llmLoading, setLlmLoading] = React.useState(false);
  const [chat, setChat] = React.useState<{ role: "user" | "assistant"; text: string }[]>(
    []
  );
  const [promptText, setPromptText] = React.useState("");
  const askLLM = () => {
    if (!selPayload) return;
    setLlmOpen(true);
    setPromptText(`请基于以下摘录进行解释/总结，并指出关键点：\\n\\n${selPayload.quote}`);
    setChat([]);
    setLlmLoading(false);
  };
  const sendLLM = async () => {
    if (!promptText.trim()) return;
    setLlmLoading(true);
    setChat((c) => [...c, { role: "user", text: promptText }]);
    try {
      const r = await fetch(api(`/api/v1/llm/ask`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText, context: `Paper #${id}` }),
      });
      if (!r.ok) {
        const t = await r.text();
        setChat((c) => [
          ...c,
          { role: "assistant", text: `服务错误：${r.status} ${t}` },
        ]);
      } else {
        const data = await r.json();
        setChat((c) => [...c, { role: "assistant", text: data?.text || "(空)" }]);
      }
    } catch (e: any) {
      setChat((c) => [...c, { role: "assistant", text: `调用失败：${e?.message || e}` }]);
    } finally {
      setLlmLoading(false);
    }
  };

  const [gemOpen, setGemOpen] = React.useState(false);
  const [gemDock, setGemDock] = React.useState<"sidebar" | "modal">("sidebar");
  const [gemLoading, setGemLoading] = React.useState(false);
  const [gemChat, setGemChat] = React.useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [gemPrompt, setGemPrompt] = React.useState("");
  const [gemEditText, setGemEditText] = React.useState("");
  const gemPromptRef = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => {
    updateRightFixedStyle();
  }, [gemOpen, updateRightFixedStyle]);

  const askGemini = () => {
    if (!selPayload) return;
    const q = `请基于以下摘录进行解释/总结，并指出关键点，中文回答：\n\n${selPayload.quote}`;
    setGemOpen(true);
    setGemDock("modal");   // ⬅️ 新增：默认用弹窗，避免撑高右栏
    setGemPrompt(q);
    setGemChat([]);
    setGemEditText("");
  };
  const sendGemini = async (override?: string) => {
    const text = (override ?? gemPromptRef.current?.value ?? gemPrompt).trim();
    if (!text) return;
    setGemLoading(true);
    setGemChat((c) => [...c, { role: "user", text }]);
    try {
      const r = await fetch(api(`/api/v1/gemini/ask`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, context: `Paper #${id}` }),
      });

      if (!r.ok) {
        const t = await r.text();
        if (r.status === 502 || /Read timed out|timeout/i.test(t)) {
          showBubble("网络波动或服务繁忙，请稍后再试", "error");
        } else {
          showBubble(`服务暂不可用（${r.status}）`, "error");
        }
        setGemChat((c) => [
          ...c,
          { role: "assistant", text: "（暂时无法获取回复，请稍后重试）" },
        ]);
      } else {
        const data = await r.json();
        const atext = data?.text || "(空)";
        setGemChat((c) => [...c, { role: "assistant", text: atext }]);
        setGemEditText(atext);
      }
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (/timed out|timeout|Failed to fetch|NetworkError/i.test(msg)) {
        showBubble("网络波动或服务繁忙，请稍后再试", "error");
      } else {
        showBubble("请求失败，请稍后重试", "error");
      }
      setGemChat((c) => [
        ...c,
        { role: "assistant", text: "（暂时无法获取回复，请稍后重试）" },
      ]);
    } finally {
      setGemLoading(false);
    }
  };

  // ------- Markdown 渲染块（带行位置线） -------
  const markdownView = React.useMemo(() => {
    if (html) {
      return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    if (md) {
      return (
        <article key={`md-${hash32(md)}`} className="markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, remarkCiteAnchorsAndLinks]}
            rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}
          >
            {md}
          </ReactMarkdown>
        </article>
      );
    }
    return null;
  }, [html, md]);

  // ------- 首屏图片/字体/KaTeX加载后重算侧栏定位 -------
  React.useEffect(() => {
    const host = mdContainerRef.current;
    if (!host) return;

    const ro = new ResizeObserver(() => recomputeLayout());
    ro.observe(host);

    const imgs = host.querySelectorAll("img");
    const onImgLoad = () => recomputeLayout();
    imgs.forEach((img) => img.addEventListener("load", onImgLoad));

    const t1 = setTimeout(recomputeLayout, 200);
    const t2 = setTimeout(recomputeLayout, 800);

    return () => {
      ro.disconnect();
      imgs.forEach((img) => img.removeEventListener("load", onImgLoad));
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [md, recomputeLayout]);

  return (
    <div className="h-screen w-screen flex flex-col" data-theme={theme} suppressHydrationWarning>
      <Head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
        <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@toast-ui/editor/dist/toastui-editor.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@toast-ui/editor-plugin-code-syntax-highlight/dist/toastui-editor-plugin-code-syntax-highlight.min.css" />
        <script defer src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js"></script>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-light.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css" />
        <link rel="stylesheet" href="/css/reader.css" />
        <style>{`
          .note-textarea { padding-bottom: 24vh !important; }
          .ip-underline { text-decoration: underline; }
          .ip-bold { font-weight: 600; }
          .ip-italic { font-style: italic; }
          .ip-strike { text-decoration: line-through; }
          .toastui-editor-contents::after { content: ""; display: block; height: 24vh; }
          .ip-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background:#f6f8fa; padding:0 .2em; border-radius:3px; }
          .ip-link { text-decoration: underline; }
          .ip-math-inline { display: inline-block; vertical-align: middle; }
          .ip-math-block { display: block; margin: .5rem 0; }
          .ip-math-inline .math-raw { display: none; }
          .ip-math-block .math-raw { display: none; }
          .ip-editor-root::after { content: ""; display: block; height: 24vh; }
          .editing-paragraph .ip-math-inline .katex-view { display: none; }
          .editing-paragraph .ip-math-inline .math-raw { display: inline; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
          .editing-paragraph .ip-math-block .katex-view { display: none; }
          .editing-paragraph .ip-math-block .math-raw { display: block; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
          .editing-paragraph strong::before, .editing-paragraph strong::after { content: "**"; opacity: .6; }
          .editing-paragraph em::before, .editing-paragraph em::after { content: "*"; opacity: .6; }
          .editing-paragraph del::before, .editing-paragraph del::after { content: "~~"; opacity: .6; }
          .editing-paragraph code:not(pre code)::before,
          .editing-paragraph code:not(pre code)::after { content: "\x0060"; opacity: .7; }
          .editing-paragraph pre::before { content: "\x0060\x0060\x0060"; display: block; opacity: .7; }
          .editing-paragraph pre::after { content: "\x0060\x0060\x0060"; display: block; opacity: .7; }
        `}</style>
      </Head>

      {/* 顶部栏 */}
      <div className="flex items-center gap-3 px-3 py-2 border-b bg-gradient-to-r from-white to-indigo-50/30 page-header">
        <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => router.back()}>
          返回
        </button>
        <div className="text-sm text-gray-500">{id ? `Paper #${id}` : "文档"} · {loading ? "解析中…" : "已加载"}</div>
        {err && <div className="text-red-600 text-sm ml-4">错误：{err}</div>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400 mr-2">MinerU 对照阅读</span>
          <span className="text-xs text-gray-500">字体</span>
          <button className="px-2 py-1 rounded border text-xs hover:bg-gray-50" onClick={decFont}>A-</button>
          <button className="px-2 py-1 rounded border text-xs hover:bg-gray-50" onClick={incFont}>A+</button>
          <span className="mx-2 text-gray-300">|</span>
          <span className="text-xs text-gray-500">主题</span>
          <button className="px-2 py-1 rounded border text-xs hover:bg-gray-50" onClick={() => setTheme((t) => (t === 'immersive' ? 'aurora' : 'immersive'))}>
            {theme === 'aurora' ? '素雅' : '炫彩'}
          </button>
          <button className="px-2 py-1 rounded border text-xs hover:bg-gray-50" onClick={() => setTheme((t) => (t === 'immersive' ? 'aurora' : 'immersive'))}>
            {theme === 'immersive' ? '退出沉浸' : '沉浸'}
          </button>
          <span className="mx-2 text-gray-300">|</span>
          <button className="px-2 py-1 rounded border text-xs hover:bg-gray-50" onClick={() => setTocOpen(o => !o)} title="显示/隐藏目录">目录</button>
          <span className="mx-2 text-gray-300">|</span>
          <span className="text-xs text-gray-500">笔记</span>
          <button
            className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
            onClick={() => {
              setNoteOpen((s) => {
                const nxt = !s;
                if (!s && noteTextRef.current) setEditorKey((k) => k + 1);
                return nxt;
              });
            }}
          >{noteOpen ? "关闭" : "打开"}</button>
          {noteSaving && <span className="text-[11px] text-indigo-600">保存中…</span>}
          {noteSavedAt && !noteSaving && (
            <span className="text-[11px] text-gray-400">已保存 {new Date(noteSavedAt).toLocaleTimeString()}</span>
          )}
          {noteError && <span className="text-[11px] text-red-500">保存失败</span>}
        </div>
      </div>

      {/* 目录面板（固定/浮动） */}
      <TocPanel
        tocOpen={tocOpen}
        tocPinned={tocPinned}
        items={tocItems}
        onTogglePinned={() => setTocPinned(p => !p)}
        onCloseFloating={() => setTocOpen(false)}
        onOpenPinned={() => setTocPinned(true)}
        onGo={(id) => scrollToHeading(id)}
      />

      {/* 三列布局 */}
      <div className="flex-1 grid page-grid" style={{ gridTemplateColumns: gridCols }}>
        {/* 左列：PDF + 覆盖笔记编辑器 */}
        <div suppressHydrationWarning className="relative border-r page-col page-col--left">
          {pdfUrl ? (
            <PdfPane fileUrl={viewerUrl} className="h-full bg-white" />
          ) : (
            <div className="p-6 text-gray-500">未找到 PDF 地址</div>
          )}

          {noteOpen && noteDock === "overlay" && leftFixedStyle && (
            <div className="z-40 flex flex-col note-overlay" style={leftFixedStyle}>
              {/* 顶部工具栏 */}
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-white/95">
                <MiniToolbar
                  editMode={editMode}
                  onToggleMode={() => {
                    setEditMode((m) => {
                      const nxt = m === "wysiwyg" ? "markdown" : "wysiwyg";
                      if (nxt === "wysiwyg") setEditorKey((k) => k + 1);
                      return nxt;
                    });
                  }}
                  onSwitchToast={() => {
                    setEditMode((m) => {
                      const nxt = m === "toast" ? "wysiwyg" : "toast";
                      setEditorKey((k) => k + 1);
                      return nxt;
                    });
                  }}
                  toastExec={toastExec}
                  toastInsert={toastInsert}
                  noteTextRef={noteTextRef}
                  queueSave={queueSave}
                  snapshotFromTextarea={snapshotFromTextarea}
                  updateCaretFromTextarea={updateCaretFromTextarea}
                  handlePickImage={handlePickImage}
                />
                <div className="ml-auto flex items-center gap-2">
                  <button className="px-2 py-1 rounded border text-xs hover:bg-gray-50" onClick={exportNow}>
                    导出 .md
                  </button>
                  <button className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-50" onClick={() => setNoteOpen(false)}>
                    关闭
                  </button>
                </div>
              </div>

              {/* 左列覆盖内容区（编辑器） */}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="min-w-0 min-h-0 flex-1 overflow-auto">
                  {editMode === "wysiwyg" ? (
                    <WysiwygMdEditor
                      key={editorKey}
                      initialMarkdown={noteDraftRef.current || noteMd}
                      onMarkdownChange={(val) => {
                        noteDraftRef.current = val;
                        queueSave();
                      }}
                    />
                  ) : editMode === "toast" ? (
                    <div className="h-full">
                      <TuiEditor
                        ref={toastRef}
                        key={`toast-${editorKey}`}
                        initialValue={noteDraftRef.current || noteMd || ""}
                        initialEditType="markdown"
                        previewStyle="vertical"
                        hideModeSwitch={false}
                        usageStatistics={false}
                        height="100%"
                        plugins={tuiPlugins as any}
                        onChange={() => {
                          try {
                            const inst = (toastRef.current as any)?.getInstance?.();
                            const md = inst?.getMarkdown?.() || "";
                            noteDraftRef.current = md;
                            queueSave();
                          } catch {}
                        }}
                      />
                    </div>
                  ) : (
                    <textarea
                      ref={noteTextRef}
                      className="w-full h-full p-3 font-mono text-sm outline-none note-textarea"
                      defaultValue={noteDraftRef.current || noteMd}
                      onChange={(e) => {
                        noteDraftRef.current = e.target.value;
                        queueSave();
                      }}
                      onKeyUp={(e) => updateCaretFromTextarea(e.currentTarget)}
                      onClick={(e) => updateCaretFromTextarea(e.currentTarget)}
                      spellCheck={false}
                      placeholder="在此直接编辑 Markdown 源码（支持 **粗体**、`行内代码`、``` 代码块 ```、$\\LaTeX$ 与 $$块级公式$$）"
                    />
                  )}
                </div>
              </div>

              {/* 隐形文件选择器 */}
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onImageChosen}
              />
            </div>
          )}
        </div>

        {/* 中列：Markdown 渲染 + 选区工具条 + 注释定位线 */}
        <div className="relative border-r page-col page-col--mid">
          {loading && (
            <div className="absolute inset-0 bg-white/70 z-10 flex flex-col items-center justify-center">
              <div className="animate-spin w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full" />
              <div className="mt-3 text-sm text-gray-600">MinerU 正在解析/读取缓存…</div>
            </div>
          )}

          <div
            className="h-full overflow-auto p-4 relative hide-scrollbar"
            style={{ ["--md-font-size" as any]: `${mdFont}px`, scrollBehavior: "smooth" }}
            ref={mdContainerRef}
          >
            {(html || md) ? (
              <div className="relative">
                <MarkdownPane
                  html={html}
                  md={md}
                  assetsBase={assetsBase}
                  cacheKey={cacheKey}
                  mdBase={mdBase}
                  mdRel={mdRel}
                  apiBase={apiBase}
                />
                <div className="pointer-events-none absolute inset-0">
                  {noteLayout.map(({ id, top }) => (
                    <div key={`line-${id}`} className="absolute h-[1px] bg-indigo-100" style={{ top: top + 12, left: 0, right: 0 }} />
                  ))}
                </div>
              </div>
            ) : (
              !loading && <div className="text-gray-500">暂无解析内容</div>
            )}

            {/* 选区浮动工具条 */}
            {selectionBox.show && selPayload && (
              <div
                data-floating-ui
                className="absolute z-20 bg-white shadow-lg border border-indigo-100 rounded flex items-center gap-1 px-1 py-1 whitespace-nowrap"
                style={{ left: selectionBox.x, top: selectionBox.y, transform: "translate(-50%, -100%)" }}
                onMouseDown={(e) => e.preventDefault()}
              >
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
              </div>
            )}

            {/* 右键菜单（改色 / 删除） */}
            {ctxMenu.show && (
              <div
                data-floating-ui
                className="absolute z-30 bg-white shadow-lg border rounded p-1"
                style={{ left: ctxMenu.x, top: ctxMenu.y }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <div className="flex items-center gap-1 p-1">
                  {["#FFE58F", "#C7F5D9", "#CDE9FF", "#FFD6E7"].map((c) => (
                    <button key={c} title={c} className="w-4 h-4 rounded-full border" style={{ background: c }}
                      onClick={() => ctxMenu.annId && applyAnnColor(ctxMenu.annId, c)} />
                  ))}
                </div>
                <button className="w-full text-left text-sm px-2 py-1 hover:bg-gray-50"
                  onClick={() => ctxMenu.annId && deleteAnnotation(ctxMenu.annId)}>删除批注</button>
              </div>
            )}
          </div>
        </div>

        {/* 右列：批注列表 + Gemini/LLM 侧栏 */}
        <div className="relative page-col page-col--right">
          <div ref={notesPaneRef} className="h-full overflow-auto p-3 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">批注</div>
              <div className="text-xs text-gray-400">{annos.length} 条</div>
            </div>

            {/* 批注列表（与左侧高亮同步高度，不再堆叠） */}
            {annos.length === 0 ? (
              <div className="text-xs text-gray-400">暂无批注</div>
            ) : (
              <div className="relative" style={{ height: Math.max(sidebarHeight, 200) }}>
                {noteLayout.map(({ id: nid, top }) => {
                  const a = annos.find((x) => x.id === nid);
                  if (!a) return null;
                  return (
                    <div
                      key={`note-${nid}`}
                      className="absolute left-0 right-0 ip-anno-card"
                      style={{ top: top }}
                      onClick={() => {
                        const host = mdContainerRef.current;
                        if (!host) return;
                        host.scrollTo({ top: Math.max(0, top - 12), behavior: 'smooth' });
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] text-gray-400">{new Date(a.created_at).toLocaleString()}</div>
                        <div className="w-3 h-3 rounded-full border" title={a.color} style={{ background: a.color }} />
                      </div>
                      <div className="mt-1 text-sm prose prose-sm max-w-none">
                        {a.note ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}>
                            {a.note}
                          </ReactMarkdown>
                        ) : (
                          <span className="text-gray-400">(无备注)</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-gray-500 line-clamp-2">{a.anchor.quote}</div>
                    </div>
                  );
                })}
              </div>
            )}

          {/* Gemini 侧栏模式：固定覆盖右栏（不改变文档流高度） */}
          {gemOpen && gemDock === "sidebar" && rightFixedStyle && (
            <div style={rightFixedStyle}>
              <div className="absolute inset-0" style={{ pointerEvents: "none" }} />
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[92%] h-[80vh] flex flex-col bg-white rounded shadow-xl p-3 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Gemini</div>
                  <div className="flex items-center gap-2">
                    <button className="text-xs px-2 py-1 border rounded" onClick={() => setGemDock("modal")}>弹窗</button>
                    <button className="text-xs px-2 py-1 border rounded" onClick={() => setGemOpen(false)}>关闭</button>
                  </div>
                </div>

                {/* 三等分区域 */}
                <div className="mt-2 grid grid-rows-3 gap-3 flex-1 min-h-0">
                  {/* 区域1：提问输入 */}
                  <div className="min-h-0 flex flex-col">
                    <textarea
                      ref={gemPromptRef}
                      defaultValue={gemPrompt}
                      onChange={(e) => setGemPrompt(e.target.value)}
                      className="w-full h-full p-2 border rounded text-sm resize-none"
                    />
                    <div className="mt-2 flex gap-2">
                      <button className="px-2 py-1 border rounded text-sm" onClick={() => sendGemini()}>
                        {gemLoading ? "发送中…" : "发送"}
                      </button>
                      <button className="px-2 py-1 border rounded text-sm" onClick={() => setGemChat([])}>
                        清空
                      </button>
                    </div>
                  </div>

                  {/* 区域2：对话历史 */}
                  <div className="min-h-0 overflow-auto border rounded p-2">
                    <GemChatItems items={gemChat} />
                  </div>

                  {/* 区域3：编辑后作为批注 */}
                  <div className="min-h-0 flex flex-col">
                    <div className="text-xs text-gray-500 mb-1">当前回答（可编辑后保存为批注）</div>
                    <textarea
                      value={gemEditText}
                      onChange={(e) => setGemEditText(e.target.value)}
                      className="w-full h-full p-2 border rounded text-sm resize-none"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        className="px-2 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!selPayload}
                        onClick={() => {
                          const text = (gemEditText || "").trim();
                          if (!text || !selPayload) return;
                          doAddAnnotation(text);
                          setGemOpen(false);
                        }}
                      >
                        作为批注插入
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

            {llmOpen && (
              <div className="border rounded p-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-500">LLM</div>
                  <button className="text-xs px-2 py-1 border rounded" onClick={() => setLlmOpen(false)}>关闭</button>
                </div>
                <div className="mt-2">
                  <textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    className="w-full p-2 border rounded text-sm"
                    rows={3}
                  />
                  <div className="mt-2 flex gap-2">
                    <button className="px-2 py-1 border rounded text-sm" onClick={sendLLM}>
                      {llmLoading ? "发送中…" : "发送"}
                    </button>
                    <button className="px-2 py-1 border rounded text-sm" onClick={() => setChat([])}>
                      清空
                    </button>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <GemChatItems items={chat} />
                </div>
              </div>
            )}
          </div>
          {/* Gemini 弹窗（右侧覆盖，使用 fixed，完全不改变文档流高度） */}
          {gemOpen && gemDock === "modal" && rightFixedStyle && (
            <div style={rightFixedStyle}>
              <div className="absolute inset-0 bg-white/85" style={{ pointerEvents: "auto" }} />
              <div className="absolute inset-0 flex items-center justify-center p-3" style={{ pointerEvents: "none" }}>
                <div className="relative bg-white rounded shadow-xl w-[min(720px,92%)] h-[80vh] max-h-[80vh] p-3 flex flex-col pointer-events-auto">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Gemini</div>
                    <div className="flex items-center gap-2">
                      <button className="text-xs px-2 py-1 border rounded" onClick={() => setGemDock("sidebar")}>
                        移到侧栏
                      </button>
                      <button className="text-xs px-2 py-1 border rounded" onClick={() => setGemOpen(false)}>关闭</button>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-rows-3 gap-3 flex-1 min-h-0">
                    <div className="min-h-0 flex flex-col">
                      <textarea
                        ref={gemPromptRef}
                        defaultValue={gemPrompt}
                        onChange={(e) => setGemPrompt(e.target.value)}
                        className="w-full h-full p-2 border rounded text-sm resize-none"
                      />
                      <div className="mt-2 flex gap-2">
                        <button className="px-2 py-1 border rounded text-sm" onClick={() => sendGemini()}>
                          {gemLoading ? "发送中…" : "发送"}
                        </button>
                        <button className="px-2 py-1 border rounded text-sm" onClick={() => setGemChat([])}>
                          清空
                        </button>
                      </div>
                    </div>

                    <div className="min-h-0 overflow-auto border rounded p-2">
                      <GemChatItems items={gemChat} />
                    </div>

                    <div className="min-h-0 flex flex-col">
                      <div className="text-xs text-gray-500 mb-1">当前回答（可编辑后保存为批注）</div>
                      <textarea
                        value={gemEditText}
                        onChange={(e) => setGemEditText(e.target.value)}
                        className="w-full h-full p-2 border rounded text-sm resize-none"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          className="px-2 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={!selPayload}
                          onClick={() => {
                            const text = (gemEditText || "").trim();
                            if (!text || !selPayload) return;
                            doAddAnnotation(text);
                            setGemOpen(false);
                          }}
                        >
                          作为批注插入
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 浮动“添加备注”编辑器 */}
      {noteEditor.show && (
        <div className="fixed z-50" style={{ left: noteEditor.x, top: noteEditor.y, transform: "translate(-50%, -100%)" }}>
          <div className="bg-white border rounded shadow-lg p-2 w-[min(480px,80vw)]">
            <div className="text-xs text-gray-500 mb-1">新增批注</div>
            <textarea ref={annoTextRef} className="w-full p-2 border rounded text-sm" rows={4} placeholder="写点什么…" />
            <div className="mt-2 flex justify-end gap-2">
              <button className="px-2 py-1 border rounded text-sm" onClick={() => setNoteEditor({ show: false, x: 0, y: 0 })}>取消</button>
              <button className="px-2 py-1 border rounded text-sm" onClick={() => doAddAnnotation(annoTextRef.current?.value || "")}>保存</button>
            </div>
          </div>
        </div>
      )}
      {/* 顶部气泡 */}
      {bubble.show && (
        <div className={`fixed z-[100] top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded text-sm shadow ${bubble.type === "error" ? "bg-rose-600 text-white" : "bg-black text-white"}`}>
          {bubble.text}
        </div>
      )}
    </div>
  );
}