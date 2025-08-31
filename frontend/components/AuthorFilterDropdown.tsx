import React from "react";
import {
    UploadCloud, Plus, Pencil, Trash2, ChevronUp, ChevronDown, ChevronRight,
    GripVertical, Eye, Tag as TagIcon, Folder as FolderIcon, Share2
} from "lucide-react";

function AuthorFilterDropdown({
    authors, value, onChange,
  }: { authors: string[]; value: string[]; onChange: (names: string[]) => void }) {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState("");
    const ref = React.useRef<HTMLDivElement | null>(null);
  
    React.useEffect(() => {
      const onClick = (e: MouseEvent) => { if (!ref.current) return; if (!ref.current.contains(e.target as Node)) setOpen(false); };
      window.addEventListener("click", onClick, true);
      return () => window.removeEventListener("click", onClick, true);
    }, []);
  
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
  
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className="flex items-center gap-2 px-2 py-1 rounded-md border bg-white hover:bg-gray-50"
          title={value.length ? `已选 ${value.length} 位作者` : "全部作者"}
        >
          <span className="text-xs text-gray-500">按作者：</span>
          {summary}
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </button>
  
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-[360px] rounded-xl border bg-white shadow-lg">
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
        )}
      </div>
    );
  }

  export default AuthorFilterDropdown;