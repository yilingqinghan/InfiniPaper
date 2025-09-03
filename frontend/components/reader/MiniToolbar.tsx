"use client";

import React from "react";

type Props = {
  editMode: "wysiwyg" | "markdown" | "toast";
  onToggleMode: () => void;
  onSwitchToast: () => void;
  toastExec?: (cmd: string, payload?: any) => void;
  toastInsert?: (text: string) => void;
  noteTextRef?: React.RefObject<HTMLTextAreaElement>;
  queueSave: () => void;
  snapshotFromTextarea: (el: HTMLTextAreaElement) => void;
  updateCaretFromTextarea: (el: HTMLTextAreaElement) => void;
  handlePickImage: () => void;
};

export default function MiniToolbar({
  editMode,
  onToggleMode,
  onSwitchToast,
  toastExec,
  toastInsert,
  noteTextRef,
  queueSave,
  snapshotFromTextarea,
  updateCaretFromTextarea,
  handlePickImage,
}: Props) {
  const [showEmoji, setShowEmoji] = React.useState(false);
  const EMOJIS = ["✅","❓","💡","🔥","📌","⭐️","📝","⚠️","🚀","🙂","🤔","👍","👎"];

  const wysi = (type: string, payload?: any) => {
    window.dispatchEvent(new CustomEvent("IP_WYSIWYG_CMD", { detail: { type, payload } }));
  };
  const insertText = (text: string) => {
    window.dispatchEvent(new CustomEvent("IP_WYSIWYG_INSERT_TEXT", { detail: { text } }));
  };

  const applyWrapDirect = (before: string, after = "") => {
    const el = noteTextRef?.current; if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const val = el.value;
    const sel = val.slice(start, end);
    const next = val.slice(0, start) + before + sel + after + val.slice(end);
    el.value = next;
    const pos = start + before.length + sel.length;
    (el as any)._value = next;
    queueSave();
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      updateCaretFromTextarea(el);
      snapshotFromTextarea(el);
    });
  };

  const applyUnorderedListDirect = () => {
    const el = noteTextRef?.current; if (!el) return;
    const start = el.selectionStart ?? 0; const end = el.selectionEnd ?? 0; const val = el.value;
    const lineStart = val.lastIndexOf("\\n", start - 1) + 1;
    let endIdx = val.indexOf("\\n", end); if (endIdx === -1) endIdx = val.length;
    const block = val.slice(lineStart, endIdx);
    const lines = block.split("\\n");
    const mod = lines.map(l => (!l.trim() ? l : l.startsWith("- ") ? l : `- ${l}`)).join("\\n");
    const next = val.slice(0, lineStart) + mod + val.slice(endIdx);
    el.value = next; (el as any)._value = next; queueSave();
    requestAnimationFrame(() => { updateCaretFromTextarea(el); snapshotFromTextarea(el); });
  };

  const applyOrderedListDirect = () => {
    const el = noteTextRef?.current; if (!el) return;
    const start = el.selectionStart ?? 0; const end = el.selectionEnd ?? 0; const val = el.value;
    const lineStart = val.lastIndexOf("\\n", start - 1) + 1;
    let endIdx = val.indexOf("\\n", end); if (endIdx === -1) endIdx = val.length;
    const block = val.slice(lineStart, endIdx);
    const lines = block.split("\\n");
    let idx = 1;
    const mod = lines.map(l => (!l.trim() ? l : `${idx++}. ${l.replace(/^\\s*\\d+\\.\\s+/, "")}`)).join("\\n");
    const next = val.slice(0, lineStart) + mod + val.slice(endIdx);
    el.value = next; (el as any)._value = next; queueSave();
    requestAnimationFrame(() => { updateCaretFromTextarea(el); snapshotFromTextarea(el); });
  };

  const insertEmoji = (em: string) => {
    if (editMode === "toast") { toastInsert?.(em); setShowEmoji(false); return; }
    if (!noteTextRef?.current) { insertText(em); setShowEmoji(false); return; }
    const el = noteTextRef.current; const s = el.selectionStart ?? 0; const e = el.selectionEnd ?? s;
    const val = el.value; const next = val.slice(0, s) + em + val.slice(e);
    el.value = next; (el as any)._value = next; queueSave();
    requestAnimationFrame(() => {
      el.focus(); el.setSelectionRange(s + em.length, s + em.length);
      updateCaretFromTextarea(el); snapshotFromTextarea(el);
    });
    setShowEmoji(false);
  };

  return (
    <div className="flex items-center gap-1 ml-2 text-sm">
      <span className="text-xs text-gray-400 mr-1">格式</span>
      <button className="px-2 py-0.5 border rounded text-amber-800 bg-amber-50 border-amber-300 hover:bg-amber-100"
        onClick={() => { if (editMode === "toast") toastExec?.("bold"); else if (!noteTextRef?.current) wysi("bold"); else applyWrapDirect("**","**"); }}>B</button>
      <button className="px-2 py-0.5 border rounded hover:bg-gray-50"
        onClick={() => { if (editMode === "toast") toastExec?.("italic"); else if (!noteTextRef?.current) wysi("italic"); else applyWrapDirect("*","*"); }}>I</button>
      <button className="px-2 py-0.5 border rounded text-emerald-800 bg-emerald-50 border-emerald-300 hover:bg-emerald-100"
        onClick={() => { if (editMode === "toast") toastExec?.("underline"); else if (!noteTextRef?.current) wysi("underline"); else applyWrapDirect("<u>","</u>"); }}>U</button>

      <button className="px-2 py-0.5 border rounded text-fuchsia-800 bg-fuchsia-50 border-fuchsia-300 hover:bg-fuchsia-100"
        onClick={() => {
          if (editMode === "toast") {
            const url = window.prompt("输入链接地址（URL）", "https://");
            if (url) toastExec?.("addLink", { url, target: "_blank" });
            return;
          }
          if (!noteTextRef?.current) { wysi("link"); return; }
          const el = noteTextRef.current!;
          const s = el.selectionStart ?? 0; const e = el.selectionEnd ?? 0; const sel = el.value.slice(s, e) || "文本";
          const before = `[${sel}](链接)`; const next = el.value.slice(0, s) + before + el.value.slice(e);
          el.value = next; (el as any)._value = next; queueSave();
          const linkStart = s + before.indexOf("链接"); const linkEnd = linkStart + 2;
          requestAnimationFrame(() => { el.focus(); el.setSelectionRange(linkStart, linkEnd); updateCaretFromTextarea(el); snapshotFromTextarea(el); });
        }}
      >📎</button>

      <button className="px-2 py-0.5 border text-xs rounded text-indigo-800 bg-indigo-50 border-indigo-300 hover:bg-indigo-100"
        onClick={() => { if (editMode === "toast") toastExec?.("bulletList"); else if (!noteTextRef?.current) wysi("ul"); else applyUnorderedListDirect(); }}
      >• </button>

      <button className="px-2 py-0.5 border text-xs rounded text-rose-800 bg-rose-50 border-rose-300 hover:bg-rose-100"
        onClick={() => { if (editMode === "toast") toastExec?.("orderedList"); else if (!noteTextRef?.current) wysi("ol"); else applyOrderedListDirect(); }}
      >1. </button>

      <button className="px-2 py-0.5 border text-xs rounded text-slate-800 bg-slate-50 border-slate-300 hover:bg-slate-100"
        onClick={handlePickImage}>图</button>

      <div className="relative">
        <button className="px-2 py-0.5 border rounded text-yellow-800 bg-yellow-50 border-yellow-300 hover:bg-yellow-100" onClick={() => setShowEmoji(v => !v)}>😊</button>
        {showEmoji && (
          <div className="absolute z-10 top-full left-0 mt-1 bg-white border rounded shadow p-1 emojipicker">
            {EMOJIS.map((em) => (
              <button key={em} className="px-1 py-1 rounded hover:bg-gray-50" onClick={() => insertEmoji(em)}>{em}</button>
            ))}
          </div>
        )}
      </div>

      <button className="px-2 py-0.5 border rounded text-xs" title={editMode === "wysiwyg" ? "切换到 Markdown 源码模式" : "切换到所见即所得模式"} onClick={onToggleMode}>
        {editMode === "wysiwyg" ? "源码" : "所见即所得"}
      </button>

      <button className="px-2 py-0.5 border rounded text-xs" title={editMode === "toast" ? "切回所见即所得" : "切换到 Toast UI 编辑器"} onClick={onSwitchToast}>
        {editMode === "toast" ? "所见即所得" : "Toast"}
      </button>
    </div>
  );
}