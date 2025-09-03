"use client";

import React from "react";
import {
  LexicalComposer,
} from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  TRANSFORMERS,
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import {
  ListNode,
  ListItemNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { CodeNode, $createCodeNode } from "@lexical/code";
import { LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  FORMAT_TEXT_COMMAND,
  $getSelection,
  $isRangeSelection,
  DecoratorNode,
  TextNode,
  $createTextNode,
  KEY_DOWN_COMMAND,
  COMMAND_PRIORITY_LOW,
  $createParagraphNode,
  $getRoot,
  $getNodeByKey,
} from "lexical";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";

const SafeErrorBoundary: any =
  (LexicalErrorBoundary as any) ||
  (({ children }: { children: React.ReactNode }) => <>{children}</>);

// ===== 内联/块级数学节点 =====
class MathInlineNode extends DecoratorNode<JSX.Element> {
  __formula: string;
  static getType() { return "math-inline"; }
  static clone(node: MathInlineNode) { return new MathInlineNode(node.__formula, node.__key); }
  constructor(formula: string, key?: string) { super(key); this.__formula = formula; }
  createDOM() { const span = document.createElement("span"); span.className = "ip-math-inline"; span.setAttribute("data-math","inline"); return span; }
  updateDOM() { return false; }
  exportJSON() { return { type:"math-inline", version:1, formula:this.__formula }; }
  static importJSON(j:any) { return new MathInlineNode(j.formula); }
  setFormula(next:string){ const self = this.getWritable<MathInlineNode>(); self.__formula = next; }
  decorate() {
    const key = this.getKey();
    const formula = this.__formula;
    const katex = (typeof window !== "undefined" ? (window as any).katex : null);
    const html = katex ? katex.renderToString(formula, { displayMode:false, throwOnError:false }) : formula;
    const InlineMathView: React.FC = () => {
      const [editor] = useLexicalComposerContext();
      const onInput = React.useCallback((e: React.FormEvent<HTMLSpanElement>) => {
        const raw = (e.currentTarget.textContent || "");
        const m = raw.match(/^\\$(.*)\\$/s);
        const inner = m ? m[1] : raw.replace(/^\\\\$/, "").replace(/\\\\$/, "");
        editor.update(() => {
          const node = $getNodeByKey(key) as unknown as MathInlineNode | null;
          if (node) node.setFormula(inner);
        });
      }, [editor]);
      const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => { if (e.key === "Enter") e.preventDefault(); };
      return (
        <>
          <span className="katex-view" dangerouslySetInnerHTML={{ __html: html }} />
          <span className="math-raw" contentEditable suppressContentEditableWarning onInput={onInput} onKeyDown={onKeyDown}>
            {`$${formula}$`}
          </span>
        </>
      );
    };
    return <InlineMathView />;
  }
  isInline(){ return true; }
  getTextContent(){ return `$${this.__formula}$`; }
}
function $createMathInlineNode(formula: string) { return new MathInlineNode(formula); }

class MathBlockNode extends DecoratorNode<JSX.Element> {
  __formula: string;
  static getType(){ return "math-block"; }
  static clone(node: MathBlockNode){ return new MathBlockNode(node.__formula, node.__key); }
  constructor(formula:string, key?:string){ super(key); this.__formula = formula; }
  createDOM(){ const div = document.createElement("div"); div.className="ip-math-block"; div.setAttribute("data-math","block"); return div; }
  updateDOM(){ return false; }
  exportJSON(){ return { type:"math-block", version:1, formula:this.__formula }; }
  static importJSON(j:any){ return new MathBlockNode(j.formula); }
  setFormula(next:string){ const self = this.getWritable<MathBlockNode>(); self.__formula = next; }
  decorate(){
    const key = this.getKey();
    const formula = this.__formula;
    const katex = (typeof window !== "undefined" ? (window as any).katex : null);
    const html = katex ? katex.renderToString(formula, { displayMode:true, throwOnError:false }) : formula;
    const BlockMathView: React.FC = () => {
      const [editor] = useLexicalComposerContext();
      const onInput = React.useCallback((e: React.FormEvent<HTMLDivElement>) => {
        const raw = (e.currentTarget.textContent || "");
        let body = raw;
        const mm = raw.match(/^\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*$/);
        if (mm) {
          body = mm[1];
        } else {
          const lines = raw.split(/\\r?\\n/);
          if (lines[0]?.trim() === "$$") lines.shift();
          if (lines[lines.length - 1]?.trim() === "$$") lines.pop();
          body = lines.join("\\n");
        }
        const inner = body.replace(/^\\n+/, "").replace(/\\n+$/, "");
        editor.update(() => {
          const node = $getNodeByKey(key) as unknown as MathBlockNode | null;
          if (node) node.setFormula(inner);
        });
      }, [editor]);
      return (
        <>
          <div className="katex-view" dangerouslySetInnerHTML={{ __html: html }} />
          <div className="math-raw" contentEditable suppressContentEditableWarning onInput={onInput}>
            {`$$\\n${formula}\\n$$`}
          </div>
        </>
      );
    };
    return <BlockMathView />;
  }
  isInline(){ return false; }
  getTextContent(){ return `$$${this.__formula}$$`; }
}
function $createMathBlockNode(formula: string) { return new MathBlockNode(formula); }

// ===== 插件：编辑段高亮 / 数学&代码围栏解析 / 代码高亮 =====
function ActiveParagraphHighlightPlugin() {
  const [editor] = useLexicalComposerContext();
  const prevRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) {
          if (prevRef.current) {
            prevRef.current.classList.remove("editing-paragraph");
            prevRef.current = null;
          }
          return;
        }
        const anchor = sel.anchor.getNode();
        let topElem: any = anchor.getTopLevelElement ? anchor.getTopLevelElement() : null;
        if (!topElem || topElem.getType?.() === "root") {
          const nodes = sel.getNodes?.() || [];
          for (const n of nodes) {
            const t = n.getTopLevelElement ? n.getTopLevelElement() : null;
            if (t && t.getType?.() !== "root") { topElem = t; break; }
          }
        }
        if (!topElem || topElem.getType?.() === "root") {
          const root = $getRoot();
          const first = (root as any).getFirstChild?.();
          if (!first) {
            if (prevRef.current) {
              prevRef.current.classList.remove("editing-paragraph");
              prevRef.current = null;
            }
            return;
          }
          topElem = first;
        }
        const dom = editor.getElementByKey(topElem.getKey()) as HTMLElement | null;
        if (prevRef.current && prevRef.current !== dom) {
          prevRef.current.classList.remove("editing-paragraph");
        }
        if (dom) {
          dom.classList.add("editing-paragraph");
          prevRef.current = dom;
        }
      });
    });
  }, [editor]);

  return null;
}

function MathKeydownPlugin() {
  const [editor] = useLexicalComposerContext();
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        const key = event.key;
        if (key !== "$" && key !== "`" && key !== "Enter" && key !== " ") return false;
        if (busyRef.current) return false;
        busyRef.current = true;

        setTimeout(() => {
          editor.update(() => {
            try {
              const sel = $getSelection();
              if (!$isRangeSelection(sel)) return;
              const anchor = sel.anchor.getNode();
              const top: any = anchor.getTopLevelElementOrThrow();
              const type = top?.getType?.() || "";
              if (type === "math-block") return;

              const text: string = top.getTextContent() || "";
              const trimmed = text.trim();

              // 块级公式分行 $$ ... $$
              if (trimmed === "$$") {
                let cur: any = top.getNextSibling?.();
                const between: any[] = [];
                let end: any = null;
                while (cur) {
                  const t = (cur.getTextContent?.() || "").trim();
                  if (t === "$$") { end = cur; break; }
                  between.push(cur);
                  cur = cur.getNextSibling?.();
                }
                if (!end) {
                  cur = top.getPreviousSibling?.();
                  const rev: any[] = [];
                  let start: any = null;
                  while (cur) {
                    const t = (cur.getTextContent?.() || "").trim();
                    if (t === "$$") { start = cur; break; }
                    rev.push(cur);
                    cur = cur.getPreviousSibling?.();
                  }
                  if (start) {
                    const betweenNodes = rev.reverse();
                    const formula = betweenNodes.map(n => n.getTextContent()).join("\\n").trim();
                    const blk = $createMathBlockNode(formula);
                    start.replace(blk);
                    betweenNodes.forEach(n => n.remove());
                    top.remove();
                    blk.insertAfter($createParagraphNode());
                    return;
                  }
                } else {
                  const formula = between.map(n => n.getTextContent()).join("\\n").trim();
                  const blk = $createMathBlockNode(formula);
                  top.replace(blk);
                  between.forEach(n => n.remove());
                  end.remove();
                  blk.insertAfter($createParagraphNode());
                  return;
                }
              }

              // 同行块级公式：$$...$$
              const mBlockLine = trimmed.match(/^\\$\\$([\\s\\S]+?)\\$\\$/);
              if (mBlockLine) {
                const blk = $createMathBlockNode(mBlockLine[1].trim());
                top.replace(blk);
                blk.insertAfter($createParagraphNode());
                return;
              }

              // 代码围栏 ``` 分行与同行
              if (type !== "code") {
                const startFence = trimmed.match(/^```(?:(?<lang>[A-Za-z0-9_+-]+))?$/);
                if (startFence) {
                  let cur: any = top.getNextSibling?.();
                  const between: any[] = [];
                  let end: any = null;
                  while (cur) {
                    const t = (cur.getTextContent?.() || "").trim();
                    if (t === "```") { end = cur; break; }
                    between.push(cur);
                    cur = cur.getNextSibling?.();
                  }
                  if (end) {
                    const code = between.map(n => n.getTextContent()).join("\\n");
                    const lang = (startFence.groups?.lang || "").toLowerCase() || undefined;
                    const codeNode = $createCodeNode(lang);
                    codeNode.append($createTextNode(code));
                    top.replace(codeNode);
                    between.forEach(n => n.remove());
                    end.remove();
                    codeNode.insertAfter($createParagraphNode());
                    return;
                  }
                }
                if (trimmed === "```") {
                  let cur: any = top.getPreviousSibling?.();
                  const betweenRev: any[] = [];
                  let start: any = null;
                  let lang: string | undefined = undefined;
                  while (cur) {
                    const t = (cur.getTextContent?.() || "").trim();
                    const m = t.match(/^```(?:(?<lang>[A-Za-z0-9_+-]+))?$/);
                    if (m) { start = cur; lang = (m.groups?.lang || "").toLowerCase() || undefined; break; }
                    betweenRev.push(cur);
                    cur = cur.getPreviousSibling?.();
                  }
                  if (start) {
                    const between = betweenRev.reverse();
                    const code = between.map(n => n.getTextContent()).join("\\n");
                    const codeNode = $createCodeNode(lang);
                    codeNode.append($createTextNode(code));
                    start.replace(codeNode);
                    between.forEach(n => n.remove());
                    top.remove();
                    codeNode.insertAfter($createParagraphNode());
                    return;
                  }
                }
                const mInlineFence = trimmed.match(/^```([\\s\\S]+)```$/);
                if (mInlineFence) {
                  const codeNode = $createCodeNode(undefined);
                  codeNode.append($createTextNode(mInlineFence[1]));
                  top.replace(codeNode);
                  codeNode.insertAfter($createParagraphNode());
                  return;
                }
              }

              // 行内公式 $...$
              if (type !== "code" && text.includes("$")) {
                const regex = /\\$([^$]+)\\$/g;
                const childrenOfTop: any[] = top?.getChildren?.() || [];
                const hasMathChild = childrenOfTop.some((n: any) => n?.getType?.() === "math-inline" || n?.getType?.() === "math-block");
                if (!hasMathChild) {
                  let idx = 0, m: RegExpExecArray | null;
                  const parts: Array<string | { math: string }> = [];
                  while ((m = regex.exec(text)) !== null) {
                    if (m.index > idx) parts.push(text.slice(idx, m.index));
                    parts.push({ math: m[1] });
                    idx = m.index + m[0].length;
                  }
                  if (parts.length) {
                    if (idx < text.length) parts.push(text.slice(idx));
                    top.clear();
                    parts.forEach(seg => {
                      if (typeof seg === "string" && seg) top.append($createTextNode(seg));
                      else top.append($createMathInlineNode((seg as any).math));
                    });
                    return;
                  }
                }
              }
            } finally {
              busyRef.current = false;
            }
          });
        }, 0);

        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor]);

  return null;
}

function CodeHighlightOnEditPlugin() {
  const [editor] = useLexicalComposerContext();
  React.useEffect(() => {
    const doHighlight = () => {
      const root = editor.getRootElement();
      const hljs = (typeof window !== "undefined" ? (window as any).hljs : null);
      if (!root || !hljs) return;
      root.querySelectorAll("pre code").forEach((el) => {
        try { hljs.highlightElement(el as HTMLElement); } catch {}
      });
    };
    const un1 = editor.registerUpdateListener(() => { requestAnimationFrame(doHighlight); });
    const un2 = editor.registerMutationListener(CodeNode, () => { requestAnimationFrame(doHighlight); });
    setTimeout(doHighlight, 0);
    return () => { un1(); un2(); };
  }, [editor]);
  return null;
}

// ===== 桥：响应顶部工具栏命令（粗体/斜体/下划线/列表/链接等） =====
function WysiwygBridge() {
  const [editor] = useLexicalComposerContext();
  React.useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const type = detail.type as string;
      if (!type) return;
      switch (type) {
        case "bold":
        case "italic":
        case "underline":
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
          break;
        case "ul":
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
          break;
        case "ol":
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
          break;
        case "link": {
          const url: string | null =
            detail.payload ?? window.prompt("输入链接地址（URL）", "https://");
          if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
          break;
        }
        default:
          break;
      }
    };
    const onInsert = (e: Event) => {
      const { text } = (e as CustomEvent).detail || {};
      if (!text) return;
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) sel.insertText(text);
      });
    };
    window.addEventListener("IP_WYSIWYG_CMD" as any, onCmd as any);
    window.addEventListener("IP_WYSIWYG_INSERT_TEXT" as any, onInsert as any);
    return () => {
      window.removeEventListener("IP_WYSIWYG_CMD" as any, onCmd as any);
      window.removeEventListener("IP_WYSIWYG_INSERT_TEXT" as any, onInsert as any);
    };
  }, [editor]);
  return null;
}

// ===== 初始化 + 主编辑器 =====
function InitFromMarkdown({ markdown }: { markdown: string }) {
  const [editor] = useLexicalComposerContext();
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (done) return;
    editor.update(() => { $convertFromMarkdownString(markdown || "", TRANSFORMERS); });
    setDone(true);
  }, [done, editor, markdown]);
  return null;
}

export default function WysiwygMdEditor({
  initialMarkdown,
  onMarkdownChange,
}: {
  initialMarkdown: string;
  onMarkdownChange: (md: string) => void;
}) {
  const initialConfig = React.useMemo(
    () => ({
      namespace: "paper-note",
      editable: true,
      onError: (e: any) => console.error(e),
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        CodeNode,
        LinkNode,
        MathInlineNode,
        MathBlockNode,
      ],
      theme: {
        text: {
          bold: "ip-bold",
          italic: "ip-italic",
          underline: "ip-underline",
          strikethrough: "ip-strike",
          code: "ip-code",
        },
        link: "ip-link",
      },
    }),
    []
  );

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  const debRef = React.useRef<number | null>(null);
  const scheduleEmit = React.useCallback(
    (md: string) => {
      if (debRef.current) window.clearTimeout(debRef.current);
      debRef.current = window.setTimeout(() => onMarkdownChange(md), 120);
    },
    [onMarkdownChange]
  );

  return (
    <>
      {!mounted ? (
        <div className="w-full h-full" />
      ) : (
        <LexicalComposer initialConfig={initialConfig}>
          <div className="w-full h-full flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-auto">
              <RichTextPlugin
                contentEditable={
                  <ContentEditable className="w-full min-h-full p-3 outline-none text-sm markdown-body ip-editor-root" />
                }
                placeholder={
                  <div className="p-3 text-sm text-gray-400">
                    开始输入…（支持 ** 粗体、# 标题、- 列表、``` 代码、[链接](url) 等）
                  </div>
                }
                ErrorBoundary={SafeErrorBoundary}
              />
              <HistoryPlugin />
              <ListPlugin />
              <LinkPlugin />
              <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
              <OnChangePlugin
                onChange={(editorState) => {
                  editorState.read(() => {
                    const md = $convertToMarkdownString(TRANSFORMERS);
                    scheduleEmit(md);
                  });
                }}
              />
              <ActiveParagraphHighlightPlugin />
              <MathKeydownPlugin />
              <CodeHighlightOnEditPlugin />
              <WysiwygBridge />
              <InitFromMarkdown markdown={initialMarkdown} />
            </div>
          </div>
        </LexicalComposer>
      )}
    </>
  );
}