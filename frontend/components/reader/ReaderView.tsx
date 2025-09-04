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
  () => import("@toast-ui/react-editor").then((m: any) => m.default || m.Editor),
  { ssr: false }
);

// 子组件
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

// Client-only plugin loader to avoid SSR `window` reference, with KaTeX math support
function useTuiPlugins() {
  const plugins = React.useMemo(() => {
    if (typeof window === "undefined") return [] as any[];
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const code = require("@toast-ui/editor-plugin-code-syntax-highlight");
      const codePlugin = code?.default || code;
      return [codePlugin];
    } catch {
      return [] as any[];
    }
  }, []);
  return plugins;
}
// Toast 笔记区数学公式渲染（优化：仅在有 $/$$ 时处理，且 $$ 段落合并仅在有 $$ 时运行）
function renderMathInToast(root?: HTMLElement | null) {
  if (!root || typeof window === "undefined") return;
  const anyWin = window as any;
  const fn = anyWin.renderMathInElement || anyWin.renderMathInElementDefault;
  if (typeof fn !== "function") return;

  const container = root.querySelector(".toastui-editor-contents") as HTMLElement | null;
  if (!container) return;

  // ---- Fast path: if there's no math marker at all, skip everything (including DOM scans) ----
  const plain = container.innerText || "";
  if (plain.indexOf("$") === -1) return;

  // Only do the $$ paragraph re-join work if block math is actually present
  if (plain.indexOf("$$") !== -1) {
    try {
      const ps = Array.from(container.querySelectorAll<HTMLParagraphElement>("p"));
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (!p || p.isConnected === false) continue;
        if ((p.textContent || "").trim() === "$$") {
          // Find closing $$
          let j = i + 1;
          while (j < ps.length && (ps[j].textContent || "").trim() === "") j++;
          if (j < ps.length) {
            let k = j;
            while (k < ps.length && (ps[k].textContent || "").trim() !== "$$") k++;
            if (k < ps.length && (ps[k].textContent || "").trim() === "$$") {
              let middle = "";
              for (let t = j; t < k; t++) {
                middle += ps[t].innerText + (t < k - 1 ? "\n" : "");
              }
              const repl = document.createElement("div");
              repl.textContent = `$$${middle}$$`;
              ps[k].after(repl);
              for (let t = i; t <= k; t++) ps[t]?.remove();
              i = k; // continue scanning
            }
          }
        }
      }
    } catch {}
  }

  try {
    fn(container, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    });
  } catch {}
  // After math render, collapse long data URLs
  console.log("[IP] renderMathInToast: calling maskToastDataUrls");
  try { maskToastDataUrls(container); } catch {}
}

// —— Visually collapse data:image/...;base64,... URLs in Markdown editor (Toast) ——
function maskToastDataUrls(root?: HTMLElement | null) {
  // Prefer the editor root (defaultUI). If we were given the preview .toastui-editor-contents,
  // climb up to the editor root so we can see the Markdown token spans, too.
  const editorRoot =
    (root && (root.matches?.(".toastui-editor-defaultUI")
      ? root
      : (root.closest?.(".toastui-editor-defaultUI") as HTMLElement | null))) ||
    (document.querySelector(".toastui-editor-defaultUI") as HTMLElement | null);

  console.log("[IP] maskToastDataUrls: start", {
    hasRoot: !!root,
    editorRootFound: !!editorRoot,
    givenRootClass: root ? (root.className || "").toString() : "(none)",
  });
  if (!editorRoot) return;

  // Candidates:
  //  - Markdown tokenized URL spans: .toastui-editor-md-link-url
  //  - WYSIWYG URL tokens (in case): .toastui-editor-ww-link-url
  //  - As a fallback, also look at <a href="data:...">
  const urls = editorRoot.querySelectorAll<HTMLElement>(
    ".toastui-editor-md-link-url, .toastui-editor-ww-link-url, a[href^='data:']"
  );
  console.log("[IP] maskToastDataUrls: candidates", { count: urls.length });

  urls.forEach((el, idx) => {
    if (el.classList.contains("ip-url-data")) return; // already processed
    const rawTxt = (el.tagName.toLowerCase() === "a" ? (el.getAttribute("href") || "") : (el.textContent || ""));
    // Allow leading quotes / parentheses in Markdown tokens, but for <a> we read href directly.
    const m = rawTxt.match(/^\s*["'(]?(data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,)([A-Za-z0-9+/=]+)([^"')\s]*)?/i);
    console.log("[IP] maskToastDataUrls: inspect", {
      idx,
      tag: el.tagName.toLowerCase(),
      class: el.className,
      sample: rawTxt.slice(0, 60),
      matched: !!m,
      groups: m ? { p: m[1]?.slice(0, 40), b64len: m[2]?.length || 0, suff: m[3] || "" } : null,
    });
    if (m) {
      const prefix = m[1];
      const b64 = m[2] || "";
      const suffix = m[3] || "";
      el.classList.add("ip-url-data");
      el.setAttribute("title", rawTxt); // keep full value on hover

      // For <a>, also update its textContent to show only prefix+suffix (href 保持不变)
      if (el.tagName.toLowerCase() === "a") {
        // Replace inner text with a split structure
        while (el.firstChild) el.removeChild(el.firstChild);
      } else {
        // Markdown token span: also rebuild children
        while (el.firstChild) el.removeChild(el.firstChild);
      }
      const s1 = document.createElement("span");
      s1.className = "ip-url-prefix";
      s1.textContent = prefix;
      const s2 = document.createElement("span");
      s2.className = "ip-url-b64"; // hidden by CSS
      s2.textContent = b64;
      s2.setAttribute("style", "display:none"); // runtime safety: hide even if CSS not applied
      const s3 = document.createElement("span");
      s3.className = "ip-url-suffix";
      s3.textContent = suffix;
      el.appendChild(s1);
      el.appendChild(s2);
      el.appendChild(s3);
      console.log("[IP] maskToastDataUrls: masked", { idx, shown: s1.textContent + s3.textContent, hiddenLen: b64.length });
    }
  });
}
// —— Convert a subset of HTML to Markdown (fallback path to preserve formatting) ——
function htmlToMarkdown(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;

  // Escape only outside math ($...$ / $$...$$). Inside math, keep backslashes as-is.
  const escapeTextSmart = (s: string) => {
    s = (s || "").replace(/\u00A0/g, " ");
    let out = "";
    let i = 0;
    let mathDelim: 0 | 1 | 2 = 0; // 0 none, 1 = $, 2 = $$
    while (i < s.length) {
      const ch = s[i];
      // handle $ and $$ delimiters
      if (ch === "$") {
        const isDouble = i + 1 < s.length && s[i + 1] === "$";
        const len = isDouble ? 2 : 1;
        if (mathDelim === 0) {
          mathDelim = isDouble ? 2 : 1;
          out += isDouble ? "$$" : "$";
          i += len;
          continue;
        } else if ((mathDelim === 2 && isDouble) || (mathDelim === 1 && !isDouble)) {
          // closing with matching delimiter
          mathDelim = 0;
          out += isDouble ? "$$" : "$";
          i += len;
          continue;
        } else {
          // a $ inside current math context, just output it
          out += isDouble ? "$$" : "$";
          i += len;
          continue;
        }
      }
      if (mathDelim !== 0) {
        out += ch; // inside math: do not escape
      } else {
        // outside math: escape markdown control chars (including pipe)
        if (/[\*\_\`\~\[\]\(\)#>\|\\]/.test(ch)) out += "\\" + ch;
        else out += ch;
      }
      i++;
    }
    return out;
  };

  const lines: string[] = [];

  // Render an inline fragment (no paragraph breaks)
  const outInline = (el: Node): string => {
    if (el.nodeType === Node.TEXT_NODE) return escapeTextSmart(el.textContent || "");
    if (el.nodeType !== Node.ELEMENT_NODE) return "";
    const e = el as HTMLElement;
    const tag = e.tagName.toLowerCase();
    const inner = Array.from(e.childNodes).map(outInline).join("");

    // KaTeX output: recover original TeX from MathML annotation
    if ((tag === "span" || tag === "div") && (e.classList.contains("katex") || e.classList.contains("katex-display"))) {
      const ann = e.querySelector('annotation[encoding="application/x-tex"]') as HTMLElement | null;
      const raw = (ann?.textContent || "").trim();
      if (raw) {
        const isDisplay = e.classList.contains("katex-display") || !!e.closest(".katex-display");
        return isDisplay ? `$$${raw}$$` : `$${raw}$`;
      }
      // Fallback: if no annotation found, keep inner text (last resort)
      return inner;
    }

    if (tag === "strong" || tag === "b") return `**${inner}**`;
    if (tag === "em" || tag === "i") return `*${inner}*`;
    if (tag === "del" || tag === "s" || tag === "strike") return `~~${inner}~~`;
    if (tag === "code") {
      // inline code: take raw text, do not escape/backslash-transform
      const raw = (e.textContent || "").replace(/\u00A0/g, " ");
      return "`" + raw + "`";
    }
    if (tag === "a") {
      const href = e.getAttribute("href") || "";
      return `[${inner}](${href})`;
    }
    if (tag === "span" && e.classList.contains("math-raw")) {
      // keep raw math verbatim (already includes $...$ or $$...$$)
      return e.textContent || "";
    }
    if (tag === "img") {
      const alt = e.getAttribute("alt") || "";
      const src = e.getAttribute("src") || "";
      return `![${alt}](${src})`;
    }
    if (tag === "br") {
      return "<br>";
    }
    // default inline: flatten
    return inner;
  };

  const pushPara = (txt: string) => {
    if (!txt) return;
    const cleaned = txt.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    lines.push(cleaned);
    lines.push(""); // paragraph break
  };

  const tableCellToInline = (cell: HTMLElement): string => {
    // Convert cell inner HTML to inline MD; turn newlines into <br> to keep them inside a cell
    const md = htmlToMarkdown(cell.innerHTML);
    return md.trim().replace(/\n{2,}/g, "<br>").replace(/\n/g, "<br>");
  };

  const getAlignToken = (cell: HTMLElement): string => {
    const align =
      (cell.getAttribute("align") || (cell.style && (cell.style as any).textAlign) || "")
        .toString()
        .toLowerCase();
    if (align === "left") return ":---";
    if (align === "right") return "---:";
    if (align === "center") return ":---:";
    return "---";
  };

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || "").replace(/\s+/g, " ");
      if (t.trim()) lines.push(escapeTextSmart(t));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "table") {
      const rowsEls = Array.from(el.querySelectorAll("tr"));
      const rows: string[][] = [];
      const thAlign: string[] = [];
      let hasHeader = false;
      rowsEls.forEach((tr, rIdx) => {
        const cellEls = Array.from(tr.children).filter(
          (c) => {
            const t = (c as HTMLElement).tagName.toLowerCase();
            return t === "td" || t === "th";
          }
        ) as HTMLElement[];
        if (!cellEls.length) return;
        const row = cellEls.map((c) => tableCellToInline(c));
        rows.push(row);
        if (rIdx === 0) {
          hasHeader = cellEls.some((c) => c.tagName.toLowerCase() === "th") || !!el.querySelector("thead");
          cellEls.forEach((c, i) => (thAlign[i] = getAlignToken(c)));
        }
      });
      if (rows.length) {
        const colCount = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => {
          while (r.length < colCount) r.push("");
          return r;
        };
        const header = pad(rows[0].slice());
        const sep = Array.from({ length: colCount }).map((_, i) => thAlign[i] || "---");
        const body = rows.slice(1).map((r) => pad(r.slice()));

        lines.push(`| ${header.join(" | ")} |`);
        lines.push(`| ${sep.join(" | ")} |`);
        body.forEach((r) => lines.push(`| ${r.join(" | ")} |`));
        lines.push(""); // blank line after table
      }
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      const depth = Math.min(6, Math.max(1, Number(tag[1] || 1)));
      const text = outInline(el);
      pushPara(`${"#".repeat(depth)} ${text}`);
      return;
    }

    if (tag === "p") {
      const text = outInline(el);
      pushPara(text);
      return;
    }

    if (tag === "br") {
      lines.push("  "); // soft break outside table
      return;
    }

    if (tag === "hr") {
      lines.push("---");
      lines.push("");
      return;
    }

    if (tag === "pre") {
      const codeEl = el.querySelector("code");
      const rawText = codeEl ? (codeEl.textContent || "") : (el.textContent || "");
      let lang = "";
      const klass = (codeEl || el).className || "";
      const m = klass.match(/language-([a-z0-9\+\-]+)/i);
      if (m) lang = m[1];
      // Normalize NBSPs and remove trailing blank lines so we don't end up with
      // an empty line just before the closing ```
      const cleaned = rawText
        .replace(/\u00A0/g, " ")
        .replace(/\r?\n+$/g, ""); // <-- trim final newlines
      lines.push("```" + lang);
      lines.push(cleaned);
      lines.push("```");
      lines.push(""); // keep one blank line AFTER the fence (outside the block)
      return;
    }

    if (tag === "blockquote") {
      const md = htmlToMarkdown(el.innerHTML).trim().split("\n").map(l => (l ? `> ${l}` : ">")).join("\n");
      lines.push(md);
      lines.push("");
      return;
    }

    if (tag === "ul" || tag === "ol") {
      let idx = 1;
      Array.from(el.children).forEach((li) => {
        if ((li as HTMLElement).tagName.toLowerCase() !== "li") return;
        const bullet = tag === "ol" ? `${idx}. ` : "- ";
        const inner = htmlToMarkdown((li as HTMLElement).innerHTML).trim().replace(/\n/g, "\n  ");
        lines.push(bullet + inner);
        idx += 1;
      });
      lines.push("");
      return;
    }

    if (tag === "img") {
      const alt = el.getAttribute("alt") || "";
      const src = el.getAttribute("src") || "";
      pushPara(`![${alt}](${src})`);
      return;
    }

    // default: descend
    Array.from(el.childNodes).forEach(visit);
  };

  Array.from(root.childNodes).forEach(visit);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

// —— Safely read Toast UI Editor content (prefers Markdown, falls back to HTML→Markdown) ——
function readToastMarkdown(inst?: any, previewHost?: HTMLElement | null): string {
  try {
    const md = inst?.getMarkdown?.();
    if (typeof md === "string" && md.trim().length) return md;
  } catch {}

  // Fallback：把 HTML 转成 Markdown，保留格式
  try {
    const html = inst?.getHTML?.();
    if (typeof html === "string" && html.trim()) {
      const converted = htmlToMarkdown(html);
      if (converted.trim()) return converted;
    }
  } catch {}

  if (previewHost) {
    const html = (previewHost as HTMLElement).innerHTML || "";
    if (html && html.trim()) {
      const converted = htmlToMarkdown(html);
      if (converted.trim()) return converted;
    }
  }

  // 最后的保底：返回空（上层逻辑会避免用空覆盖已有草稿）
  return "";
}

export default function ReaderView() {
  const toastRootRef = React.useRef<HTMLDivElement | null>(null);
  const rafIdRef = React.useRef<number | null>(null);
  const idleTimerRef = React.useRef<number | null>(null);
  const mathDirtyRef = React.useRef(false);
  const mdHasDollarRef = React.useRef(false);
  const lastInputAtRef = React.useRef(0);
  const lastScrollAtRef = React.useRef(0);
  const INPUT_IDLE_MS = 80;   // 打字后稍等一丢丢再渲染（不影响输入流畅）
  const SCROLL_IDLE_MS = 160; // 滚动结束 160ms 内不渲染，保证丝滑滚动

  const scheduleRenderToastMath = React.useCallback(() => {
    // 若当前文档没有 $ 标记，直接跳过任何渲染
    if (!mdHasDollarRef.current) {
      mathDirtyRef.current = false;
      return;
    }
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    lastInputAtRef.current = now;
    mathDirtyRef.current = true;
    if (idleTimerRef.current) return; // 已经在等空闲，无需重复排程

    const tick = () => {
      idleTimerRef.current = null;
      if (!mathDirtyRef.current) return;

      const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const inputIdle = t - lastInputAtRef.current >= INPUT_IDLE_MS;
      const scrollIdle = t - lastScrollAtRef.current >= SCROLL_IDLE_MS;

      if (!(inputIdle && scrollIdle)) {
        idleTimerRef.current = window.setTimeout(tick, 50);
        return;
      }

      // 满足空闲条件：合并到下一帧渲染
      mathDirtyRef.current = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        renderMathInToast(toastRootRef.current || undefined);
      });
    };

    idleTimerRef.current = window.setTimeout(tick, 50);
  }, []);
  const [editMode, setEditMode] = React.useState<"markdown" | "toast">(
    "toast"
  );
  // 监听编辑器内部的滚动（捕获阶段可拦截所有子滚动容器），滚动时推迟渲染
  React.useEffect(() => {
    if (editMode !== 'toast') return;
    const root = toastRootRef.current;
    if (!root) return;
    const onScroll = () => {
      lastScrollAtRef.current = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    };
    // 使用捕获 + passive，尽可能轻量
    root.addEventListener('scroll', onScroll, { capture: true, passive: true } as any);
    return () => {
      root.removeEventListener('scroll', onScroll, true);
    };
  }, [editMode]);

  // 组件卸载 / 切换模式时清理
  React.useEffect(() => {
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);
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
// —— 获取编辑器当前内容（Toast 或 textarea），并同步到 noteDraftRef ——
const pullLatestMarkdown = React.useCallback((): string => {
  let next = noteDraftRef.current || "";
  try {
    if (editMode === "toast") {
      const inst = toastRef.current?.getInstance?.();
      const previewHost = toastRootRef.current?.querySelector(".toastui-editor-contents") as HTMLElement | null;
      const md = readToastMarkdown(inst, previewHost);
      // 不要用空字符串把已有内容盖掉
      if (typeof md === "string" && (md.length > 0 || next.length === 0)) {
        next = md;
      }
    } else if (noteTextRef.current && editMode === "markdown") {
      next = noteTextRef.current.value || "";
    }
  } catch (e) {
    console.log("[ReaderView] pullLatestMarkdown error:", e);
  }
  if (next !== noteDraftRef.current) {
    console.log("[ReaderView] pullLatestMarkdown -> sync ref", { len: next.length });
    noteDraftRef.current = next;
    mdHasDollarRef.current = next.indexOf("$") !== -1;
  }
  return next;
}, [editMode]);
  // ===== Toast 查找/替换（仅在 editMode === 'toast' 时启用） =====
const [findOpen, setFindOpen] = React.useState(false);
const [findQ, setFindQ] = React.useState("");
const [replQ, setReplQ] = React.useState("");
const [findCase, setFindCase] = React.useState(false);
const [findWord, setFindWord] = React.useState(false);
const [findRegex, setFindRegex] = React.useState(false);
const [findCount, setFindCount] = React.useState(0);
const [findActive, setFindActive] = React.useState(0); // 0-based
const findHitsRef = React.useRef<HTMLElement[]>([]);
const findScheduleRef = React.useRef<number | null>(null);
// Mirror latest findActive in a ref for highlight clamping
const findActiveRef = React.useRef(0);
React.useEffect(() => { findActiveRef.current = findActive; }, [findActive]);
// MutationObserver & decoration guard
const decoPhaseRef = React.useRef(false);
const moRef = React.useRef<MutationObserver | null>(null);
const moTimerRef = React.useRef<number | null>(null);

const getToastContentHost = React.useCallback(() => {
  const root = toastRootRef.current;
  return root ? root.querySelector<HTMLElement>(".toastui-editor-contents") : null;
}, []);

const compileFind = React.useCallback(() => {
  if (!findQ) return null;
  try {
    if (findRegex) {
      const flags = `${findCase ? "" : "i"}g`;
      return new RegExp(findQ, flags);
    }
    const escaped = findQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = `${findCase ? "" : "i"}g`;
    return new RegExp(escaped, flags);
  } catch { return null; }
}, [findQ, findCase, findRegex]);

const isWordChar = (ch?: string) => !!ch && /[0-9A-Za-z_]/.test(ch);

const clearFindHighlights = React.useCallback((host?: HTMLElement | null) => {
  const h = host || getToastContentHost();
  if (!h) return;
  h.querySelectorAll<HTMLElement>(".ip-find-hit").forEach(el => {
    const p = el.parentNode as Node;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
  });
  findHitsRef.current = [];
  setFindCount(0);
}, [getToastContentHost]);

const shouldSkip = (el: Element) => {
  const tag = el.tagName.toLowerCase();
  if (/(script|style|pre|code|kbd)/.test(tag)) return true;
  if (el.closest?.("pre, code, kbd, .katex")) return true;
  return false;
};

const applyFindHighlights = React.useCallback(() => {
  if (editMode !== "toast") return;
  if (!findOpen || !findQ) { clearFindHighlights(); return; }
  const host = getToastContentHost();
  if (!host) return;
  clearFindHighlights(host);
  const re = compileFind();
  if (!re) { setFindCount(0); return; }

  // Collect text nodes first to avoid walker invalidation
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = (node.parentElement as Element | null);
      if (!p) return NodeFilter.FILTER_REJECT;
      if (shouldSkip(p)) return NodeFilter.FILTER_REJECT;
      const txt = node.nodeValue || "";
      return txt.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  } as any);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

  const hits: HTMLElement[] = [];
  decoPhaseRef.current = true; // guard against observer feedback
  for (const tn of nodes) {
    const text = tn.nodeValue || "";
    re.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    const segs: (string | HTMLElement)[] = [];
    while ((m = re.exec(text))) {
      let s = m.index;
      let e = s + (m[0]?.length || 0);
      if (e === s) { re.lastIndex++; continue; }
      if (findWord && !findRegex) {
        const prev = text[s - 1];
        const next = text[e];
        if (isWordChar(prev) || isWordChar(next)) continue;
      }
      if (s > last) segs.push(text.slice(last, s));
      const span = document.createElement("span");
      span.className = "ip-find-hit";
      span.textContent = text.slice(s, e);
      segs.push(span); hits.push(span);
      last = e;
    }
    if (segs.length) {
      if (last < text.length) segs.push(text.slice(last));
      const frag = document.createDocumentFragment();
      segs.forEach((x) => frag.append(x as any));
      tn.parentNode?.replaceChild(frag, tn);
    }
  }
  decoPhaseRef.current = false;

  findHitsRef.current = hits;
  setFindCount(hits.length);

  // Clamp ONLY if current active is out of range; otherwise keep it
  let idx = findActiveRef.current;
  if (hits.length === 0) idx = 0;
  if (idx >= hits.length) idx = Math.max(0, hits.length - 1);
  if (idx !== findActiveRef.current) setFindActive(idx);

  requestAnimationFrame(() => {
    hits.forEach((el) => el.classList.remove("ip-find-hit--active"));
    if (hits[idx]) {
      hits[idx].classList.add("ip-find-hit--active");
      try { hits[idx].scrollIntoView({ block: "center", behavior: "smooth" }); } catch {}
    }
  });
}, [editMode, findOpen, findQ, findWord, findRegex, compileFind, getToastContentHost, clearFindHighlights]);

const scheduleApplyFindHighlights = React.useCallback(() => {
  if (!findOpen || !findQ) return;
  if (findScheduleRef.current) {
    window.clearTimeout(findScheduleRef.current);
    findScheduleRef.current = null;
  }
  findScheduleRef.current = window.setTimeout(() => applyFindHighlights(), 16);
}, [applyFindHighlights, findOpen, findQ]);

// Re-apply math & highlights after Toast UI DOM update (wait for DOM commit)
const refreshToastDecorationsAfterUpdate = React.useCallback(() => {
  // TUI setMarkdown -> internal render is async. Triple rAF to wait for DOM commit.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        decoPhaseRef.current = true;
        renderMathInToast(toastRootRef.current || undefined);
        console.log("[IP] refreshToastDecorationsAfterUpdate: calling maskToastDataUrls");
        try { maskToastDataUrls(toastRootRef.current || undefined); } catch {}
        decoPhaseRef.current = false;
        if (findOpen && findQ) {
          applyFindHighlights();
        }
      });
    });
  });
}, [applyFindHighlights, findOpen, findQ]);
// 强制同步 Toast 预览（有些环境 setMarkdown 不会立刻刷新预览区）
const forceToastPreviewSync = React.useCallback(() => {
  const inst = toastRef.current?.getInstance?.();
  const host = getToastContentHost();
  if (!inst || !host) return;
  try {
    const html = inst.getHTML?.();
    if (typeof html === 'string' && html && host.innerHTML !== html) {
      // 避免触发 MutationObserver 的回环
      decoPhaseRef.current = true;
      host.innerHTML = html;
      decoPhaseRef.current = false;
    }
  } catch {}
}, [getToastContentHost]);
const redecorateSoon = React.useCallback(() => {
  // 先跑一轮：等待 Toast 预览 DOM 提交，再做数学和高亮
  refreshToastDecorationsAfterUpdate();

  // 没开查找或无查询词就不用重试
  if (!(findOpen && findQ)) return;

  // 兼容 ToastUI 偶发延迟：再追加几次轻量重试
  [50, 120, 250, 400].forEach((ms) => {
    window.setTimeout(() => {
      console.log("[IP] redecorateSoon retry", ms, ": calling maskToastDataUrls");
      try { forceToastPreviewSync(); } catch {}
      try { maskToastDataUrls(toastRootRef.current || undefined); } catch {}
      try { applyFindHighlights(); } catch {}
    }, ms);
  });
}, [applyFindHighlights, refreshToastDecorationsAfterUpdate, findOpen, findQ, forceToastPreviewSync]);
// Activate-only: highlighs the current hit, no recompute
const activateCurrentHit = React.useCallback(() => {
  const hits = findHitsRef.current;
  let idx = findActiveRef.current;
  if (hits.length === 0) idx = 0;
  if (idx >= hits.length) idx = Math.max(0, hits.length - 1);
  hits.forEach((el) => el.classList.remove("ip-find-hit--active"));
  if (hits[idx]) {
    hits[idx].classList.add("ip-find-hit--active");
    try { hits[idx].scrollIntoView({ block: "center", behavior: "smooth" }); } catch {}
  }
}, []);

React.useEffect(() => { activateCurrentHit(); }, [findActive, activateCurrentHit]);

// 查找条件变化时刷新
React.useEffect(() => {
  if (findOpen && editMode === "toast") {
    setFindActive(0);
    applyFindHighlights();   // 直接执行一次，避免输入时出现“致命延迟”
  } else if (!findQ) {
    clearFindHighlights();
  }
}, [findQ, findCase, findWord, findRegex, findOpen, editMode, applyFindHighlights, clearFindHighlights]);

// 快捷键：Cmd/Ctrl+F 打开，Enter 导航
React.useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const metaF = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f";
    if (metaF && editMode === "toast") {
      e.preventDefault();
      setFindOpen(true);
      scheduleApplyFindHighlights();
    }
    if (!findOpen) return;
    if (e.key === "Enter") {
      if (e.shiftKey) gotoPrev(); else gotoNext();
    }
  };
  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}, [editMode, findOpen]);

const gotoNext = React.useCallback(() => {
  if (!findCount) return;
  setFindActive((cur) => (cur + 1) % findCount);
}, [findCount]);

const gotoPrev = React.useCallback(() => {
  if (!findCount) return;
  setFindActive((cur) => (cur - 1 + findCount) % findCount);
}, [findCount]);

const getDraftKeys = React.useCallback(() => {
  const pid = id || "";
  return {
    draft: `ip:noteDraft:${pid}`,
    meta: `ip:noteDraftMeta:${pid}`,
  };
}, [id]);
const markServerSaved = React.useCallback(() => {
  try {
    const { meta } = getDraftKeys();
    localStorage.setItem(meta, String(Date.now()));
  } catch {}
}, [getDraftKeys]);
// —— 源文本层面的替换 ——（保证替换的是 Markdown 源）
const buildSourceRegex = React.useCallback(() => {
  if (!findQ) return null;
  try {
    if (findRegex) {
      const flags = `${findCase ? "" : "i"}g`;
      return new RegExp(findQ, flags);
    }
    const escaped = findQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = `${findCase ? "" : "i"}g`;
    return new RegExp(escaped, flags);
  } catch { return null; }
}, [findQ, findCase, findRegex]);


const saveLocalDraft = React.useCallback((content: string) => {
  try {
    const { draft } = getDraftKeys();
    localStorage.setItem(draft, JSON.stringify({ content, ts: Date.now() }));
  } catch {}
}, [getDraftKeys]);

  // 环境
  const PDFJS_VIEWER =
    process.env.NEXT_PUBLIC_PDFJS_URL || "/pdfjs/web/viewer.html";
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  const api = React.useCallback(
    (path: string) => (apiBase ? `${apiBase}${path}` : path),
    [apiBase]
  );
  const queueSave = React.useCallback((override?: string) => {
    if (!contentReadyRef.current) {
      console.log("[ReaderView] queueSave blocked: content not ready");
      return;
    }
    // 读取实时内容，避免因 ref 过期而保存为空
    const cur = pullLatestMarkdown();
    dirtyRef.current = true;
    try { saveLocalDraft(cur); } catch {}
    console.log("[ReaderView] queueSave scheduled", { id, len: cur.length, suppress: suppressSaveRef.current });
  
    if (saveDebounceRef.current) window.clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = window.setTimeout(async () => {
      if (!id) return;
      if (!dirtyRef.current) { console.log("[ReaderView] queueSave skipped: not dirty"); return; }
      try {
        setNoteSaving(true);
        setNoteError(null);
        if (saveAbortRef.current) saveAbortRef.current.abort();
        const ctrl = new AbortController();
        saveAbortRef.current = ctrl;
  
        const latest = (typeof override === "string") ? override : pullLatestMarkdown();
        console.log("[ReaderView] saving...", { id, len: latest.length });
  
        const saved = await upsertByPaper(api, Number(id), latest);
        setNoteId(saved.id);
        setNoteSavedAt(new Date().toISOString());
        lastServerContentRef.current = latest;
        dirtyRef.current = false;
        markServerSaved();
        console.log("[ReaderView] saved ok", { id, len: latest.length, savedId: saved?.id });
      } catch (e: any) {
        console.log("[ReaderView] save failed", e);
        setNoteError(e?.message || String(e));
      } finally {
        setNoteSaving(false);
      }
    }, 600);
  }, [id, api, markServerSaved, saveLocalDraft, pullLatestMarkdown]);
  const syncToastModelFromInst = React.useCallback(() => {
    const inst = toastRef.current?.getInstance?.();
    if (!inst) return;
    try {
      const previewHost = toastRootRef.current?.querySelector(".toastui-editor-contents") as HTMLElement | null;
      const md = readToastMarkdown(inst, previewHost);
      if (md !== noteDraftRef.current) {
        const prevLen = (noteDraftRef.current || "").length;
        noteDraftRef.current = md;
        mdHasDollarRef.current = md.indexOf("$") !== -1;
        dirtyRef.current = true;
        try { saveLocalDraft(md); } catch {}
        console.log("[ReaderView] syncToastModelFromInst", { prevLen, nextLen: md.length });
        queueSave(md);
      }
    } catch (e) {
      console.log("[ReaderView] syncToastModelFromInst error", e);
    }
  }, [queueSave, saveLocalDraft]);
const toastExec = React.useCallback((cmd: string, payload?: any) => {
  const inst = toastRef.current?.getInstance?.();
  if (!inst) return;
  try {
    inst.exec(cmd, payload);
  } catch {}
  // 立刻刷预览 + 同步到模型 + 重绘装饰
  try { forceToastPreviewSync(); } catch {}
  try { syncToastModelFromInst(); } catch {}
  try { redecorateSoon?.(); } catch {}
  // 兜底：某些命令内部异步提交，稍后再同步一次
  window.setTimeout(() => { try { syncToastModelFromInst(); } catch {} }, 30);
}, [syncToastModelFromInst, forceToastPreviewSync, redecorateSoon]);
const replaceOneAt = React.useCallback((index: number) => {
  const text = noteDraftRef.current || "";
  const reG = buildSourceRegex();
  if (!reG) return 0;
  const ranges: { s: number; e: number }[] = [];
  let m: RegExpExecArray | null;
  reG.lastIndex = 0;
  while ((m = reG.exec(text))) {
    const s = m.index;
    const e = s + (m[0]?.length || 0);
    if (e === s) { reG.lastIndex++; continue; }
    if (findWord && !findRegex) {
      const prev = text[s - 1];
      const next = text[e];
      if (isWordChar(prev) || isWordChar(next)) continue;
    }
    ranges.push({ s, e });
  }
  if (!ranges.length) return 0;
  const i = Math.max(0, Math.min(index, ranges.length - 1));
  const { s, e } = ranges[i];
  const reSingle = new RegExp(reG.source, reG.flags.replace('g',''));
  const replaced = text.slice(s, e).replace(reSingle, replQ);
  const next = text.slice(0, s) + replaced + text.slice(e);
  noteDraftRef.current = next;
  try { toastRef.current?.getInstance?.()?.setMarkdown?.(next); } catch {}
  mdHasDollarRef.current = next.indexOf("$") !== -1;
  dirtyRef.current = true;
  saveLocalDraft(next);
  queueSave();
  redecorateSoon();
  return 1;
}, [buildSourceRegex, replQ, queueSave, saveLocalDraft, findWord, findRegex, refreshToastDecorationsAfterUpdate]);

const replaceAll = React.useCallback(() => {
  const text = noteDraftRef.current || "";
  const reG = buildSourceRegex();
  if (!reG) return 0;
  const reSingle = new RegExp(reG.source, reG.flags.replace('g',''));
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  reG.lastIndex = 0;
  let changed = false;
  while ((m = reG.exec(text))) {
    const s = m.index;
    const e = s + (m[0]?.length || 0);
    if (e === s) { reG.lastIndex++; continue; }
    if (findWord && !findRegex) {
      const prev = text[s - 1];
      const next = text[e];
      if (isWordChar(prev) || isWordChar(next)) continue;
    }
    out += text.slice(last, s) + m[0].replace(reSingle, replQ);
    last = e; changed = true;
  }
  out += text.slice(last);
  if (!changed) return 0;
  noteDraftRef.current = out;
  try { toastRef.current?.getInstance?.()?.setMarkdown?.(out); } catch {}
  mdHasDollarRef.current = out.indexOf("$") !== -1;
  dirtyRef.current = true;
  saveLocalDraft(out);
  queueSave();
  redecorateSoon();
  return 1;
}, [buildSourceRegex, replQ, queueSave, saveLocalDraft, findWord, findRegex, refreshToastDecorationsAfterUpdate]);

// 卸载清理定时器 & 高亮
React.useEffect(() => {
  return () => {
    if (findScheduleRef.current) {
      window.clearTimeout(findScheduleRef.current);
      findScheduleRef.current = null;
    }
    clearFindHighlights();
  };
}, [clearFindHighlights]);

// MutationObserver: auto rehighlight after DOM mutation (always re-render KaTeX, then optionally highlights)
React.useEffect(() => {
  if (editMode !== 'toast') return;
  const host = getToastContentHost();
  if (!host) return;
  if (moRef.current) { moRef.current.disconnect(); moRef.current = null; }
  const mo = new MutationObserver(() => {
    if (decoPhaseRef.current) return; // ignore self-caused mutations
    if (moTimerRef.current) { clearTimeout(moTimerRef.current); moTimerRef.current = null; }
    moTimerRef.current = window.setTimeout(() => {
      // 先把编辑器真实 Markdown 同步回模型（覆盖不触发 onChange 的修改，如 exec/insertText）
      try { syncToastModelFromInst(); } catch {}

      // 任何内容变更先刷新数学，再按需刷新高亮（不用等空闲）
      try {
        decoPhaseRef.current = true;
        renderMathInToast(toastRootRef.current || undefined);
        console.log("[IP] MutationObserver: calling maskToastDataUrls");
        try { maskToastDataUrls(toastRootRef.current || undefined); } catch {}
      } finally {
        decoPhaseRef.current = false;
      }
      if (findOpen && findQ) applyFindHighlights();
    }, 5);
  });
  mo.observe(host, { childList: true, characterData: true, subtree: true });
  moRef.current = mo;
  return () => {
    mo.disconnect();
    moRef.current = null;
    if (moTimerRef.current) { clearTimeout(moTimerRef.current); moTimerRef.current = null; }
  };
}, [editMode, getToastContentHost, findOpen, findQ, applyFindHighlights]);
const toastInsert = React.useCallback((text: string) => {
  const inst = toastRef.current?.getInstance?.();
  if (!inst) return;
  try {
    inst.insertText(text);
  } catch {}
  // 立即刷预览 + 同步到模型 + 重绘装饰
  try { forceToastPreviewSync(); } catch {}
  try { syncToastModelFromInst(); } catch {}
  try { redecorateSoon?.(); } catch {}
  // 兜底：Toast 可能异步合并事务，稍后再同步一次
  window.setTimeout(() => { try { syncToastModelFromInst(); } catch {} }, 30);
}, [syncToastModelFromInst, forceToastPreviewSync, redecorateSoon]);
  const noteDraftRef = React.useRef<string>("");
  const saveDebounceRef = React.useRef<number | null>(null);
  const saveAbortRef = React.useRef<AbortController | null>(null);
  const [editorKey, setEditorKey] = React.useState(0); // 触发 textarea 重新挂载以刷新 defaultValue
  // —— 内容就绪与首帧保存抑制 ——
const [contentReady, setContentReady] = React.useState(false);
const contentReadyRef = React.useRef(false);
const suppressSaveRef = React.useRef(true); // 首次挂载/切换模式后，忽略编辑器初始化 onChange

// 每次重新挂载编辑器（切模式或 editorKey 变）都抑制一次“首帧保存”
React.useEffect(() => { suppressSaveRef.current = true; }, [editorKey, editMode]);

  // --- 本地草稿与脏标记 ---
  const dirtyRef = React.useRef(false);
  const lastServerContentRef = React.useRef<string>("");

  const readLocalDraft = React.useCallback((): { content: string; ts: number } | null => {
    try {
      const { draft } = getDraftKeys();
      const raw = localStorage.getItem(draft);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (typeof obj?.content === "string" && typeof obj?.ts === "number") return obj;
    } catch {}
    return null;
  }, [getDraftKeys]);

  const getLastServerSavedAt = React.useCallback((): number => {
    try {
      const { meta } = getDraftKeys();
      const v = Number(localStorage.getItem(meta) || "0");
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  }, [getDraftKeys]);

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
  
      const latest = noteDraftRef.current || pullLatestMarkdown();
      console.log("[ReaderView] exportNow -> upsert before export", { id, len: latest.length });
      await upsertByPaper(api, Number(id), latest);
      lastServerContentRef.current = latest;
      dirtyRef.current = false;
      markServerSaved();
    } catch (e: any) {
      console.log("[ReaderView] exportNow save failed", e);
      setNoteError(e?.message || String(e));
    } finally {
      setNoteSaving(false);
    }
    console.log("[ReaderView] exportNow -> exportMarkdown", { id });
    await exportMarkdown(api, Number(id));
  }, [id, api, markServerSaved, pullLatestMarkdown]);

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
        const serverContent = got ? (got.content || "") : "";
        console.log("[ReaderView] loaded content", { id, len: serverContent.length, from: got ? "server" : "none" });
        if (got) setNoteId(got.id); else setNoteId(null);
        lastServerContentRef.current = serverContent;

        // 如果本地草稿比“上次服务器保存时间”新，则优先恢复本地草稿
        const local = readLocalDraft();
        const lastSavedAt = getLastServerSavedAt();
        if (local && typeof local.content === "string" && local.content !== serverContent && local.ts > lastSavedAt) {
          setNoteMd(local.content);
          noteDraftRef.current = local.content;
          setNoteLive(local.content);
          setEditorKey((k) => k + 1);
          contentReadyRef.current = true;
          setContentReady(true);
          suppressSaveRef.current = true; // 新挂载的编辑器首个 onChange 仍需要忽略
          showBubble("已从本地草稿恢复未保存内容");
        } else {
          setNoteMd(serverContent);
          noteDraftRef.current = serverContent;
          setNoteLive(serverContent);
          setEditorKey((k) => k + 1);
          contentReadyRef.current = true;
          setContentReady(true);
          suppressSaveRef.current = true; // 新挂载的编辑器首个 onChange 仍需要忽略
        }
      } catch (e: any) {
        setNoteError(e?.message || String(e));
      }
    })();
  }, [id, api, readLocalDraft, getLastServerSavedAt]);
  // 清理 effect：取消任何 pending 自动保存/请求（防止“幽灵 PUT”覆盖）
  React.useEffect(() => {
    return () => {
      if (saveDebounceRef.current) {
        window.clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      if (saveAbortRef.current) {
        try { saveAbortRef.current.abort(); } catch {}
        saveAbortRef.current = null;
      }
    };
  }, []);

  // 路由变更与页面隐藏时本地草稿落盘与保存中断
  React.useEffect(() => {
    const onRouteStart = () => {
      try { saveLocalDraft(noteDraftRef.current || ""); } catch {}
      if (saveDebounceRef.current) {
        window.clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      if (saveAbortRef.current) {
        try { saveAbortRef.current.abort(); } catch {}
        saveAbortRef.current = null;
      }
    };
    const onBeforeUnload = () => {
      try { saveLocalDraft(noteDraftRef.current || ""); } catch {}
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        try { saveLocalDraft(noteDraftRef.current || ""); } catch {}
      }
    };

    router.events.on("routeChangeStart", onRouteStart);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      router.events.off("routeChangeStart", onRouteStart);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router.events, saveLocalDraft]);
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
  React.useEffect(() => {
    if (editMode !== "toast") return;
    const id = requestAnimationFrame(() => renderMathInToast(toastRootRef.current || undefined));
    return () => cancelAnimationFrame(id);
  }, [editMode, editorKey]);
  React.useEffect(() => {
    if (editMode !== "toast") return;
    const id = requestAnimationFrame(() => {
      renderMathInToast(toastRootRef.current || undefined);
      scheduleApplyFindHighlights();
    });
    return () => cancelAnimationFrame(id);
  }, [editMode, editorKey, scheduleApplyFindHighlights]);
  return (
    <div className="h-screen w-screen flex flex-col" data-theme={theme} suppressHydrationWarning>
      <Head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
        <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
        <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@toast-ui/editor/dist/toastui-editor.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@toast-ui/editor-plugin-code-syntax-highlight/dist/toastui-editor-plugin-code-syntax-highlight.min.css" />
        <script defer src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js"></script>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-light.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css" />
        <link rel="stylesheet" href="/css/reader.css" />
        <link rel="stylesheet" href="/css/annot.css" />
        <link rel="stylesheet" href="/css/toc.css" />
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
          /* —— 查找/替换高亮 —— */
          .ip-findbar { background:#fff; border-bottom:1px solid #e5e7eb; }
          .ip-findbar input[type="text"] { height:28px; font-size:12px; }
          .ip-findbar .ip-chip { font-size:11px; padding:2px 6px; border:1px solid #e5e7eb; border-radius:4px; }
          .ip-findbar .ip-chip.active { background:#eef2ff; border-color:#c7d2fe; }
          .ip-find-hit { background:rgba(255,230,0,.45); border-radius:2px; box-shadow:0 0 0 1px rgba(250,204,21,.5) inset; }
          .ip-find-hit--active { background:rgba(255,170,0,.5); outline:2px solid rgba(251,146,60,.9); }
          .ip-find-mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
          /* 1) Always hide the base64 payload span (JS also sets inline style as safety) */
          .toastui-editor-defaultUI .ip-url-b64{ display:none !important; }
          /* 2) Optionally hide the entire URL token element when it is a data URL (we add .ip-url-data on that node) */
          .toastui-editor-defaultUI .ip-url-data{ display:none !important; }
          /* 3) Keep the visible prefix monospace if we ever choose not to hide the whole token */
          .toastui-editor-defaultUI .ip-url-prefix{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
          /* ===== Global: hide ALL scrollbars but keep scrolling ===== */
          html, body, #__next, .page-root, * {
            scrollbar-width: none !important;      /* Firefox */
            -ms-overflow-style: none !important;   /* IE/old Edge */
          }
          /* WebKit-based browsers (Chrome / Safari / new Edge) */
          *::-webkit-scrollbar {
            width: 0 !important;
            height: 0 !important;
            display: none !important;
          }
          *::-webkit-scrollbar-thumb,
          *::-webkit-scrollbar-track,
          *::-webkit-scrollbar-corner {
            background: transparent !important;
            border: none !important;
          }

          /* =========================================================
          Toast UI Editor — Elegant Theme (editor + preview)
          - Softer background, rounded panels
          - Harmonized typography (same as markdown preview)
          - Refined toolbar + buttons + splitter
          - Consistent tokens (blockquote / table / code)
          ========================================================= */

          :root{
          --ip-accent: #4f46e5;              /* Indigo-600 */
          --ip-accent-weak: #eef2ff;         /* Indigo-50 */
          --ip-paper: #ffffff;               /* panel bg */
          --ip-surface: #fafafa;             /* subtle bg */
          --ip-border: #e5e7eb;              /* gray-200 */
          --ip-text: #0f172a;                /* slate-900 */
          --ip-muted: #6b7280;               /* gray-500 */
          --ip-shadow: 0 10px 30px rgba(2,6,23,.06);
          }

          /* Root panel */
          .note-overlay .toastui-editor-defaultUI{
          background: var(--ip-paper);
          border: 1px solid var(--ip-border);
          border-radius: 14px;
          box-shadow: var(--ip-shadow);
          overflow: hidden;
          }

          /* Toolbar */
          .note-overlay .toastui-editor-toolbar{
          background: linear-gradient(180deg, #fff, #fafbff);
          border-bottom: 1px solid var(--ip-border);
          padding: 6px 8px;
          }
          .note-overlay .toastui-editor-toolbar .toastui-editor-toolbar-group{
          gap: 4px;
          }
          .note-overlay .toastui-editor-toolbar .toastui-editor-toolbar-icons{
          border-radius: 8px;
          transition: background .15s ease, transform .05s ease;
          }
          .note-overlay .toastui-editor-toolbar .toastui-editor-toolbar-icons:hover{
          background: var(--ip-accent-weak);
          }
          .note-overlay .toastui-editor-toolbar .toastui-editor-toolbar-icons:active{
          transform: translateY(1px);
          }
          .note-overlay .toastui-editor-toolbar .toastui-editor-toolbar-icons.active{
          background: color-mix(in srgb, var(--ip-accent) 14%, #fff);
          }

          /* Editor + Preview containers */
          .note-overlay .toastui-editor-main{
          background: var(--ip-paper);
          }
          .note-overlay .toastui-editor-md-container,
          .note-overlay .toastui-editor-ww-container,
          .note-overlay .toastui-editor-md-preview{
          background: var(--ip-paper);
          }

          /* Splitter */
          .note-overlay .toastui-editor-md-splitter{
          width: 2px !important;
          background: linear-gradient(180deg, transparent, var(--ip-border), transparent);
          margin: 0 2px;
          }

          /* CONTENT TYPOGRAPHY INSIDE EDITOR PANES */
          .note-overlay .toastui-editor-contents{
          color: var(--ip-text);
          font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
          line-height: var(--md-line-height);
          padding: 16px 18px 24px;
          }

          /* Headings inside editor (match preview) */
          .note-overlay .toastui-editor-contents h1,
          .note-overlay .toastui-editor-contents h2,
          .note-overlay .toastui-editor-contents h3,
          .note-overlay .toastui-editor-contents h4,
          .note-overlay .toastui-editor-contents h5,
          .note-overlay .toastui-editor-contents h6{
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial;
          line-height: 1.25;
          text-align: center;
          color: #0b1220;
          margin-top: 1.6em;
          margin-bottom: .6em;
          font-weight: 800;
          letter-spacing: .1px;
          }
          .note-overlay .toastui-editor-contents h1{ font-size: 2rem; }
          .note-overlay .toastui-editor-contents h2{ font-size: 1.6rem; }
          .note-overlay .toastui-editor-contents h3{ font-size: 1.25rem; }

          /* Links */
          .note-overlay .toastui-editor-contents a{
          color: var(--ip-accent);
          text-decoration: none;
          }
          .note-overlay .toastui-editor-contents a:hover{ text-decoration: underline; }

          /* Blockquote */
          .note-overlay .toastui-editor-contents blockquote{
          background: var(--ip-accent-weak);
          border-left: 4px solid var(--ip-accent);
          color: #374151;
          padding: .6rem .9rem;
          border-radius: 8px;
          }

          /* Inline code + code block */
          .note-overlay .toastui-editor-contents code:not(pre code){
          background: #f6f8fa;
          border: 1px solid #eef2f7;
          padding: .15em .35em;
          border-radius: 6px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          }
          .note-overlay .toastui-editor-contents pre{
          background: #0b1020;
          color: #e5e7eb;
          border-radius: 12px;
          padding: 1rem 1.1rem;
          }

          /* Lists: nicer markers */
          .note-overlay .toastui-editor-contents ul>li::marker{ color: var(--ip-accent); }
          .note-overlay .toastui-editor-contents ol>li::marker{ color: var(--ip-accent); font-weight: 700; }

          /* Tables */
          .note-overlay .toastui-editor-contents table{
          border-collapse: collapse;
          margin: 0.1rem auto;
          min-width: 60%;
          background: #fff;
          border: 1px solid var(--ip-border);
          border-radius: 10px;
          padding: 0;
          overflow: hidden;
          }
          .note-overlay .toastui-editor-contents p {
            text-indent: 2em;
          }
          .note-overlay .toastui-editor-contents thead th{
          background: #f8fafc;
          font-weight: 700;
          }
          .note-overlay .toastui-editor-contents th,
          .note-overlay .toastui-editor-contents td{
          border-bottom: 1px solid var(--ip-border);
          padding: .6rem .8rem;
          text-align: center;
          }
          .note-overlay .toastui-editor-contents tbody tr:nth-child(odd) td{
          background: #fbfdff;
          }

          /* Preview panel subtle separation */
          .note-overlay .toastui-editor-md-preview{
          border-left: 1px solid var(--ip-border);
          }
          .note-overlay .toastui-editor-md-preview .toastui-editor-contents{
          background: var(--ip-surface);
          }

          /* Toolbar dropdowns / color pickers / popups */
          .note-overlay .toastui-editor-popup{
          border-radius: 10px;
          border: 1px solid var(--ip-border);
          box-shadow: var(--ip-shadow);
          }

          /* Findbar badges & small chips that you render (inherit accent) */
          .ip-chip, .ip-badge{
          background: var(--ip-accent-weak);
          color: var(--ip-accent);
          border: 1px solid color-mix(in srgb, var(--ip-accent) 20%, #fff);
          border-radius: 8px;
          }

          /* Hover card for links in preview (optional, safe) */
          .markdown-body a{
          color: var(--ip-accent);
          }
          .markdown-body a:hover{
          text-decoration: none;
          background: color-mix(in srgb, var(--ip-accent) 8%, #fff);
          box-shadow: inset 0 -2px 0 var(--ip-accent);
          border-radius: 3px;
          }
          /* === Extra polish for Editor + Preview === */
          /* 图片居中显示 */
          .note-overlay .toastui-editor-contents img,
          .markdown-body img {
            display: block;
            margin: 1.2rem auto;
            max-width: 100%;
          }
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
                      const nxt: "markdown" | "toast" = m === "markdown" ? "toast" : "markdown";
                      if (nxt === "toast") setEditorKey((k) => k + 1); // 进入 Toast 需要重挂载以刷新 initialValue
                      return nxt;
                    });
                  }}
                  onSwitchToast={() => {
                    setEditMode((m) => {
                      if (m !== "toast") setEditorKey((k) => k + 1);
                      return "toast";
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
                <button
                  className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                  onClick={() => { const willOpen = !findOpen; setFindOpen(willOpen); if (willOpen) redecorateSoon(); }}
                >
                  查找/替换
                </button>
                  <button className="px-2 py-1 rounded border text-xs hover:bg-gray-50" onClick={exportNow}>
                    导出 .md
                  </button>
                  <button className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-50" onClick={() => setNoteOpen(false)}>
                    关闭
                  </button>
                </div>
              </div>
              {findOpen && (
                <div className="ip-findbar px-3 py-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={findQ}
                    onChange={(e) => setFindQ(e.target.value)}
                    placeholder="查找…（支持正则）"
                    className="px-2 border rounded w-[32%] ip-find-mono"
                  />
                  <input
                    type="text"
                    value={replQ}
                    onChange={(e) => setReplQ(e.target.value)}
                    placeholder="替换为…（可用 $&, $1…）"
                    className="px-2 border rounded w-[32%] ip-find-mono"
                  />
                  <button className="px-2 py-1 border rounded text-xs" onClick={gotoPrev}>上一个</button>
                  <button className="px-2 py-1 border rounded text-xs" onClick={gotoNext}>下一个</button>
                  <button className="px-2 py-1 border rounded text-xs" onClick={() => { replaceOneAt(findActive); }}>替换</button>
                  <button className="px-2 py-1 border rounded text-xs" onClick={() => { replaceAll(); }}>全部替换</button>
                  <span className="text-xs text-gray-500 ml-2">{findCount ? `${findActive + 1}/${findCount}` : "0/0"}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button className={`ip-chip ${findCase ? "active" : ""}`} onClick={() => setFindCase(v => !v)} title="区分大小写">Aa</button>
                    <button className={`ip-chip ${findWord ? "active" : ""}`} onClick={() => setFindWord(v => !v)} title="全词匹配">W</button>
                    <button className={`ip-chip ${findRegex ? "active" : ""}`} onClick={() => setFindRegex(v => !v)} title="正则">.*</button>
                  </div>
                </div>
              )}
              {/* 左列覆盖内容区（编辑器） */}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="min-w-0 min-h-0 flex-1 overflow-hidden">
                  {editMode === "toast" ? (
                    <div className="h-full" ref={toastRootRef}>
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
                          if (!contentReadyRef.current) return;
                          try {
                            const inst = (toastRef.current as any)?.getInstance?.();
                            const previewHost = toastRootRef.current?.querySelector(".toastui-editor-contents") as HTMLElement | null;
                            const md = readToastMarkdown(inst, previewHost);
                        
                            const prevLen = (noteDraftRef.current || "").length;
                            noteDraftRef.current = md;
                            mdHasDollarRef.current = md.indexOf("$") !== -1;
                            console.log("[ReaderView] TUI onChange", { prevLen, nextLen: md.length, suppress: suppressSaveRef.current });
                        
                            if (suppressSaveRef.current) suppressSaveRef.current = false;
                            dirtyRef.current = true;
                            try { saveLocalDraft(md); } catch {}
                            queueSave(md);                          // ← 关键：不再“再读一次”，直接传
                          } catch (e) {
                            console.log("[ReaderView] TUI onChange read markdown failed", e);
                          }
                          scheduleRenderToastMath();
                          if (findOpen && findQ) scheduleApplyFindHighlights();
                        }}
                      />
                    </div>
                  ) : (
                    <textarea
                      ref={noteTextRef}
                      className="w-full h-full p-3 font-mono text-sm outline-none note-textarea"
                      defaultValue={noteDraftRef.current || noteMd}
                      onChange={(e) => {
                        const v = e.target.value;
                        noteDraftRef.current = v;
                        dirtyRef.current = true;
                        saveLocalDraft(v);
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
              <div className="relative ip-anno-layer" style={{ height: Math.max(sidebarHeight, 200) }}>
                {noteLayout.map(({ id: nid, top }) => {
                  const a = annos.find((x) => x.id === nid);
                  if (!a) return null;
                  return (
                    <div
                      key={`note-${nid}`}
                      className="ip-anno-card"
                      style={{ top }}
                      onClick={() => {
                        const host = mdContainerRef.current;
                        if (!host) return;
                        host.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
                      }}
                    >
                      {/* 头部：时间 + 颜色点 */}
                      <div className="ip-anno-head">
                        <div>{new Date(a.created_at).toLocaleString()}</div>
                        <div className="ip-anno-dot" title={a.color} style={{ background: a.color }} />
                      </div>

                      {/* Markdown 内容（独立 UI，不依赖 prose） */}
                      <div className="ip-anno-body">
                        {a.note ? (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}
                          >
                            {a.note}
                          </ReactMarkdown>
                        ) : (
                          <span className="text-gray-400">(无备注)</span>
                        )}
                      </div>

                      {/* 被高亮的原文摘录（两行收纳） */}
                      <div className="ip-anno-quote">{a.anchor.quote}</div>

                      <div className="ip-anno-actions" onClick={(e) => e.stopPropagation()}>
                        {/* 可选：编辑入口保留占位 */}
                        {/* <button className="ip-anno-btn" onClick={() => {/* TODO: 编辑功能 */ /*}}>编辑</button> */}
                        <button
                          className="ip-anno-btn"
                          title="删除此批注"
                          onClick={() => deleteAnnotation(a.id)}
                        >
                          🗑️ 删除
                        </button>
                      </div>
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