"use client";

import React from "react";

type TocItem = { id: string; text: string; depth: number };

export default function TocPanel({
  tocOpen,
  tocPinned,
  items,
  onTogglePinned,
  onCloseFloating,
  onOpenPinned,
  onGo,
}: {
  tocOpen: boolean;
  tocPinned: boolean;
  items: TocItem[];
  onTogglePinned: () => void;
  onCloseFloating: () => void;
  onOpenPinned: () => void;
  onGo: (id: string) => void;
}) {
  // 紧贴页面右侧，从页头底部到窗口底部
  const [bounds, setBounds] = React.useState<React.CSSProperties | null>(null);
  const recompute = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const headerEl = document.querySelector(".page-header") as HTMLElement | null;
    const rect = headerEl ? headerEl.getBoundingClientRect() : null;
    const top = Math.max(0, rect ? rect.bottom : 0);
    const height = Math.max(0, window.innerHeight - top);
    setBounds({
      position: "fixed",
      top: `${top}px`,
      right: 0,
      height: `${height}px`,
      width: "min(380px, 92vw)",
      zIndex: 60,
      pointerEvents: "none", // 外层不拦截
    } as React.CSSProperties);
  }, []);
  React.useEffect(() => {
    recompute();
    const onScroll = () => recompute();
    const onResize = () => recompute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [recompute]);

  // 只由 tocOpen 控制显示/隐藏；不在这里改动 tocPinned，避免“死循环”
  const open = !!tocOpen;

  if (!bounds) return null;

  return (
          
    <div style={bounds} aria-hidden={!open && !tocPinned}>
      {/* 背景：仅在“未固定且打开”时可点击关闭 */}
      <div
        className={`absolute inset-0 transition-opacity duration-200 ${
          open && !tocPinned ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ background: "transparent", pointerEvents: open && !tocPinned ? "auto" : "none" }}
        onClick={() => {
          if (!tocPinned) onCloseFloating();
        }}
      />

      {/* 抽屉体 */}
      <aside
        className={`ip-toc-drawer ${open ? "ip-toc-open" : "ip-toc-closed"}`}
        style={{ pointerEvents: "auto" }}
        role="navigation"
        aria-label="目录"
      >
        <header className="ip-toc-header">
          <div className="ip-toc-title">目录</div>
          <div className="ip-toc-actions">
            <button
              className={`ip-toc-btn ${tocPinned ? "is-active" : ""}`}
              title={tocPinned ? "取消固定" : "固定"}
              onClick={() => onTogglePinned()}
            >
              {tocPinned ? "已固定" : "固定"}
            </button>
            <button
              className="ip-toc-btn"
              onClick={() => onCloseFloating()}
              title="收起"
            >
              收起
            </button>
          </div>
        </header>

        <div className="ip-toc-body">
          {items && items.length > 0 ? (
            <ul className="ip-toc-list">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="ip-toc-item"
                  style={{ paddingLeft: `${10 + (it.depth - 1) * 14}px` }}
                >
                  <button
                    className="ip-toc-link"
                    onClick={() => onGo(it.id)}
                    title={it.text}
                  >
                    <span
                      className={`ip-toc-dot d${Math.max(1, Math.min(6, it.depth))}`}
                    />
                    <span className="ip-toc-text">{it.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ip-toc-empty">暂无标题</div>
          )}
        </div>
      </aside>
    </div>
  );
}