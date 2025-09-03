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
  // 浮动
  const Floating = tocOpen && !tocPinned && (
    <div data-floating-ui className="fixed z-50 top-[56px] right-4 w-[min(360px,40vw)] max-h-[60vh] overflow-auto bg-white border rounded shadow-lg p-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-gray-500">目录</div>
        <button className="text-xs text-gray-500 hover:text-gray-700" onClick={onOpenPinned}>固定</button>
      </div>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id}>
              <button
                className="w-full text-left text-sm hover:bg-gray-50 rounded px-2 py-1"
                style={{ paddingLeft: `${(it.depth - 1) * 12 + 8}px` }}
                onClick={() => { onGo(it.id); onCloseFloating(); }}
                title={it.text}
              >
                {it.text}
              </button>
            </li>
          ))}
        </ul>
      ) : <div className="text-sm text-gray-400 px-2 py-1">暂无标题</div>}
    </div>
  );

  // 固定
  const Pinned = items.length > 0 && (tocPinned ? (
    <div data-floating-ui className="fixed z-50 top-[56px] right-4 w-[min(320px,34vw)] max-h-[70vh] overflow-auto bg-white border rounded shadow-lg p-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">目录</div>
        <button className="text-xs text-gray-500 hover:text-gray-700" onClick={onTogglePinned}>收起</button>
      </div>
      <ul className="mt-1 space-y-1">
        {items.map((it) => (
          <li key={it.id}>
            <button
              className="w-full text-left text-sm hover:bg-gray-50 rounded px-2 py-1"
              style={{ paddingLeft: `${(it.depth - 1) * 12 + 8}px` }}
              onClick={() => { onGo(it.id); }}
              title={it.text}
            >
              {it.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : (
    items.length > 0 && (
      <button className="fixed z-50 right-4 bottom-4 rounded-full shadow-lg border bg-white px-3 py-2 text-sm" onClick={onOpenPinned} title="打开目录">
        目录
      </button>
    )
  ));

  return (
    <>
      {Floating}
      {Pinned}
    </>
  );
}