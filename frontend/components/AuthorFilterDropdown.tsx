import React from "react";
import ReactDOM from "react-dom";

import { ChevronDown } from "lucide-react";

function AuthorFilterDropdown({
    authors, value, onChange,
  }: { authors: string[]; value: string[]; onChange: (names: string[]) => void }) {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState("");
    const btnRef = React.useRef<HTMLButtonElement | null>(null);
    const popRef = React.useRef<HTMLDivElement | null>(null);
    const [mounted, setMounted] = React.useState(false);
    const [pos, setPos] = React.useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 360 });
  
    React.useEffect(() => setMounted(true), []);
  
    React.useEffect(() => {
      const onClick = (e: MouseEvent) => {
        const t = e.target as Node;
        if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
        setOpen(false);
      };
      window.addEventListener("click", onClick, true);
      return () => window.removeEventListener("click", onClick, true);
    }, []);
  
    const place = React.useCallback(() => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 360;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
      const top = Math.min(window.innerHeight - 8, r.bottom + 8);
      setPos({ left, top, width });
    }, []);
  
    React.useEffect(() => {
      if (!open) return;
      place();
      const on = () => place();
      window.addEventListener("resize", on);
      window.addEventListener("scroll", on, true);
      return () => {
        window.removeEventListener("resize", on);
        window.removeEventListener("scroll", on, true);
      };
    }, [open, place]);
  
    const filtered = React.useMemo(
      () => authors.filter(n => !q || n.toLowerCase().includes(q.toLowerCase())),
      [authors, q]
    );
  
    const toggle = (name: string) => {
      if (value.includes(name)) onChange(value.filter(n => n !== name));
      else onChange([...value, name]);
    };
    const selectAll = () => onChange(filtered);
    const clearAll = () => onChange([]);
  
    const summary = React.useMemo(() => {
      if (!value.length) return <span className="text-gray-500">全部作者</span>;
      const head = value.slice(0, 3);
      const rest = value.length - head.length;
      return (
        <span className="flex items-center gap-1 flex-wrap">
          {head.map(n => (
            <span key={n} className="text-[11px] px-2 py-[2px] rounded-full border inline-flex items-center gap-1 border-slate-300 bg-white">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              {n}
            </span>
          ))}
          {rest > 0 && <span className="text-xs text-gray-500">+{rest}</span>}
        </span>
      );
    }, [value]);
  
    const popover = (
      <div
        ref={popRef}
        className="fixed z-[1000] rounded-xl border bg-white shadow-xl"
        style={{ left: pos.left, top: pos.top, width: pos.width }}
      >
        <div className="p-2 border-b bg-gray-50 flex items-center gap-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索作者…"
            className="flex-1 text-sm px-2 py-1 rounded-md border bg-white"
          />
          <button className="text-xs px-2 py-1 rounded border" onClick={selectAll}>全选</button>
          <button className="text-xs px-2 py-1 rounded border" onClick={clearAll}>清空</button>
        </div>
        <div className="max-h-64 overflow-auto p-1">
          {filtered.map(name => {
            const checked = value.includes(name);
            return (
              <label key={name}
                     className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(name)} />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                <span className="text-sm">{name}</span>
              </label>
            );
          })}
          {!filtered.length && <div className="p-3 text-center text-sm text-gray-400">没有匹配的作者</div>}
        </div>
        <div className="p-2 border-t text-right">
          <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={() => setOpen(false)}>完成</button>
        </div>
      </div>
    );
  
    return (
      <div className="relative">
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className="flex items-center gap-2 px-2 py-1 rounded-md border bg-white hover:bg-gray-50"
          title={value.length ? `已选 ${value.length} 位作者` : "全部作者"}
        >
          <span className="text-xs text-gray-500">按作者：</span>
          {summary}
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </button>
  
        {open && mounted ? ReactDOM.createPortal(popover, document.body) : null}
      </div>
    );
  }

  export default AuthorFilterDropdown;