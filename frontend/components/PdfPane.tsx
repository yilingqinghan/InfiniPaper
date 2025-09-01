"use client";
import React from "react";
import clsx from "clsx";

type Props = {
  fileUrl: string;         // 必须是 /pdfjs/web/viewer.html?file=... （你现有的路径）
  className?: string;
};

type PdfJsApp = any;       // 简化 TS：直接用 any，避免 pdf.js 的复杂类型约束

/**
 * 通过 iframe 使用 pdf.js viewer，但把原生工具栏隐藏，改用我们自定义的 UI。
 * 不更改 fileUrl（仍然是 /pdfjs/web/viewer.html?file=...），完全保留你原生渲染路径。
 */
export default function PdfPane({ fileUrl, className }: Props) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [app, setApp] = React.useState<PdfJsApp | null>(null);
  const [ready, setReady] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pages, setPages] = React.useState(0);
  const [scale, setScale] = React.useState<string | number>("page-width");
  const [query, setQuery] = React.useState("");

  // 日志：方便你定位
  React.useEffect(() => {
    // console.debug("[PdfPane] fileUrl =", fileUrl);
  }, [fileUrl]);

  // 轮询等待 PDFViewerApplication 挂载，再注入隐藏样式
  const attachToViewer = React.useCallback(async (win: Window) => {
    let tries = 0;
    const maxTries = 300; // 最多等 ~15s（300 * 50ms）
    await new Promise<void>((resolve) => {
      const tick = () => {
        tries++;
        const a = (win as any).PDFViewerApplication;
        if (a && a.eventBus) {
          setApp(a);
          resolve();
          return;
        }
        if (tries > maxTries) {
          resolve();
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });

    const a: PdfJsApp | null = (win as any).PDFViewerApplication || null;
    if (!a) return;

    // 隐藏 pdf.js 自带的工具栏/侧栏，拉满内容区
    try {
      const doc = (win as any).document as Document;
      const style = doc.createElement("style");
      style.innerHTML = `
        #outerContainer #toolbarContainer,
        #sidebarContainer,
        #secondaryToolbar,
        #viewBookmark,
        #viewAttachments {
          display: none !important;
        }
        #viewerContainer {
          top: 0 !important;
          left: 0 !important;
        }
      `;
      doc.head.appendChild(style);
    } catch {}

    // 初始状态
    try {
      // pagesloaded 事件给我们总页数
      a.eventBus.on("pagesloaded", (e: any) => {
        setPages(e.pagesCount || a.pagesCount || a.pdfViewer?.pagesCount || 0);
        setPage(a.pdfViewer?.currentPageNumber || 1);
        setReady(true);
      });

      // 翻页事件
      a.eventBus.on("pagechanging", (e: any) => {
        if (typeof e?.pageNumber === "number") setPage(e.pageNumber);
      });

      // 缩放变化
      a.eventBus.on("scalechanged", (e: any) => {
        setScale(e?.scale || a.pdfViewer?.currentScaleValue || "auto");
      });

      // 适配窗口
      a.pdfViewer.currentScaleValue = "page-width";
    } catch {
      // 忽略
    }
  }, []);

  // iframe onLoad 时附加控制
  const onIframeLoad = React.useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    attachToViewer(win);
  }, [attachToViewer]);

  // —— 控制函数（调用 pdf.js API）——
  const zoomIn = () => app?.zoomIn?.();
  const zoomOut = () => app?.zoomOut?.();
  const fitWidth = () => {
    if (app?.pdfViewer) app.pdfViewer.currentScaleValue = "page-width";
  };
  const fitPage = () => {
    if (app?.pdfViewer) app.pdfViewer.currentScaleValue = "page-fit";
  };
  const rotate = () => {
    if (app?.pdfViewer) {
      const cur = app.pdfViewer.pagesRotation || 0;
      app.pdfViewer.pagesRotation = (cur + 90) % 360;
    }
  };
  const goTo = (n: number) => {
    if (!app?.pdfViewer) return;
    const num = Math.max(1, Math.min(pages || 1, n | 0));
    app.pdfViewer.currentPageNumber = num;
  };
  const find = (text: string) => {
    if (!app?.eventBus || !text.trim()) return;
    // pdf.js viewer 的查找事件
    app.eventBus.dispatch("find", {
      source: null,
      type: "", // 初次查找
      query: text,
      caseSensitive: false,
      entireWord: false,
      phraseSearch: true,
      highlightAll: true,
      findPrevious: false,
    });
  };

  return (
    <div className={clsx("flex flex-col h-full", className)}>
      {/* 顶部自定义工具栏（不改变 fileUrl，完全自己控 UI） */}
      <div className="flex items-center gap-2 px-2 py-1 border-b bg-white">
        <span className="text-xs text-gray-500">{ready ? "已加载" : "加载中…"}</span>
        <div className="h-4 w-px bg-gray-200 mx-1" />
        <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={zoomOut}>－</button>
        <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={zoomIn}>＋</button>
        <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={fitWidth}>适宽</button>
        <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={fitPage}>整页</button>
        <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={rotate}>旋转</button>

        <div className="h-4 w-px bg-gray-200 mx-1" />
        <span className="text-sm text-gray-600">
          页码
          <input
            className="ml-2 w-16 px-2 py-1 border rounded"
            value={page}
            onChange={(e) => setPage(Number(e.target.value) || 1)}
            onBlur={() => goTo(page)}
            onKeyDown={(e) => e.key === "Enter" && goTo(page)}
          />
          <span className="ml-1 text-gray-400">/ {pages || "…"}</span>
        </span>

        <div className="ml-auto flex items-center gap-2">
          <input
            className="w-56 px-2 py-1 border rounded"
            placeholder="查找（Enter 查找）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && find(query)}
          />
          <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => find(query)}>
            查找
          </button>
        </div>
      </div>

      {/* 原生 pdf.js viewer 的 iframe（路径完全保持你的写法） */}
      <iframe
        ref={iframeRef}
        src={fileUrl}
        onLoad={onIframeLoad}
        className="flex-1 w-full h-full"
        style={{ border: "none" }}
        // sandbox 可以按需加：allow-same-origin 对同域样式注入很关键
        sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
      />
    </div>
  );
}