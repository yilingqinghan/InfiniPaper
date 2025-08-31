/* --------------------------- tag filter dropdown --------------------------- */
function TagFilterDropdown({
    tags, value, onChange,
}: { tags: Tag[]; value: string[]; onChange: (names: string[]) => void }) {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState("");
    const ref = React.useRef<HTMLDivElement | null>(null);

    // 点击页面空白处收起
    React.useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (!ref.current) return;
            if (!ref.current.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener("click", onClick, true);
        return () => window.removeEventListener("click", onClick, true);
    }, []);

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

    // 按钮上的摘要：最多展示 3 个已选标签，剩余显示 +N
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

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
                className="flex items-center gap-2 px-2 py-1 rounded-md border bg-white hover:bg-gray-50"
                title={value.length ? `已选 ${value.length} 个标签` : "全部标签"}
            >
                <span className="text-xs text-gray-500">按标签筛选：</span>
                {summary}
                <ChevronDown className="w-4 h-4 text-gray-500" />
            </button>

            {open && (
                <div className="absolute right-0 z-50 mt-2 w-[320px] rounded-xl border bg-white shadow-lg">
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
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggle(t.name)}
                                    />
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
            )}
        </div>
    );
}
// frontend/pages/library.tsx
import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
    UploadCloud, Plus, Pencil, Trash2, ChevronUp, ChevronDown, ChevronRight,
    GripVertical, Eye, Tag as TagIcon, Folder as FolderIcon
} from "lucide-react";
import SwalCore from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
import {
    DndContext, PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const Swal = withReactContent(SwalCore);
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

/* --------------------------- types --------------------------- */
type Tag = { id: number; name: string; color?: string | null };
type Folder = { id: number; name: string; color?: string | null; parent_id?: number | null; priority?: number | null };
type FolderNode = Folder & { children?: FolderNode[] };
function buildTree(rows: Folder[]): FolderNode[] {
    const map = new Map<number, FolderNode>();
    const roots: FolderNode[] = [];
    rows.forEach(r => map.set(r.id, { ...r, children: [] }));
    map.forEach(node => {
        if (node.parent_id && map.get(node.parent_id)) {
            map.get(node.parent_id)!.children!.push(node);
        } else {
            roots.push(node);
        }
    });
    return roots;
}
type Paper = {
    id: number; title: string; abstract?: string | null; year?: number | null; venue?: string | null;
    doi?: string | null; pdf_url?: string | null;
    authors?: { id?: number; name?: string; affiliation?: string | null }[];
    tag_ids?: number[];
};

/* --------------------------- helpers --------------------------- */
// --- helpers: Fetch BibTeX via DOI only ---
async function fetchBibTeXByDOI(doi?: string): Promise<string> {
    if (!doi) throw new Error("没有 DOI，无法获取 BibTeX");
    const resp = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
      method: "GET",
      headers: { Accept: "application/x-bibtex; charset=utf-8" },
      cache: "no-store",
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`${resp.status} ${resp.statusText}${t ? ` - ${t}` : ""}`);
    }
    return await resp.text();
  }
async function j<T = any>(url: string, init?: RequestInit) {
    const r = await fetch(url, {
      credentials: "include",            // ✅ 默认带上 cookie
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", ...(init?.headers || {}) },
      ...init,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`${r.status} ${r.statusText}${text ? ` - ${text}` : ""}`); // ✅ 更可读的错误
    }
    return r.json() as Promise<T>;
  }
const toast = (title: string) => Swal.fire({ toast: true, position: "top", showConfirmButton: false, timer: 1200, icon: "success", title });

/** venue 缩写映射 */
/** venue 缩写映射 */
const VENUE_ABBR: [RegExp, string][] = [
    // 编译与体系结构领域（CCF A/B 类）
    [/(parallel architectures and compilation techniques|(^|\W)pact(\W|$))/i, "PACT"],
    [/(supercomputing|(^|\W)ics(\W|$))/i, "ICS"],
    [/(code generation and optimization|(^|\W)cgo(\W|$))/i, "CGO"],
    [/(hardware\/software co-design and system synthesis|(^|\W)codes\+isss(\W|$))/i, "CODES+ISSS"],
    [/(Architectural Support for Programming Languages and Operating Systems|(^|\W)ASPLOS(\W|$))/i, "ASPLOS"],
    [/(virtual execution environments|(^|\W)vee(\W|$))/i, "VEE"],
    [/(computer design|(^|\W)iccd(\W|$))/i, "ICCD"],
    [/(computer-aided design|(^|\W)iccad(\W|$))/i, "ICCAD"],
    [/(parallel processing|(^|\W)icpp(\W|$))/i, "ICPP"],
    [/(low power electronics and design|(^|\W)islped(\W|$))/i, "ISLPED"],
    [/(physical design|(^|\W)ispd(\W|$))/i, "ISPD"],
    [/(application-specific systems, architectures and processors|(^|\W)asap(\W|$))/i, "ASAP"],
    [/(high performance embedded architectures and compilers|(^|\W)hipeac(\W|$))/i, "HiPEAC"],
    [/(embedded software|(^|\W)emsoft(\W|$))/i, "EMSOFT"],
    [/(design automation|(^|\W)iccad(\W|$))/i, "ICCAD"],
    [/(computer-aided design|(^|\W)iccad(\W|$))/i, "ICCAD"],

    // 顶级期刊（编译与体系结构领域）
    [/(acm transactions on computer systems|(^|\W)tocs(\W|$))/i, "TOCS"],
    [/(ieee transactions on parallel and distributed systems|(^|\W)tpds(\W|$))/i, "TPDS"],
    [/(ieee transactions on computers|(^|\W)tc(\W|$))/i, "TC"],
    [/(ieee transactions on computer-aided design of integrated circuits and systems|(^|\W)tcad(\W|$))/i, "TCAD"],
    [/(acm transactions on architecture and code optimization|(^|\W)taco(\W|$))/i, "TACO"],
    [/(journal of parallel and distributed computing|(^|\W)jpdc(\W|$))/i, "JPDC"],
    [/(ieee transactions on very large scale integration systems|(^|\W)tvlsi(\W|$))/i, "TVLSI"],
    [/(parallel computing|(^|\W)parco(\W|$))/i, "PARCO"],
    [/(ieee transactions on cloud computing|(^|\W)tcc(\W|$))/i, "TCC"],
    [/(acm journal on emerging technologies in computing systems|(^|\W)jetc(\W|$))/i, "JETC"],
    [/(cluster computing|(^|\W)cluster(\W|$))/i, "Cluster Computing"],
    [/(ACM Transactions on Information Systems|(^|\W)TOIS(\W|$))/i, "TOIS"],
    

    // 其他相关会议
    [/(design, automation & test in europe|(^|\W)date(\W|$))/i, "DATE"],
    [/(hot chips|(^|\W)hot chips(\W|$))/i, "HOT CHIPS"],
    [/(cluster computing|(^|\W)cluster(\W|$))/i, "CLUSTER"],
    [/(parallel and distributed systems|(^|\W)icpads(\W|$))/i, "ICPADS"],
    [/(european conference on parallel and distributed computing|(^|\W)euro-par(\W|$))/i, "Euro-Par"],
    [/(computing frontiers|(^|\W)cf(\W|$))/i, "CF"],
    [/(high performance computing and communications|(^|\W)hpcc(\W|$))/i, "HPCC"],
    [/(high performance computing, data and analytics|(^|\W)hipc(\W|$))/i, "HiPC"],
    [/(modeling, analysis, and simulation of computer and telecommunication systems|(^|\W)mascots(\W|$))/i, "MASCOTS"],
    [/(parallel and distributed processing with applications|(^|\W)ispa(\W|$))/i, "ISPA"],
    [/(ieee cluster, cloud and grid computing|(^|\W)ccgrid(\W|$))/i, "CCGRID"],
    [/(international test conference|(^|\W)itc(\W|$))/i, "ITC"],
    [/(large installation system administration conference|(^|\W)lisa(\W|$))/i, "LISA"],
    [/(mass storage systems and technologies|(^|\W)msst(\W|$))/i, "MSST"],
    [/(ieee real-time and embedded technology and applications symposium|(^|\W)rtas(\W|$))/i, "RTAS"],

    // 人工智能领域（参考）
    [/(conference on neural information processing systems|(^|\W)neurips(\W|$))/i, "NeurIPS"],
    [/(machine learning|(^|\W)icml(\W|$))/i, "ICML"],
    [/(conference on computer vision and pattern recognition|(^|\W)cvpr(\W|$))/i, "CVPR"],
    [/(computer vision|(^|\W)iccv(\W|$))/i, "ICCV"],
    [/(european conference on computer vision|(^|\W)eccv(\W|$))/i, "ECCV"],
    [/(association for the advancement of artificial intelligence|(^|\W)aaai(\W|$))/i, "AAAI"],
    [/(international joint conference on artificial intelligence|(^|\W)ijcai(\W|$))/i, "IJCAI"],
    [/(conference on learning representations|(^|\W)iclr(\W|$))/i, "ICLR"],
    [/(conference on empirical methods in natural language processing|(^|\W)emnlp(\W|$))/i, "EMNLP"],
    [/(conference on neural information processing systems|(^|\W)neurips(\W|$))/i, "NeurIPS"],

    // 编程语言与软件工程领域（参考）
    [/(principles of programming languages|(^|\W)popl(\W|$))/i, "POPL"],
    [/(symposium on principles of programming languages|(^|\W)splash(\W|$))/i, "SPLASH"],
    [/(programming language design and implementation|(^|\W)pldi(\W|$))/i, "PLDI"],
    [/(functional programming|(^|\W)icfp(\W|$))/i, "ICFP"],
    [/(software engineering|(^|\W)icse(\W|$))/i, "ICSE"],
    [/(automated software engineering|(^|\W)ase(\W|$))/i, "ASE"],
    [/(software and systems engineering|(^|\W)fse(\W|$))/i, "FSE"],
    [/(programming languages and systems|(^|\W)popl(\W|$))/i, "POPL"],

    // 其他参考会议
    [/(design automation conference|(^|\W)dac(\W|$))/i, "DAC"],
    [/(very large data bases|(^|\W)vldb(\W|$))/i, "VLDB"],
    [/(sigmod|(^|\W)sigmod(\W|$))/i, "SIGMOD"],
    [/(the web conference|(^|\W)www(\W|$))/i, "WWW"],
    [/(supercomputing|(^|\W)sc(\W|$))/i, "SC"],
    [/(siggraph|(^|\W)siggraph(\W|$))/i, "SIGGRAPH"],
    [/(proceedings of the acm on programming languages|(^|\W)pacmpl(\W|$))/i, "PACMPL"],
    [/(object-oriented programming, systems, languages, and applications|(^|\W)oopsla(\W|$))/i, "OOPSLA"],
    [/(Research and Development inInformation Retrieval|(^|\W)sigir(\W|$))/i, "SIGIR"],
];

const VENUE_ABBR_SET = new Set(VENUE_ABBR.map(([, ab]) => ab.toUpperCase()));
const VENUE_ABBR_LIST = Array.from(new Set(VENUE_ABBR.map(([, ab]) => ab)));
function abbrevVenue(venue?: string | null): string | null {
    if (!venue) return null;
    for (const [re, abbr] of VENUE_ABBR) if (re.test(venue)) return abbr;
    return null;
}

/** 顶尖会议/期刊缩写定义（Tier1） */
const TOP_TIER = new Set(["MICRO","PLDI","ISCA","ASPLOS","NeurIPS","ICML","CVPR","ICCV","ECCV","SIGMOD","VLDB","WWW","SC","SIGGRAPH","FAST","OSDI","ASE","FSE","ICSE","SOSP","SIGCOMM","NSDI","KDD","AAAI","IJCAI","TOSEM","SIGIR","OOPSLA","TOIS"]);
function venueTier(abbr: string | null): 0 | 1 | 2 {
    if (!abbr) return 0;
    return TOP_TIER.has(abbr) ? 1 : 2;
}

/** 本地可视化配置：给标签指定颜色/优先级符号（不改后端表结构） */
type TagViz = Record<string, { color?: string; prio?: string }>;
const VIZ_KEY = "tag-viz";
const DEFAULT_COLORS = [
    "#2563eb","#3b82f6","#60a5fa",   // blue
    "#0ea5e9","#06b6d4","#22d3ee",   // cyan
    "#14b8a6","#2dd4bf",             // teal
    "#10b981","#34d399","#84cc16",   // green / lime
    "#f59e0b","#f97316","#fb923c",   // amber / orange
    "#ef4444","#f43f5e","#ec4899",   // red / pink
    "#8b5cf6","#a78bfa","#6366f1",   // violet / indigo
    "#6b7280","#a3a3a3"              // neutral
];
const PRIO_CHOICES = ["⭐️", "🔥", "📌", "👀", "✅", "⏳", "❗️", "💡", "📝", "🔬"];

function loadViz(): TagViz { try { return JSON.parse(localStorage.getItem(VIZ_KEY) || "{}"); } catch { return {}; } }
function saveViz(v: TagViz) { localStorage.setItem(VIZ_KEY, JSON.stringify(v)); }
function getTagColor(name: string) { return loadViz()[name]?.color; }
function getTagPrio(name: string) { return loadViz()[name]?.prio; }
function setTagColor(name: string, color?: string) { const v = loadViz(); v[name] = { ...(v[name] || {}), color }; saveViz(v); }
function setTagPrio(name: string, prio?: string) { const v = loadViz(); v[name] = { ...(v[name] || {}), prio }; saveViz(v); }

// 特殊标签：开源（深色底、白字）
const OPEN_SOURCE_TAGS = new Set(["开源", "Open Source"]);
function isOpenSourceTag(name: string) { return OPEN_SOURCE_TAGS.has(name.trim()); }

// hex -> rgba with alpha for subtle tinted backgrounds
function hexWithAlpha(hex: string, alpha: number) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const int = parseInt(full, 16);
    const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// -------- folder numbering helpers --------
function toRoman(num: number): string {
  if (num <= 0) return String(num);
  const map: [number, string][] = [
    [1000, "M"],[900, "CM"],[500, "D"],[400, "CD"],
    [100, "C"],[90, "XC"],[50, "L"],[40, "XL"],
    [10, "X"],[9, "IX"],[5, "V"],[4, "IV"],[1, "I"],
  ];
  let n = num, out = ""; for (const [v, s] of map) { while (n >= v) { out += s; n -= v; } } return out;
}
function toCircled(num: number): string {
  const circ = ["", "①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫","⑬","⑭","⑮","⑯","⑰","⑱","⑲","⑳"];
  if (num > 0 && num < circ.length) return circ[num];
  // fallback for > 20
  return `(${num})`;
}
function numberLabelByDepth(depth: number, index: number): string {
  // depth: 0 -> 1,2,3...; 1 -> I, II, III...; 2 -> ①②③...; deeper -> 1,2,3
  if (depth === 0) return String(index);
  if (depth === 1) return toRoman(index);
  if (depth === 2) return toCircled(index);
  return String(index);
}

/* --------------------------- left: folders --------------------------- */
function FolderItem({
    folder, depth, active, onClick, onCreateChild, hasChildren, collapsed, onToggle, count = 0, numLabel
}: {
    folder: Folder; depth: number; active: boolean; onClick: () => void; onCreateChild: (parentId: number) => void;
    hasChildren: boolean; collapsed: boolean; onToggle: () => void; count?: number; numLabel?: string;
}) {
    const { isOver, setNodeRef } = useDroppable({ id: `folder:${folder.id}` });
    const pad = 4 + depth * 10; // 更紧凑
    const col = folder.color || "#94a3b8";
    const bgCol = active ? hexWithAlpha(col, 0.16) : (isOver ? hexWithAlpha(col, 0.12) : undefined);
    const bdCol = active ? hexWithAlpha(col, 0.45) : hexWithAlpha(col, 0.25);
    // 一级更醒目，整体字号稍大
    const titleCls = depth === 0 ? "font-semibold text-[15px]" : (depth === 1 ? "text-[14px]" : "text-[13px]");

    return (
        <div ref={setNodeRef}>
            <div
                onClick={onClick}
                className="px-1 py-[2px] rounded-md cursor-pointer transition border select-none flex items-center justify-between min-h-[30px]"
                style={{ paddingLeft: pad }}   // 去掉旧的 inset 左侧色条，改用内部矩形条
            >
                <div
                    className={`flex items-center gap-1 flex-1 px-1 py-[1px] rounded-md border ${isOver ? "ring-2 ring-blue-400" : ""}`}
                    style={{ background: bgCol, borderColor: bdCol }}
                >
                    {hasChildren ? (
                        <button
                            className="w-4 h-4 rounded hover:bg-gray-100 flex items-center justify-center"
                            onClick={(e) => { e.stopPropagation(); onToggle(); }}
                            title={collapsed ? "展开" : "折叠"}
                            aria-label={collapsed ? "expand" : "collapse"}
                        >
                            {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-600" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-600" />}
                        </button>
                    ) : (
                        <span className="w-4" />
                    )}

                    {/* 编号彩色徽标：更大、更醒目 */}
                    {numLabel && (
                        <span
                            className="text-[12px] font-semibold leading-4 px-2 py-[1px] rounded-md text-white shadow-sm"
                            style={{ background: col }}
                            title="自动编号"
                        >
                            {numLabel}
                        </span>
                    )}

                    <span className={`${titleCls} leading-5 align-middle truncate`}>{folder.name}</span>
                </div>

                <div className="ml-1 flex items-center gap-1">
                    {/* 论文数：为 0 时不显示（你之前的逻辑保留） */}
                    {count > 0 && (
                        <span
                            className="text-[11px] px-1.5 py-[1px] rounded border bg-gray-50 text-gray-700 min-w-[1.5rem] text-center"
                            title="本文夹内论文数量"
                        >
                            {count}
                        </span>
                    )}
                    <button
                        className="text-[10px] px-1 py-[1px] rounded border hover:bg-gray-50"
                        onClick={(e) => { e.stopPropagation(); onCreateChild(folder.id); }}
                        title="新建子目录"
                    >
                        +
                    </button>
                </div>
            </div>
        </div>
    );
}
function AbstractNotePanel({ paper }: { paper: Paper | null }) {
    const [note, setNote] = React.useState(""); const [editingAbs, setEditingAbs] = React.useState(false);
    const [absDraft, setAbsDraft] = React.useState("");
  
    React.useEffect(() => {
      if (!paper) { setNote(""); setAbsDraft(""); setEditingAbs(false); return; }
      setAbsDraft(paper.abstract || "");
      (async () => {
        try {
          const r = await j<{ paper_id: number; content: string }>(`${apiBase}/api/v1/papers/${paper.id}/note`);
          setNote(r?.content || "");
        } catch { setNote(""); }
      })();
    }, [paper?.id]);
  
    return (
      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="px-3 py-2 border-b bg-gradient-to-r from-amber-50 to-yellow-50 text-sm font-medium">摘要 / 笔记</div>
        <div className="p-3 space-y-3">
          {/* 摘要 */}
          <div>
            <div className="text-xs text-gray-500 mb-1">摘要</div>
            {!editingAbs ? (
              <div className="text-sm leading-6 text-gray-800 whitespace-pre-wrap">{absDraft || <span className="text-gray-400">（暂无摘要）</span>}</div>
            ) : (
              <textarea value={absDraft} onChange={e => setAbsDraft(e.target.value)} rows={6} className="w-full text-sm border rounded-md p-2" />
            )}
            <div className="mt-2 flex gap-2">
              {!editingAbs ? (
                <button className="text-xs px-2 py-1 rounded border" onClick={() => setEditingAbs(true)}>编辑摘要</button>
              ) : (
                <>
                  <button className="text-xs px-2 py-1 rounded border" onClick={() => setEditingAbs(false)}>取消</button>
                  <button className="text-xs px-2 py-1 rounded border bg-blue-50" onClick={async () => {
                    if (!paper) return;
                    await j(`${apiBase}/api/v1/papers/${paper.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ abstract: absDraft }) });
                    setEditingAbs(false); Swal.fire({ toast: true, icon: "success", title: "摘要已更新", timer: 1000, showConfirmButton: false, position: "top" });
                  }}>保存摘要</button>
                </>
              )}
            </div>
          </div>
          {/* 笔记 */}
          <div>
            <div className="text-xs text-gray-500 mb-1">笔记</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} className="w-full text-sm border rounded-md p-2" rows={6} placeholder="写点读书笔记…" />
            <div className="mt-2">
              <button className="text-xs px-2 py-1 rounded border bg-green-50" onClick={async () => {
                if (!paper) return;
                await j(`${apiBase}/api/v1/papers/${paper.id}/note`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: note }) });
                Swal.fire({ toast: true, icon: "success", title: "笔记已保存", timer: 1000, showConfirmButton: false, position: "top" });
              }}>保存笔记</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

/* --------------------------- drag handle --------------------------- */
function DragHandle({ id }: { id: number }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useDraggable({ id: `paper:${id}` });
    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform), transition,
        opacity: isDragging ? 0.6 : 1, cursor: "grab",
    };
    return (
        <button
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-gray-100"
            style={style}
            title="拖到左侧目录可归档"
            aria-label="drag"
        >
            <GripVertical className="w-4 h-4 text-gray-500" />
        </button>
    );
}


/* --------------------------- row --------------------------- */
function PaperRow({
    p, onOpen, onSelect, onPreviewHover, onContextMenu, tagMap, selected, showVenueCol, vizNonce,
}: {
    p: Paper; onOpen: (id: number) => void; onSelect: (id: number) => void;
    onPreviewHover: (id: number | null) => void; onContextMenu: (e: React.MouseEvent, paper: Paper) => void;
    tagMap: Map<number, Tag>; selected: boolean; showVenueCol: boolean; vizNonce: number;
}) {
    const authors = (p.authors || []).map(a => a?.name).filter(Boolean).slice(0, 6).join(", ");
    const allTags = (p.tag_ids || []).map(id => tagMap.get(id)).filter((t): t is Tag => !!t);
    const colored = allTags.filter(t => getTagColor(t.name));
    const plain = allTags.filter(t => !getTagColor(t.name));
    const abbr = abbrevVenue(p.venue);
    const tier = venueTier(abbr);
    const chipClass =
        tier === 1
            ? "text-[11px] px-1.5 py-[1px] mr-2 rounded-md border bg-rose-50 border-rose-200 text-rose-700"
            : "text-[11px] px-1.5 py-[1px] mr-2 rounded-md border bg-indigo-50 border-indigo-200 text-indigo-700";

    return (
        <tr
            className={`border-t ${selected ? "bg-blue-50/60" : "odd:bg-white even:bg-slate-50/40 hover:bg-gray-50"} cursor-pointer select-none`}
            onClick={() => onSelect(p.id)}
            onDoubleClick={() => onOpen(p.id)}
            onMouseEnter={() => onPreviewHover(p.id)}
            onMouseLeave={() => onPreviewHover(null)}
            onContextMenu={(e) => onContextMenu(e, p)}
            data-viz={vizNonce}
        >
            <td className="px-2 py-1.5 w-[36px]"><DragHandle id={p.id} /></td>
            <td className="px-2 py-1.5 w-[80px] text-gray-600">{p.year ?? "—"}</td>
            <td className="px-2 py-1.5 w-[40%] min-w-[360px]">
                <div className="font-medium whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-2">
                    <span className="overflow-hidden text-ellipsis">
                    <button
                    className="text-[11px] px-1.5 py-[1px] mr-2 rounded-md border bg-indigo-50 border-indigo-200 text-indigo-700 bg-[#1E90FF88] text-white"
                    onClick={async (e) => {
                        e.stopPropagation();
                        try {
                        const tex = await fetchBibTeXByDOI(p.doi || undefined);
                        try {
                            await navigator.clipboard.writeText(tex);
                            toast("已复制 BibTeX（来自 DOI）");
                        } catch {
                            await Swal.fire({
                            icon: "error",
                            title: "复制失败",
                            text: "浏览器剪贴板不可用，请检查权限或手动复制。",
                            });
                        }
                        } catch (err: any) {
                        await Swal.fire({
                            icon: "error",
                            title: "获取 BibTeX 失败",
                            text: String(err?.message || err),
                        });
                        }
                    }}
                    title="通过 DOI 获取并复制 BibTeX"
                    >
                    📖
                    </button>
                    {abbr && (
                        <span
                        className={chipClass}
                        title={tier === 1 ? "顶尖会议/期刊" : "其它会议/期刊"}
                        >
                        {abbr}
                        </span>
                    )}
                    {p.title}
                    </span>
                </div>
            </td>
            <td className="px-2 py-1.5 w-[22%]">
                <div className="text-xs text-gray-700 whitespace-nowrap overflow-hidden text-ellipsis">{authors || "—"}</div>
            </td>
            {showVenueCol && (
                <td className="px-2 py-1.5 w-[20%]">
                    <div className="text-xs text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis">{p.venue || "—"}</div>
                </td>
            )}
            <td className="px-2 py-1.5 w-[18%]">
                <div className="flex flex-wrap gap-1 items-center">
                    {colored.length ? colored.map(t => {
                        const color = getTagColor(t.name) || "#3b82f6";
                        const prio = getTagPrio(t.name);
                        if (isOpenSourceTag(t.name)) {
                            return (
                                <span key={t.id}
                                    className="text-[11px] px-2 py-[2px] rounded-md border inline-flex items-center gap-1 bg-gray-900 border-gray-900 text-white"
                                    title={t.name}
                                >
                                    {t.name}
                                </span>
                            );
                        }
                        return (
                            <span key={t.id}
                                className="text-[11px] px-2 py-[2px] rounded-full border inline-flex items-center gap-1"
                                style={{ borderColor: color }}
                                title={t.name}
                            >
                                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
                                {prio ? <span className="text-xs">{prio}</span> : null}{t.name}
                            </span>
                        );
                    }) : <span className="text-[11px] text-gray-400">—</span>}
                </div>
            </td>
            <td className="px-2 py-1.5 w-[18%]">
                <div className="flex flex-wrap gap-1">
                    {plain.length ? plain.map(t => (
                        isOpenSourceTag(t.name) ? (
                            <span key={t.id} className="text-[11px] px-2 py-[2px] rounded-md border inline-flex items-center gap-1 bg-gray-900 border-gray-900 text-white" title={t.name}>
                                {t.name}
                            </span>
                        ) : (
                            <span key={t.id} className="text-[11px] px-2 py-[2px] rounded-md border inline-flex items-center gap-1" title={t.name}>
                                <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />
                                {t.name}
                            </span>
                        )
                    )) : <span className="text-[11px] text-gray-400">—</span>}
                </div>
            </td>
            <td className="px-2 py-1.5 w-[60px]">{p.pdf_url ? "有" : "-"}</td>
        </tr>
    );
}

/* --------------------------- detail dialog --------------------------- */
function Detail({ openId, onClose }: { openId: number | null; onClose: () => void }) {
    const [data, setData] = React.useState<Paper | null>(null);
    React.useEffect(() => {
        (async () => {
            if (!openId) { setData(null); return; }
            const r = await fetch(`${apiBase}/api/v1/papers/${openId}`); setData(r.ok ? await r.json() : null);
        })();
    }, [openId]);
    return (
        <Dialog.Root open={!!openId} onOpenChange={v => !v && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/30" />
                <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[760px] max-w-[95vw] max-h-[80vh] overflow-auto rounded-2xl bg-white p-6 shadow-xl">
                    {!data ? <div className="text-sm text-gray-500">加载中…</div> : (
                        <div className="space-y-3">
                            <div className="text-lg font-semibold">{data.title}</div>
                            <div className="text-xs text-gray-500">{data.venue || "—"} · {data.year || "—"} {data.doi ? `· DOI: ${data.doi}` : ""}</div>
                            {data.authors?.length ? <div className="text-sm text-gray-700">
                                作者：{data.authors.map(a => a?.name).filter(Boolean).join(", ")}
                            </div> : null}
                            <div className="text-right">
                                <button className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50" onClick={onClose}>关闭</button>
                            </div>
                        </div>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/* --------------------------- quick tag panel --------------------------- */
function QuickTagPanel({
    paper, allTags, onApply, onRefreshAll, onVizChange, compact = false,
}: { paper: Paper | null; allTags: Tag[]; onApply: (names: string[]) => Promise<void>; onRefreshAll: () => void; onVizChange: () => void; compact?: boolean }) {
    const [input, setInput] = React.useState("");
    const [sel, setSel] = React.useState<string[]>([]);
    const [paletteOpenFor, setPaletteOpenFor] = React.useState<string | null>(null);
    const [manage, setManage] = React.useState(false);

    // 同步当前论文的标签名
    React.useEffect(() => {
        if (!paper) { setSel([]); setInput(""); return; }
        const names = (paper.tag_ids || [])
            .map(id => allTags.find(t => t.id === id)?.name)
            .filter((x): x is string => !!x);
        setSel(names);
        setInput("");
    }, [paper, allTags]);

    // 仅从当前论文移除一个标签（不会全局删除）
    const removeOne = async (name: string) => {
        const next = sel.filter(x => x !== name);
        setSel(next);
        await onApply(next);
        onVizChange();
    };

    // 给当前论文添加一个标签（不存在的可通过输入框回车创建）
    const addOne = async (name: string) => {
        const v = name.trim();
        if (!v || sel.includes(v)) return;
        const next = [...sel, v];
        setSel(next);
        await onApply(next);
        onVizChange();
    };

    // 全局删除某个标签（从所有论文移除，并删除该标签）
    const deleteGlobal = async (name: string) => {
        const id = allTags.find(t => t.name === name)?.id;
        if (!id) return;
        const ok = (await Swal.fire({
            title: `删除标签「${name}」？`,
            text: "将从所有论文移除该标签，且标签本身会被删除。",
            showCancelButton: true,
            confirmButtonText: "删除",
        })).isConfirmed;
        if (!ok) return;
        await fetch(`${apiBase}/api/v1/tags/${id}`, { method: "DELETE" });
        setSel(s => s.filter(x => x !== name));
        await onRefreshAll();
        onVizChange();
    };

    // 过滤出未选中的标签作为候选
    const suggestions = React.useMemo(() => {
        const q = input.trim().toLowerCase();
        return allTags
            .filter(t => !sel.includes(t.name))
            .filter(t => !q || t.name.toLowerCase().includes(q))
            .slice(0, 60);
    }, [allTags, sel, input]);

    const canApply = !!paper && (sel.length > 0 || input.trim().length > 0);
    const outerCls = compact
        ? "rounded-2xl border bg-white flex flex-col overflow-hidden max-h-[260px]"
        : "rounded-2xl border bg-white h-full flex flex-col overflow-hidden  max-h-[500px]";
    return (
        <div className={outerCls}>
            <div className="px-3 py-2 border-b bg-gradient-to-r from-indigo-50 to-blue-50 flex items-center gap-2">
                <div className="ml-auto">
                    <button className="text-[11px] px-2 py-[2px] rounded border hover:bg-white"
                        onClick={() => setManage(m => !m)}>
                        {manage ? "完成" : "管理"}
                    </button>
                </div>
                <TagIcon className="w-4 h-4 text-indigo-600" /><div className="text-sm font-medium">标签</div>
            </div>

            {!paper ? (
                <div className="flex-1 text-sm text-gray-500 flex items-center justify-center px-4 text-center">
                    选中一篇论文后，可在这里管理标签。点击气泡上的「×」仅从当前论文移除；在“管理”模式下可全局删除标签。
                </div>
            ) : (
                <div className="flex-1 overflow-auto p-3 space-y-3">
                    {/* 当前标签（可直接移除/设色/设优先级） */}
                    <div>
                        <div className="text-xs text-gray-500 mb-1">当前标签</div>
                        <div className="flex flex-wrap gap-2">
                            {sel.length ? sel.map(name => {
                                const color = getTagColor(name);
                                const prio = getTagPrio(name);
                                return (
                                    <span
                                        key={name}
                                        className={`text-[11px] px-2 py-[3px] inline-flex items-center gap-1 border ${isOpenSourceTag(name) ? "rounded-md bg-gray-900 border-gray-900 text-white" : "rounded-full"}`}
                                        style={isOpenSourceTag(name) ? undefined : { borderColor: color || "#cbd5e1" }}
                                    >
                                        <button
                                            className="w-2.5 h-2.5 rounded-full border"
                                            style={{ background: color || "transparent" }}
                                            title="设置颜色"
                                            onClick={() => setPaletteOpenFor(prev => prev === name ? null : name)}
                                        />
                                        <button
                                            className="ml-0.5 text-[12px] leading-none"
                                            title="设置优先级"
                                            onClick={async () => {
                                                const { value } = await Swal.fire({
                                                    title: `选择优先级（${name}）`,
                                                    input: "select",
                                                    inputOptions: PRIO_CHOICES.reduce((m, emo) => { (m as any)[emo] = emo; return m; }, {} as any),
                                                    inputPlaceholder: "无",
                                                    showCancelButton: true
                                                });
                                                if (value) { setTagPrio(name, value); } else { setTagPrio(name, undefined); }
                                                onVizChange();
                                                (document.activeElement as HTMLElement)?.blur?.();
                                            }}
                                        >
                                            {prio || "☆"}
                                        </button>
                                        <span>{name}</span>
                                        <button
                                            className="ml-1 px-1 leading-none rounded hover:bg-gray-100"
                                            title="仅从当前论文移除"
                                            onClick={() => removeOne(name)}
                                        >
                                            ×
                                        </button>
                                        {manage && (
                                            <button
                                                className="ml-1 text-[11px] px-1 rounded hover:bg-red-50 text-red-600 border"
                                                title="全局删除该标签"
                                                onClick={() => deleteGlobal(name)}
                                            >删</button>
                                        )}

                                        {/* 颜色调板 */}
                                        {paletteOpenFor === name && (
                                            <div className="absolute z-50 mt-6 p-2 bg-white rounded-md shadow border grid grid-cols-5 gap-2"
                                                onMouseLeave={() => setPaletteOpenFor(null)}>
                                                {DEFAULT_COLORS.map(c => (
                                                    <button key={c} className="w-5 h-5 rounded-full border" style={{ background: c }}
                                                        onClick={() => { setTagColor(name, c); setPaletteOpenFor(null); onVizChange(); }} />
                                                ))}
                                                <button className="col-span-5 text-xs text-gray-500 mt-1 underline"
                                                    onClick={() => { setTagColor(name, undefined); setPaletteOpenFor(null); onVizChange(); }}>
                                                    清除颜色
                                                </button>
                                            </div>
                                        )}
                                    </span>
                                );
                            }) : <span className="text-[11px] text-gray-400">暂无</span>}
                        </div>
                    </div>

                    {/* 添加标签 */}
                    <div>
                        <div className="text-xs text-gray-500 mb-1">添加标签</div>
                        <div className="flex items-center gap-2">
                            <input
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                placeholder="输入后回车，或从下方选择"
                                onKeyDown={async e => {
                                    if (e.key === "Enter" && input.trim()) {
                                        await addOne(input.trim());
                                        setInput("");
                                    }
                                }}
                                className="flex-1 text-sm px-2 py-1.5 rounded-md border outline-none focus:ring-2 ring-blue-200"
                            />
                            <button
                                onClick={async () => { if (input.trim()) { await addOne(input.trim()); setInput(""); } }}
                                disabled={!canApply}
                                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
                            >
                                添加
                            </button>
                        </div>

                        <div className="mt-2">
                            <div className="text-xs text-gray-500 mb-1">可选</div>
                            <div className="flex flex-wrap gap-2">
                                {suggestions.map(t => {
                                    const color = getTagColor(t.name);
                                    const prio = getTagPrio(t.name);
                                    return (
                                        <div
                                            key={t.id}
                                            className={`px-2 py-1 border flex items-center gap-2 text-[12px] ${isOpenSourceTag(t.name) ? "rounded-md bg-gray-900 border-gray-900 text-white" : "rounded-lg hover:bg-gray-50"}`}
                                        >
                                            <span className="w-2.5 h-2.5 rounded-full border inline-block" style={{ background: color || "transparent" }} />
                                            {prio ? <span className="text-xs">{prio}</span> : null}
                                            <button className="underline decoration-dotted" onClick={() => addOne(t.name)} title="添加到当前论文">
                                                {t.name}
                                            </button>
                                            {manage && (
                                                <button
                                                    className="ml-1 text-[11px] px-1 rounded hover:bg-red-50 text-red-600 border"
                                                    title="全局删除该标签"
                                                    onClick={() => deleteGlobal(t.name)}
                                                >删</button>
                                            )}
                                        </div>
                                    );
                                })}
                                {!suggestions.length && <span className="text-[11px] text-gray-400">没有更多候选</span>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* --------------------------- word cloud --------------------------- */
function hashHue(s: string) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h % 360; }
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "into", "their", "your", "our", "you", "his", "her", "its", "they", "them", "in", "of", "to", "on", "by", "as", "is", "be", "we", "a", "an", "at", "or", "it", "using", "based", "via", "over", "under", "between", "towards", "toward", "towards"]);
function tokenize(s: string) {
    return (s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w)));
}
function WordCloudPanel({ papers, tags }: { papers: Paper[]; tags: Tag[] }) {
    const words = React.useMemo(() => {
        const m = new Map<string, number>();
        for (const p of papers) {
            (tokenize(p.title || "")).forEach(w => m.set(w, (m.get(w) || 0) + 1));
            // 标签也计入
            (p.tag_ids || []).map(id => tags.find(t => t.id === id)?.name).filter(Boolean).forEach(n => {
                m.set(n as string, (m.get(n as string) || 0) + 2); // 标签权重稍高
            });
        }
        const arr = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 50);
        if (arr.length === 0) return [];
        const max = arr[0][1], min = arr[arr.length - 1][1];
        return arr.map(([text, count]) => {
            const t = (count - min) / Math.max(1, (max - min));
            const size = 0.9 + 1.3 * t; // rem
            const hue = hashHue(text);
            const rot = (hashHue(text + "x") % 5) - 2; // -2..2 deg
            return { text, count, size, hue, rot };
        });
    }, [papers, tags]);

    return (
        <div className="rounded-2xl border bg-white overflow-hidden h-[260px]">
            <div className="px-3 py-2 border-b bg-gradient-to-r from-emerald-50 to-teal-50 text-sm font-medium">词云</div>
            <div className="p-3 h-[220px] overflow-auto">
                {words.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-gray-400">暂无数据</div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {words.map(w => (
                            <span key={w.text}
                                title={`${w.text} ×${w.count}`}
                                style={{
                                    fontSize: `${w.size}rem`,
                                    color: `hsl(${w.hue} 70% 35%)`,
                                    transform: `rotate(${w.rot}deg)`,
                                    lineHeight: 1.1,
                                }}
                                className="select-none hover:scale-[1.03] transition"
                            >
                                {w.text}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function FolderTreeNode({
    node, depth, index, activeId, onPick, onCreateChild, collapsedSet, toggle, counts
}: {
    node: FolderNode; depth: number; index: number; activeId: number | null;
    onPick: (id: number) => void; onCreateChild: (parentId: number) => void;
    collapsedSet: Set<number>; toggle: (id: number) => void; counts: Record<number, number>;
}) {
    const hasChildren = !!(node.children && node.children.length > 0);
    const isCollapsed = collapsedSet.has(node.id);
    const numLabel = numberLabelByDepth(depth, index);
    return (
        <div>
            <FolderItem
                folder={node}
                depth={depth}
                active={activeId === node.id}
                onClick={() => onPick(node.id)}
                onCreateChild={onCreateChild}
                hasChildren={hasChildren}
                collapsed={isCollapsed}
                onToggle={() => toggle(node.id)}
                count={counts[node.id] || 0}
                numLabel={numLabel}
            />
            {hasChildren && !isCollapsed && (
                <div className="space-y-[2px] mt-0.5">
                    {node.children!.map((ch, i) => (
                        <FolderTreeNode key={ch.id} node={ch} depth={depth + 1} index={i + 1} activeId={activeId}
                            onPick={onPick} onCreateChild={onCreateChild} collapsedSet={collapsedSet} toggle={toggle} counts={counts} />
                    ))}
                </div>
            )}
        </div>
    );
}

/* --------------------------- dual year slider (non-linear) --------------------------- */
function YearDualSlider({
    start, end, value, onChange,
}: { start: number; end: number; value: [number, number]; onChange: (a: number, b: number) => void }) {
    const [a, b] = value;
    const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
    // 非线性映射（反向）：p ∈ [0,1] -> year = start + (end-start) * sqrt(p)
    // 目的：靠近“现在(end)”更细腻，靠近早年(start)更稀疏
    const pctToYear = (p: number) => Math.round(start + (end - start) * Math.sqrt(p));
    const yearToPct = (y: number) => {
        const r = Math.max(1, (end - start));
        const t = clamp((y - start) / r, 0, 1);
        return t * t; // 反变换：p = ((y-start)/range)^2
    };
    const pMin = Math.round(yearToPct(a) * 100);
    const pMax = Math.round(yearToPct(b) * 100);

    const handleMin = (p: number) => {
        const y = clamp(pctToYear(p / 100), start, b);
        onChange(y, b);
    };
    const handleMax = (p: number) => {
        const y = clamp(pctToYear(p / 100), a, end);
        onChange(a, y);
    };

    const trackSel = `linear-gradient(to right, transparent ${pMin}%, #60a5fa ${pMin}%, #60a5fa ${pMax}%, transparent ${pMax}%)`;

    return (
        <div className="relative w-[260px] h-6">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded bg-slate-200" />
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded pointer-events-none" style={{ background: trackSel }} />

            <input
            type="range" min={0} max={100} value={pMin}
            onChange={(e) => handleMin(Number(e.currentTarget.value))}
            className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none z-20
                        [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:pointer-events-auto
                        [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:pointer-events-auto"
            />
            <input
            type="range" min={0} max={100} value={pMax}
            onChange={(e) => handleMax(Number(e.currentTarget.value))}
            className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none z-30
                        [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:pointer-events-auto
                        [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:pointer-events-auto"
            />
        </div>
    );
}
/* --------------------------- venue abbr dropdown --------------------------- */
function VenueAbbrDropdown({ value, onChange }: { value: string[]; onChange: (abbrs: string[]) => void }) {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState("");
    const ref = React.useRef<HTMLDivElement | null>(null);
  
    React.useEffect(() => {
      const onClick = (e: MouseEvent) => { if (!ref.current) return; if (!ref.current.contains(e.target as Node)) setOpen(false); };
      window.addEventListener("click", onClick, true);
      return () => window.removeEventListener("click", onClick, true);
    }, []);
  
    const options = React.useMemo(() => {
      const list = VENUE_ABBR_LIST.slice().sort((a, b) => a.localeCompare(b));
      return list.filter(ab => !q || ab.toLowerCase().includes(q.toLowerCase()));
    }, [q]);
  
    const toggle = (abbr: string) => {
      if (value.includes(abbr)) onChange(value.filter(x => x !== abbr));
      else onChange([...value, abbr]);
    };
    const selectAll = () => onChange(options);
    const clearAll = () => onChange([]);
  
    const summary = React.useMemo(() => {
      if (!value.length) return <span className="text-gray-500">全部会议/期刊</span>;
      const head = value.slice(0, 4);
      const rest = value.length - head.length;
      return (
        <span className="flex items-center gap-1 flex-wrap">
          {head.map(n => {
            const tier = venueTier(n);
            const chip = tier === 1
              ? "text-[11px] px-1.5 py-[1px] rounded-md border bg-rose-50 border-rose-200 text-rose-700"
              : "text-[11px] px-1.5 py-[1px] rounded-md border bg-indigo-50 border-indigo-200 text-indigo-700";
            return <span key={n} className={chip}>{n}</span>;
          })}
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
          title={value.length ? `已选 ${value.length} 个缩写` : "全部会议/期刊"}
        >
          <span className="text-xs text-gray-500">按会议/期刊：</span>
          {summary}
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </button>
  
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-[320px] rounded-xl border bg-white shadow-lg">
            <div className="p-2 border-b bg-gray-50 flex items-center gap-2">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索缩写…"
                className="flex-1 text-sm px-2 py-1 rounded-md border bg-white" />
              <button className="text-xs px-2 py-1 rounded border" onClick={selectAll}>全选</button>
              <button className="text-xs px-2 py-1 rounded border" onClick={clearAll}>清空</button>
            </div>
            <div className="max-h-64 overflow-auto p-1">
              {options.map(abbr => {
                const checked = value.includes(abbr);
                const tier = venueTier(abbr);
                return (
                  <label key={abbr}
                    className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(abbr)} />
                    <span className={`text-[11px] px-1.5 py-[1px] rounded-md border ${tier === 1
                      ? "bg-rose-50 border-rose-200 text-rose-700"
                      : "bg-indigo-50 border-indigo-200 text-indigo-700"}`}>{abbr}</span>
                  </label>
                );
              })}
              {!options.length && <div className="p-3 text-center text-sm text-gray-400">没有匹配的缩写</div>}
            </div>
            <div className="p-2 border-t text-right">
              <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={() => setOpen(false)}>完成</button>
            </div>
          </div>
        )}
      </div>
    );
  }
/* --------------------------- main page --------------------------- */
export default function Library() {
    const sensors = useSensors(useSensor(PointerSensor));

    const [folders, setFolders] = React.useState<Folder[]>([]);
    const [collapsed, setCollapsed] = React.useState<Set<number>>(new Set());
    const toggleCollapse = (id: number) =>
        setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

    const [folderCounts, setFolderCounts] = React.useState<Record<number, number>>({});
    const [allCount, setAllCount] = React.useState<number>(0);

    const loadFolderCounts = React.useCallback(async () => {
        try {
            const all = await j<Paper[]>(`${apiBase}/api/v1/papers/?dedup=true`);
            setAllCount(all.length);
        } catch { setAllCount(0); }

        const pairs = await Promise.all(
            folders.map(async f => {
                try {
                    const arr = await j<Paper[]>(`${apiBase}/api/v1/papers/?dedup=true&folder_id=${f.id}`);
                    return [f.id, arr.length] as const;
                } catch {
                    return [f.id, 0] as const;
                }
            })
        );
        const map: Record<number, number> = {};
        pairs.forEach(([id, n]) => { map[id] = n; });
        setFolderCounts(map);
    }, [folders]);

    const refreshCounts = React.useCallback(async () => { await loadFolderCounts(); }, [loadFolderCounts]);
    const [activeFolderId, setActiveFolderId] = React.useState<number | null>(null);

    const [papers, setPapers] = React.useState<Paper[]>([]);
    const [openId, setOpenId] = React.useState<number | null>(null);
    const [selectedId, setSelectedId] = React.useState<number | null>(null);

    const [hoverPreviewId, setHoverPreviewId] = React.useState<number | null>(null);
    const [ctx, setCtx] = React.useState<{ x: number; y: number; visible: boolean; payload?: Paper }>({ x: 0, y: 0, visible: false });

    const [vizNonce, setVizNonce] = React.useState(0);

    const [tags, setTags] = React.useState<Tag[]>([]);
    const tagMap = React.useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);

    const [yearAsc, setYearAsc] = React.useState<boolean>(false);
    const [filterTagNames, setFilterTagNames] = React.useState<string[]>([]);
    const [filterVenueAbbrs, setFilterVenueAbbrs] = React.useState<string[]>([]);
    const [search, setSearch] = React.useState<string>("");
    const yearNow = new Date().getFullYear();
    const [minYear, setMinYear] = React.useState<number>(1990);
    const [maxYear, setMaxYear] = React.useState<number>(yearNow);
    const [yearMin, setYearMin] = React.useState<number>(1990);
    const [yearMax, setYearMax] = React.useState<number>(yearNow);
    

    React.useEffect(() => {
        if (!papers.length) return;
        const ys = papers.map(p => p.year || yearNow);
        const lo = Math.min(...ys, 1990), hi = Math.max(...ys, yearNow);
        setMinYear(lo); setMaxYear(hi);
        setYearMin(lo); setYearMax(hi);
      }, [papers.length]);

    const loadFolders = React.useCallback(async () => {
        try { setFolders(await j<Folder[]>(`${apiBase}/api/v1/folders/`)); } catch { setFolders([]); }
    }, []);
    const loadTags = React.useCallback(async () => {
        try { setTags(await j<Tag[]>(`${apiBase}/api/v1/tags/`)); } catch { setTags([]); }
    }, []);
    const loadPapers = React.useCallback(async () => {
        try {
          const url = new URL(`${apiBase}/api/v1/papers/`);
          url.searchParams.set("dedup", "true");
          if (activeFolderId != null) url.searchParams.set("folder_id", String(activeFolderId));
          if (search) url.searchParams.set("q", search);
          if (yearMin != null) url.searchParams.set("year_min", String(yearMin));
          if (yearMax != null) url.searchParams.set("year_max", String(yearMax));
          setPapers(await j<Paper[]>(url.toString()));
          if (filterVenueAbbrs.length) {
            url.searchParams.set("venue_abbr", filterVenueAbbrs.join(","));
          }
        } catch { setPapers([]); }
      }, [activeFolderId, search, filterVenueAbbrs, yearMin, yearMax]);

    const refreshAll = React.useCallback(async () => { await loadTags(); await loadPapers(); }, [loadTags, loadPapers]);

    const editMeta = async () => {
        if (!selectedId) return;
        const p = papers.find(x => x.id === selectedId);
        const { value: ok } = await Swal.fire({
          title: "编辑元信息",
          html: `
            <input id="title" class="swal2-input" placeholder="标题" value="${(p?.title||"").replace(/"/g,"&quot;")}" />
            <input id="venue" class="swal2-input" placeholder="期刊/会议" value="${(p?.venue||"").replace(/"/g,"&quot;")}" />
            <input id="year"  class="swal2-input" type="number" placeholder="年份" value="${p?.year||""}" />
            <input id="doi"   class="swal2-input" placeholder="DOI" value="${(p?.doi||"").replace(/"/g,"&quot;")}" />
          `,
          showCancelButton: true,
          preConfirm: async () => {
            const title = (document.getElementById('title') as HTMLInputElement).value.trim();
            const venue = (document.getElementById('venue') as HTMLInputElement).value.trim();
            const yearRaw= (document.getElementById('year') as HTMLInputElement).value.trim();
            const doi   = (document.getElementById('doi') as HTMLInputElement).value.trim();
            const payload: any = {};
            if (title) payload.title = title;
            if (venue) payload.venue = venue;
            if (yearRaw) payload.year = Number(yearRaw);
            if (doi) payload.doi = doi;
            await j(`${apiBase}/api/v1/papers/${selectedId}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
            });
            return true;
          }
        });
        if (ok) { await refreshAll(); toast("已更新元信息"); }
      };

    React.useEffect(() => { loadFolders(); loadTags(); }, [loadFolders, loadTags]);
    React.useEffect(() => { if (folders.length) { loadFolderCounts(); } }, [folders.length, loadFolderCounts]);
    // 初次加载
    React.useEffect(() => { loadPapers(); }, []);
    // 任何筛选项变动，自动触发检索（轻微防抖）
    React.useEffect(() => {
        const t = setTimeout(() => { loadPapers(); }, 180);
        return () => clearTimeout(t);
    }, [search, filterVenueAbbrs, yearMin, yearMax, activeFolderId]);

    const createFolder = async () => {
        const { value: name } = await Swal.fire({ title: "新建目录名称", input: "text", showCancelButton: true, confirmButtonText: "确定", cancelButtonText: "取消" });
        if (!name) return;
        const created = await j<Folder>(`${apiBase}/api/v1/folders/`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, color: "#64748b" })
        });
        await loadFolders(); setActiveFolderId(created.id); await loadPapers();
    };
    const tree = React.useMemo(() => buildTree(folders), [folders]);
    const createSubFolder = async (parentId: number) => {
        const { value: name } = await Swal.fire({ title: "子目录名称", input: "text", showCancelButton: true });
        if (!name) return;
        await j(`${apiBase}/api/v1/folders/`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, parent_id: parentId, color: "#94a3b8" })
        });
        await loadFolders();
    };
    const renameFolder = async () => {
        if (activeFolderId == null) return;
        const cur = folders.find(f => f.id === activeFolderId);
        const { value: name } = await Swal.fire({ title: "重命名目录", input: "text", inputValue: cur?.name, showCancelButton: true });
        if (!name) return;
        await j(`${apiBase}/api/v1/folders/${activeFolderId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
        await loadFolders();
    };
    const deleteFolder = async () => {
        if (activeFolderId == null) return;
        const ok = (await Swal.fire({ title: "删除目录？", text: "不删除论文，仅解除关系。", showCancelButton: true, confirmButtonText: "删除" })).isConfirmed;
        if (!ok) return;
        await fetch(`${apiBase}/api/v1/folders/${activeFolderId}`, { method: "DELETE" });
        setActiveFolderId(null); await loadFolders(); await loadPapers(); toast("目录已删除");
    };

    // 拖拽入目录
    const onDragEnd = async (e: any) => {
        const a = String(e?.active?.id || ""); const o = String(e?.over?.id || "");
        if (!a.startsWith("paper:") || !o.startsWith("folder:")) return;
        const paperId = Number(a.split(":")[1]); const folderId = Number(o.split(":")[1]);
        try {
            await j(`${apiBase}/api/v1/folders/${folderId}/assign`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paper_ids: [paperId] })
            });
            await loadPapers();
            await refreshCounts();
            const f = folders.find(x => x.id === folderId);
            toast(`已移动到「${f?.name || "目录"}」`);
        } catch { }
    };

    // 上传（多选）— 上传后把结果归入当前目录（不把目录当标签）
    const onUpload = async (files: FileList | null) => {
        if (!files || !files.length) return;
        if (files.length > 1) {
            const fd = new FormData(); Array.from(files).forEach(f => fd.append("files", f));
            const created = await j<Paper[]>(`${apiBase}/api/v1/papers/upload/batch`, { method: "POST", body: fd });
            if (activeFolderId != null && created.length) {
                await j(`${apiBase}/api/v1/folders/${activeFolderId}/assign`, {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paper_ids: created.map(p => p.id) })
                });
            }
        } else {
            const fd = new FormData(); fd.append("file", files[0]);
            const created = await j<Paper>(`${apiBase}/api/v1/papers/upload`, { method: "POST", body: fd });
            if (activeFolderId != null) {
                await j(`${apiBase}/api/v1/folders/${activeFolderId}/assign`, {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paper_ids: [created.id] })
                });
            }
        }
        await loadPapers(); 
        await refreshCounts();
        toast("导入完成");
    };

    // 快捷标签应用（确保实时刷新 + 乐观更新）
    const applyTags = async (names: string[]) => {
    if (!selectedId) return;
    try {
      const updated = await j<Paper>(`${apiBase}/api/v1/papers/${selectedId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: names }), // ✅ 后端要求标签名
      });
  
      // 乐观更新当前页数据
      setPapers(list =>
        list.map(p =>
          p.id === updated.id ? { ...p, tag_ids: updated.tag_ids, authors: updated.authors } : p
        )
      );
  
      // 再做一次真实刷新，确保与后端完全一致
      await refreshAll();
      setSelectedId(s => s);
      toast("已更新标签");
    } catch (err: any) {
      await Swal.fire({
        icon: "error",
        title: "更新标签失败",
        text: String(err?.message || err),
      });
    }
  };
    // 排序 & 标签筛选
    const displayPapers = React.useMemo(() => {
        let arr = [...papers];
        arr.sort((a, b) => {
            const ay = a.year || 0, by = b.year || 0;
            return yearAsc ? ay - by : by - ay;
        });
        if (!filterTagNames.length) return arr;
        const nameById = (id: number) => tags.find(t => t.id === id)?.name;
        return arr.filter(p => {
            const names = (p.tag_ids || []).map(id => nameById(id)).filter(Boolean) as string[];
            return names.some(n => filterTagNames.includes(n));
        });
    }, [papers, yearAsc, filterTagNames, tags]);

    // “期刊/会议”列：若全部能映射缩写，则隐藏
    const showVenueCol = React.useMemo(() => {
        if (!displayPapers.length) return true;
        const allHave = displayPapers.every(p => !!abbrevVenue(p.venue));
        return !allHave;
    }, [displayPapers]);

    // 键盘：↑↓ 选中，Enter 详情
    React.useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (["INPUT", "TEXTAREA"].includes((e.target as any)?.tagName)) return;
            if (!displayPapers.length) return;
            const idx = selectedId == null ? -1 : displayPapers.findIndex(p => p.id === selectedId);
            if (e.key === "ArrowDown") {
                const next = displayPapers[Math.min(displayPapers.length - 1, Math.max(0, idx + 1))];
                if (next) setSelectedId(next.id);
            } else if (e.key === "ArrowUp") {
                const prev = displayPapers[Math.max(0, Math.max(0, idx - 1))];
                if (prev) setSelectedId(prev.id);
            } else if (e.key === "Enter") {
                if (selectedId != null) setOpenId(selectedId);
            }
        };
        window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
    }, [displayPapers, selectedId]);

    // 右键菜单：移动到目录
    const showCtx = (e: React.MouseEvent, paper: Paper) => {
        e.preventDefault();
        setCtx({ x: e.clientX, y: e.clientY, visible: true, payload: paper });
    };
    React.useEffect(() => {
        const hide = () => setCtx(s => ({ ...s, visible: false }));
        window.addEventListener("click", hide); window.addEventListener("scroll", hide, true);
        return () => { window.removeEventListener("click", hide); window.removeEventListener("scroll", hide, true); };
    }, []);

    return (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            {/* 宽度 90% + 渐变背景 */}
            
            <div className="mx-auto w-[90%] py-6 bg-gradient-to-b from-white via-slate-50 to-white rounded-2xl">
                <div className="flex items-center justify-between mb-4">
                    <div className="text-xl font-semibold flex items-center gap-2">
                        <FolderIcon className="w-5 h-5 text-indigo-600" /><span>文献目录管理</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50 cursor-pointer">
                            <UploadCloud className="w-4 h-4" /><span>导入 PDF（支持多选）</span>
                            <input type="file" multiple className="hidden" onChange={e => onUpload(e.target.files)} />
                        </label>
                    </div>
                    <div className="flex items-center gap-2">
                    <button
                            className="ml-2 text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50"
                            onClick={async () => {
                              const { value: form } = await Swal.fire({
                                title: "通过 DOI 添加",
                                html: `
                                  <div class="space-y-2 text-left">
                                    <input id="doi" class="swal2-input" placeholder="DOI（必填）" />
                                    <input id="title" class="swal2-input" placeholder="标题（可选，解析失败才会用到）" />
                                    <input id="venue" class="swal2-input" placeholder="期刊/会议（可选）" />
                                    <input id="year"  class="swal2-input" type="number" placeholder="年份（可选）" />
                                    <textarea id="abs" class="swal2-textarea" placeholder="摘要（可选）"></textarea>
                                  </div>`,
                                focusConfirm: false, showCancelButton: true,
                                preConfirm: () => {
                                  const doi = (document.getElementById('doi') as HTMLInputElement).value.trim();
                                  if (!doi) { Swal.showValidationMessage("DOI 不能为空"); return false; }
                                  const title = (document.getElementById('title') as HTMLInputElement).value.trim();
                                  const venue = (document.getElementById('venue') as HTMLInputElement).value.trim();
                                  const yearRaw = (document.getElementById('year') as HTMLInputElement).value.trim();
                                  const abstract = (document.getElementById('abs') as HTMLTextAreaElement).value.trim();
                                  const year = yearRaw ? Number(yearRaw) : undefined;
                                  return { doi, title: title || undefined, venue: venue || undefined, year, abstract: abstract || undefined };
                                }
                              });
                              if (!form) return;

                              // 显示“解析中”，不要等待弹窗 Promise（避免卡住）
                              Swal.fire({ title: "正在解析 DOI…", didOpen: () => Swal.showLoading(), allowOutsideClick: false });
                              try {
                                // 1) 请求后端严格解析 + 入库（解析失败将返回 424，不会入库）
                                const created = await j<Paper>(`${apiBase}/api/v1/papers/create`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify(form),
                                });

                                // 2) 若当前在某个目录下，归档进去
                                if (created?.id != null && activeFolderId != null) {
                                  await j(`${apiBase}/api/v1/folders/${activeFolderId}/assign`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ paper_ids: [created.id] })
                                  });
                                }

                                // 3) 刷新并选中新建项
                                await loadPapers();
                                await refreshCounts();
                                setSelectedId(created.id);
                                Swal.close();
                                toast("已解析并入库");
                              } catch (e: any) {
                                // 424 / 网络错误等：弹窗提示错误信息（后端 detail 会包含失败原因）
                                Swal.close();
                                Swal.fire({
                                  icon: "error",
                                  title: "添加失败",
                                  text: String(e?.message || e),
                                });
                              }
                            }}

                          >
                          通过 DOI 添加
                          </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[300px,1fr,360px] gap-4">
                    {/* 左侧：目录 + 标签（标签位于目录下方） */}
                    <div className="space-y-4">
                    <div className="rounded-2xl border bg-white p-2 text-[14px]">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-xs text-gray-600">目录</div>
                            <div className="flex items-center gap-1">
                                <button onClick={createFolder} className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50"><Plus className="w-3.5 h-3.5" /></button>
                                <button onClick={renameFolder} className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50"><Pencil className="w-3.5 h-3.5" /></button>
                                <button onClick={deleteFolder} className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                        </div>
                        <div className={`px-2 py-1 rounded-md cursor-pointer mb-1 text-[14px] flex items-center justify-between ${activeFolderId == null ? "bg-blue-50/70 border border-blue-200" : "hover:bg-gray-50"}`}
                            onClick={() => { setActiveFolderId(null); setSelectedId(null); }}>
                            <span>全部</span>
                            <span className="text-[11px] px-1.5 py-[1px] rounded border bg-gray-50 text-gray-700 min-w-[1.5rem] text-center">{allCount}</span>
                        </div>
                        <div className="space-y-1">
                        {tree.map((node, i) => (
                            <FolderTreeNode key={node.id} node={node} depth={0} index={i + 1} activeId={activeFolderId}
                                onPick={(id) => { setActiveFolderId(id); setSelectedId(null); }}
                                onCreateChild={createSubFolder}
                                collapsedSet={collapsed}
                                toggle={toggleCollapse}
                                counts={folderCounts}
                            />
                        ))}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-3">提示：拖拽<strong>把手</strong>或在论文上<strong>右键</strong>选择目录。</div>
                      </div>
                      <QuickTagPanel
                          paper={selectedId ? papers.find(p => p.id === selectedId) || null : null}
                          allTags={tags}
                          onApply={applyTags}
                          onRefreshAll={refreshAll}
                          onVizChange={() => setVizNonce(x => x + 1)}
                        //   compact
                      />
                      {/* 标签面板（缩短高度版） */}
                    </div>

                    {/* 中间：表格 */}
                    <div className="rounded-2xl border bg-white overflow-hidden">
                        {/* 顶部工具行（标签筛选留在顶部，不占用左侧目录区） */}
                        <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                        <div className="flex items-center gap-3 text-sm">
                            <button onClick={() => setYearAsc(v => !v)} className="px-2 py-1 rounded-md border hover:bg-white">
                                年份排序 {yearAsc ? <ChevronUp className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />}
                            </button>
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="搜索标题 / DOI / 期刊（即时）"
                                className="px-2 py-1 rounded-md border"
                            />
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">年份：</span>
                                <YearDualSlider
                                    start={minYear}
                                    end={maxYear}
                                    value={[yearMin, yearMax]}
                                    onChange={(a, b) => { setYearMin(a); setYearMax(b); }}
                                />
                                <span className="text-xs text-gray-600">{yearMin} - {yearMax}</span>
                                <button className="text-xs px-2 py-1 rounded border" onClick={loadPapers}>应用</button>
                                </div>
                            </div>
                        <div className="flex items-center gap-2">
                            <VenueAbbrDropdown value={filterVenueAbbrs} onChange={setFilterVenueAbbrs} />
                            <TagFilterDropdown tags={tags} value={filterTagNames} onChange={setFilterTagNames} />
                        </div>
                        </div>

                        <div className="max-h-[74vh] overflow-auto">
                            <table className="w-full text-sm table-fixed">
                                <thead className="sticky top-0 bg-gray-50">
                                    <tr className="text-left text-xs text-gray-500">
                                        <th className="px-2 py-1.5 w-[36px]"></th>
                                        <th className="px-2 py-1.5 w-[80px]">年</th>
                                        <th className="px-2 py-1.5 w-[48%] min-w-[360px]">标题</th>
                                        <th className="px-2 py-1.5 w-[18%]">作者</th>
                                        {!displayPapers.every(p => !!abbrevVenue(p.venue)) && <th className="px-2 py-1.5 w-[10%]">期刊/会议</th>}
                                        <th className="px-2 py-1.5 w-[18%]">彩色标签</th>
                                        <th className="px-2 py-1.5 w-[18%]">文字标签</th>
                                        <th className="px-2 py-1.5 w-[60px]">PDF</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayPapers.map(p => (
                                        <PaperRow key={p.id}
                                            p={p}
                                            onOpen={id => setOpenId(id)}
                                            onSelect={(id) => setSelectedId(id)}
                                            onPreviewHover={(id) => setHoverPreviewId(id)}
                                            onContextMenu={showCtx}
                                            selected={selectedId === p.id}
                                            tagMap={tagMap}
                                            showVenueCol={!displayPapers.every(x => !!abbrevVenue(x.venue))}
                                            vizNonce={vizNonce}
                                        />
                                    ))}
                                    {!displayPapers.length && (
                                        <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-500">
                                            这里还没有论文，右上角导入或者拖拽 PDF 到页内空白处试试～
                                        </td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* 右侧：预览 / 摘要 / 词云 */}
                    <div className="space-y-4">
                        {/* 悬停预览 */}
                        <div className="rounded-2xl border bg-white overflow-hidden h-[220px]">
                            <div className="px-3 py-2 border-b bg-gradient-to-r from-sky-50 to-indigo-50 flex items-center gap-2">
                                <Eye className="w-4 h-4 text-sky-600" />
                                <div className="text-sm font-medium">PDF 预览</div>
                                {selectedId && <button className="ml-auto text-xs px-2 py-1 rounded border" onClick={editMeta}>编辑元信息</button>}
                            </div>
                            {hoverPreviewId
                                ? (() => {
                                    const paper = displayPapers.find(p => p.id === hoverPreviewId);
                                    if (paper?.pdf_url) {
                                        const src = `${apiBase}${paper.pdf_url}#view=FitH,top&toolbar=0&navpanes=0`;
                                        return <iframe src={src} className="w-full h-[180px]" />;
                                    }
                                    return <div className="h-[180px] flex items-center justify-center text-sm text-gray-400">无 PDF</div>;
                                })()
                                : <div className="h-[180px] flex items-center justify-center text-sm text-gray-400">将鼠标悬停在某行以预览 PDF</div>}
                        </div>
                        <AbstractNotePanel paper={selectedId ? papers.find(p => p.id === selectedId) || null : null} />
                        {/* 词云 */}
                        <WordCloudPanel papers={displayPapers} tags={tags} />
                    </div>
                </div>

                {/* 右键菜单：移动到目录 */}
                {ctx.visible && (
                    <div className="fixed z-50" style={{ left: ctx.x, top: ctx.y }}>
                        <div className="bg-white border rounded-md shadow-lg w-48 p-1">
                            <div className="px-2 py-1.5 text-xs text-gray-500">移动到目录</div>
                            <div className="max-h-64 overflow-auto">
                                {folders.map(f => (
                                    <button key={f.id}
                                        className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 text-sm flex items-center gap-2"
                                        onClick={async () => {
                                            if (!ctx.payload) return;
                                            await j(`${apiBase}/api/v1/folders/${f.id}/assign`, {
                                                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paper_ids: [ctx.payload.id] })
                                            });
                                            setCtx(s => ({ ...s, visible: false }));
                                            await loadPapers();
                                            toast(`已移动到「${f.name}」`);
                                        }}>
                                        <span className="w-2.5 h-2.5 rounded-full border" style={{ background: f.color || "transparent" }} />
                                        {f.name}
                                    </button>
                                ))}
                            </div>
                            <div className="border-t my-1" />
                            <button
                                className="w-full text-left px-2 py-1.5 rounded hover:bg-red-50 text-sm flex items-center gap-2 text-red-600"
                                onClick={async () => {
                                  if (!ctx.payload) return;
                                  const ok = (await Swal.fire({
                                    icon: "warning",
                                    title: "删除该论文？",
                                    text: "此操作不可撤销，将删除论文及其关联（标签/作者关系、笔记、目录关系）。",
                                    showCancelButton: true,
                                    confirmButtonText: "删除",
                                    confirmButtonColor: "#ef4444"
                                  })).isConfirmed;
                                  if (!ok) return;
                                  await fetch(`${apiBase}/api/v1/papers/${ctx.payload.id}`, { method: "DELETE" });
                                  setCtx(s => ({ ...s, visible: false }));
                                  setSelectedId(s => (s === ctx.payload!.id ? null : s));
                                  await loadPapers();
                                  await refreshCounts();
                                  toast("论文已删除");
                                }}
                            >
                                <Trash2 className="w-4 h-4" />
                                删除论文
                            </button>
                        </div>
                    </div>
                )}

                <Detail openId={openId} onClose={() => setOpenId(null)} />
            </div>
        </DndContext>
    );
}