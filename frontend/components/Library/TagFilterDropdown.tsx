import React from "react";
import ReactDOM from "react-dom";
import { ChevronDown } from "lucide-react";
import { getTagColor } from "./QuickTagPanel";
/* --------------------------- tag filter dropdown --------------------------- */
type Tag = { id: number; name: string; color?: string | null };
function TagFilterDropdown({
    tags, value, onChange,
  }: { tags: Tag[]; value: string[]; onChange: (names: string[]) => void }) {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState("");
    const btnRef = React.useRef<HTMLButtonElement | null>(null);
    const popRef = React.useRef<HTMLDivElement | null>(null);
    const [mounted, setMounted] = React.useState(false);
    const [pos, setPos] = React.useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 320 });
  
    React.useEffect(() => setMounted(true), []);
  
    // 点击外部收起（考虑 portal 后的 body 节点）
    React.useEffect(() => {
      const onClick = (e: MouseEvent) => {
        const t = e.target as Node;
        if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
        setOpen(false);
      };
      window.addEventListener("click", onClick, true);
      return () => window.removeEventListener("click", onClick, true);
    }, []);
  
    // 计算面板位置（贴按钮右对齐，向下 8px）
    const place = React.useCallback(() => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 320;
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
      () => tags.filter(t => !q || t.name.toLowerCase().includes(q.toLowerCase())),
      [tags, q]
    );
  
    const toggle = (name: string) => {
      if (value.includes(name)) onChange(value.filter(n => n !== name));
      else onChange([...value, name]);
    };
    const selectAll = () => onChange(filtered.map(t => t.name));
    const clearAll = () => onChange([]);
  
    const summary = React.useMemo(() => {
      if (!value.length) return <span className="text-gray-500">全部标签</span>;
      const head = value.slice(0, 3);
      const rest = value.length - head.length;
      return (
        <span className="flex items-center gap-1 flex-wrap">
          {head.map(n => {
            const color = getTagColor(n);
            return (
              <span key={n}
                    className="text-[11px] px-2 py-[2px] rounded-full border inline-flex items-center gap-1"
                    style={{ borderColor: color || "#cbd5e1" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: color || "#94a3b8" }} />
                {n}
              </span>
            );
          })}
          {rest > 0 && <span className="text-xs text-gray-500">+{rest}</span>}
        </span>
      );
    }, [value]);
  
    // 主体
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
            placeholder="搜索标签…"
            className="flex-1 text-sm px-2 py-1 rounded-md border bg-white"
          />
          <button className="text-xs px-2 py-1 rounded border" onClick={selectAll}>全选</button>
          <button className="text-xs px-2 py-1 rounded border" onClick={clearAll}>清空</button>
        </div>
        <div className="max-h-64 overflow-auto p-1">
          {filtered.map(t => {
            const checked = value.includes(t.name);
            const color = getTagColor(t.name);
            return (
              <label key={t.id}
                     className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(t.name)} />
                <span className="w-2.5 h-2.5 rounded-full border" style={{ background: color || "transparent" }} />
                <span className="text-sm">{t.name}</span>
              </label>
            );
          })}
          {!filtered.length && <div className="p-3 text-center text-sm text-gray-400">没有匹配的标签</div>}
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
          title={value.length ? `已选 ${value.length} 个标签` : "全部标签"}
        >
          <span className="text-xs text-gray-500">按标签筛选：</span>
          {summary}
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </button>
  
        {open && mounted ? ReactDOM.createPortal(popover, document.body) : null}
      </div>
    );
  }
  export default TagFilterDropdown;