import React from "react";
import { useRouter } from "next/router";
import {
    UploadCloud, Plus, Pencil, Trash2, ChevronUp, ChevronDown, ChevronRight,
    GripVertical, Eye, Folder as FolderIcon, Share2
} from "lucide-react";
import SwalCore from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
import {
    DndContext, PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import AuthorFilterDropdown from "@/components/Library/AuthorFilterDropdown";
import PaperGraphDialog from "@/components/Library/PaperGraphDialog";
import AuthorGraphDialog from "@/components/Library/AuthorGraphDialog";
import Detail from "@/components/Library/DetailDialog";
import AbstractNotePanel from "@/components/Library/AbstractNodePanel";
import VenueAbbrDropdown from "@/components/Library/VenueAbbrDropdown";
import YearDualSlider from "@/components/Library/YearDualSlider";
import {getTagPrio, getTagColor, isOpenSourceTag, QuickTagPanel} from "@/components/Library/QuickTagPanel";
import TagFilterDropdown from "@/components/Library/TagFilterDropdown";
import {abbrevVenue,venueTier} from "@/components/Library/CONST";

const Swal = withReactContent(SwalCore);
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
/* --------------------------- types --------------------------- */
type Tag = { id: number; name: string; color?: string | null };
type Folder = { id: number; name: string; color?: string | null; parent_id?: number | null; priority?: number | null };
type FolderNode = Folder & { children?: FolderNode[] };
type Paper = {
    id: number; title: string; abstract?: string | null; year?: number | null; venue?: string | null;
    doi?: string | null; pdf_url?: string | null;
    authors?: { id?: number; name?: string; affiliation?: string | null }[];
    tag_ids?: number[];
};
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
// 仅按文件夹取论文（忽略当前筛选）；尽量兼容后端多种路由
async function loadFolderPapersAll(folderId: number, includeChildren = false): Promise<Paper[]> {
    const qs = includeChildren ? "?include_children=true" : "";
    const urls = [
      `${apiBase}/api/v1/papers?folder_id=${folderId}${qs}`,
      `${apiBase}/api/v1/folders/${folderId}/papers${qs ? `?${qs.slice(1)}` : ""}`,
      `${apiBase}/api/v1/papers/by_folder/${folderId}${qs ? `?${qs.slice(1)}` : ""}`,
    ];
    for (const url of urls) {
      try {
        const r = await j<any>(url);
        if (Array.isArray(r)) return r as Paper[];
        if (Array.isArray(r?.items)) return r.items as Paper[];
        if (Array.isArray(r?.data)) return r.data as Paper[];
      } catch { /* try next */ }
    }
    return [];
  }

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
    folder, depth, active, onClick, onCreateChild, hasChildren, collapsed, onToggle, count = 0, numLabel, onFolderContextMenu
}: {
    folder: Folder; depth: number; active: boolean; onClick: () => void; onCreateChild: (parentId: number) => void;
    hasChildren: boolean; collapsed: boolean; onToggle: () => void; count?: number; numLabel?: string; onFolderContextMenu?: (e: React.MouseEvent, folder: Folder) => void;
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
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onFolderContextMenu?.(e, folder); }}
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
                    <button
                className="text-[10px] px-1 py-[1px] rounded border hover:bg-gray-50"
                onClick={(e) => {
                    e.stopPropagation();
                    // 发送事件：仅本文件夹
                    window.dispatchEvent(new CustomEvent('infinipaper:open-folder-graph', {
                        detail: { folderId: folder.id, includeChildren: false } // 想含子目录就 true
                      }));
                }}
                title="仅本文件夹的引用关系网"
                >
                ▒
            </button>
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
    onPreviewHover: (id: number | null, rect?: DOMRect) => void; onContextMenu: (e: React.MouseEvent, paper: Paper) => void;
    tagMap: Map<number, Tag>; selected: boolean; showVenueCol: boolean; vizNonce: number;
}) {
    const router = useRouter();
    const authors = (p.authors || []).map(a => a?.name).filter(Boolean).slice(0, 6).join(", ");
    const allTags = (p.tag_ids || []).map(id => tagMap.get(id)).filter((t): t is Tag => !!t);
    const colored = allTags.filter(t => getTagColor(t.name));
    const plain = allTags.filter(t => !getTagColor(t.name));
    const abbr = abbrevVenue(p.venue);
    const tier = venueTier(abbr);

    const chipClass =
        tier === 1
            ? "text-[11px] px-1.5 py-[1px] mr-2 rounded-md border bg-rose-50 border-rose-200 text-rose-700"
            : tier === 3
            ? "text-[11px] px-1.5 py-[1px] mr-2 rounded-md border bg-blue-700 border-blue-800 text-white"
            : "text-[11px] px-1.5 py-[1px] mr-2 rounded-md border bg-indigo-50 border-indigo-200 text-indigo-700";
    
    return (
        <tr
            className={`border-t ${selected ? "bg-blue-50/60" : "odd:bg-white even:bg-slate-50/40 hover:bg-gray-50"} cursor-pointer select-none`}
            onClick={() => onSelect(p.id)}
            onDoubleClick={() => {
              const pdf = p.pdf_url || "";
              const q = pdf ? `?pdf=${encodeURIComponent(pdf)}` : "";
              router.push(`/reader/${p.id}${q}`);
            }}
            onMouseEnter={(e) => onPreviewHover(p.id, (e.currentTarget as HTMLElement).getBoundingClientRect())}
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
    node, depth, index, activeId, onPick, onCreateChild, collapsedSet, toggle, counts, onFolderContextMenu
} : {
    node: FolderNode; depth: number; index: number; activeId: number | null;
    onPick: (id: number) => void; onCreateChild: (parentId: number) => void;
    collapsedSet: Set<number>; toggle: (id: number) => void; counts: Record<number, number>;
    onFolderContextMenu?: (e: React.MouseEvent, folder: Folder) => void;
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
                onFolderContextMenu={onFolderContextMenu}
            />
            {hasChildren && !isCollapsed && (
                <div className="space-y-[2px] mt-0.5">
                    {node.children!.map((ch, i) => (
                        <FolderTreeNode key={ch.id} node={ch} depth={depth + 1} index={i + 1} activeId={activeId}
                            onPick={onPick} onCreateChild={onCreateChild} collapsedSet={collapsedSet} toggle={toggle} counts={counts}
                            onFolderContextMenu={onFolderContextMenu}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

/* --------------------------- main page --------------------------- */
export default function Library() {
    // 左侧目录右键菜单（导出功能）
    const [folderCtx, setFolderCtx] = React.useState<{ visible: boolean; x: number; y: number; folderId: number | null }>({ visible: false, x: 0, y: 0, folderId: null });
    // 顶部筛选栏：第二排（高级筛选）折叠开关
    const [advFilterOpen, setAdvFilterOpen] = React.useState(true);
    const [paperGraphOpen, setPaperGraphOpen] = React.useState(false);
    const [paperGraphPapers, setPaperGraphPapers] = React.useState<Paper[] | null>(null);
    const openFolderCtx = (x: number, y: number, folderId: number | null) => setFolderCtx({ visible: true, x, y, folderId });
    React.useEffect(() => {
      const hide = () => setFolderCtx(s => ({ ...s, visible: false }));
      window.addEventListener("click", hide);
      window.addEventListener("scroll", hide, true);
      return () => { window.removeEventListener("click", hide); window.removeEventListener("scroll", hide, true); };
    }, []);
    const [folders, setFolders] = React.useState<Folder[]>([]);
    const [tags, setTags] = React.useState<Tag[]>([]);
    // 递归收集子目录 id
    const folderChildrenMap = React.useMemo(() => {
      const m = new Map<number, number[]>();
      folders.forEach(f => m.set(f.id, []));
      folders.forEach(f => { if (f.parent_id) { const arr = m.get(f.parent_id) || []; arr.push(f.id); m.set(f.parent_id, arr); } });
      return m;
    }, [folders]);
    const getDescendantIds = React.useCallback((rootId: number): number[] => {
      const res: number[] = [];
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop()!;
        const kids = folderChildrenMap.get(id) || [];
        for (const k of kids) { res.push(k); stack.push(k); }
      }
      return res;
    }, [folderChildrenMap]);

    // 拉取某目录（含子目录）下的论文集合
    const fetchPapersForFolders = React.useCallback(async (folderId: number | null): Promise<Paper[]> => {
      if (folderId == null) {
        return await j<Paper[]>(`${apiBase}/api/v1/papers/?dedup=true`);
      }
      const ids = [folderId, ...getDescendantIds(folderId)];
      const lists = await Promise.all(ids.map(id => j<Paper[]>(`${apiBase}/api/v1/papers/?dedup=true&folder_id=${id}`)));
      const map = new Map<number, Paper>();
      lists.flat().forEach(p => map.set(p.id, p));
      return Array.from(map.values());
    }, [getDescendantIds]);

    // 下载辅助
    const downloadTextFile = (filename: string, text: string) => {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    };
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
    const safeName = (s: string) => (s || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const firstAuthorSurname = (p: Paper) => { const n = p.authors?.[0]?.name || ''; const parts = n.trim().split(/\s+/); return parts.length ? parts[parts.length - 1] : ''; };
    const pdfFileName = (p: Paper) => {
      const y = p.year || 'noyear';
      const ab = abbrevVenue(p.venue) || (p.venue ? p.venue.replace(/\s+/g, '') : 'nov');
      const sur = firstAuthorSurname(p) || 'anon';
      const title = safeName((p.title || 'paper').split(/\s+/).slice(0, 8).join('_'));
      return `${y}_${sur}_${ab}_${title}.pdf`;
    };

    // 导出：BibTeX（.tex）
    const exportBibTeXOfFolder = React.useCallback(async (folderId: number | null) => {
      const papers = await fetchPapersForFolders(folderId);
      const entries: string[] = []; const errs: string[] = [];
      for (const p of papers) {
        try { const tex = await fetchBibTeXByDOI(p.doi || undefined); entries.push(tex.trim()); }
        catch (e: any) { errs.push(`${p.title || 'Untitled'}: ${String(e?.message || e)}`); }
      }
      if (!entries.length) {
        await Swal.fire({ icon: 'error', title: '没有可导出的 BibTeX', text: errs.length ? `全部失败：${errs.slice(0, 3).join('；')}…` : '该目录下没有包含 DOI 的论文。' });
        return;
      }
      const folderName = folderId == null ? 'all' : (folders.find(f => f.id === folderId)?.name || 'folder');
      const content = [`% Exported ${new Date().toISOString()}`, `% Folder: ${folderName} (含子目录)`, '', ...entries].join('\n\n');
      downloadTextFile(`${folderName}_bibtex.tex`, content);
      if (errs.length) await Swal.fire({ icon: 'warning', title: '部分导出失败', text: `成功 ${entries.length} 条，失败 ${errs.length} 条（多为缺少 DOI 或网络错误）。` });
      else toast('BibTeX 已导出');
    }, [fetchPapersForFolders, folders]);

    // 导出：Excel（CSV）
    const csvEscape = (s?: string | null) => { const v = s ?? ''; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const exportCSVOfFolder = React.useCallback(async (folderId: number | null) => {
      const papers = await fetchPapersForFolders(folderId);
      if (!papers.length) { await Swal.fire({ icon: 'info', title: '没有可导出的数据' }); return; }
      const header = ['Title', 'Authors', 'Year', 'Venue', 'DOI', 'PDF URL', 'Tags'];
      const nameById = (id: number) => tags.find(t => t.id === id)?.name || '';
      const rows = papers.map(p => {
        const authors = (p.authors || []).map(a => a?.name).filter(Boolean).join('; ');
        const tagsStr = (p.tag_ids || []).map(id => nameById(id)).filter(Boolean).join('; ');
        return [p.title || '', authors, String(p.year || ''), p.venue || '', p.doi || '', p.pdf_url || '', tagsStr];
      });
      const lines = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
      downloadTextFile(`papers_${folderId ?? 'all'}.csv`, lines);
      toast('CSV 已导出（Excel 可直接打开）');
    }, [fetchPapersForFolders, tags]);

    // 导出：Markdown
    const exportMarkdownOfFolder = React.useCallback(async (folderId: number | null) => {
      const papers = await fetchPapersForFolders(folderId);
      const nameById = (id: number) => tags.find(t => t.id === id)?.name || '';
      const folderName = folderId == null ? '全部' : (folders.find(f => f.id === folderId)?.name || '目录');
      const lines: string[] = [`# ${folderName} · 文献导出`, '', `共 ${papers.length} 篇`, ''];
      for (const p of papers) {
        const authors = (p.authors || []).map(a => a?.name).filter(Boolean).join(', ');
        const tagsStr = (p.tag_ids || []).map(id => nameById(id)).filter(Boolean).join(', ');
        const venueYear = [p.venue || '', p.year || ''].filter(Boolean).join(', ');
        const titleMd = p.pdf_url ? `[${p.title}](${p.pdf_url})` : (p.title || '无标题');
        const doiMd = p.doi ? ` DOI: ${p.doi}` : '';
        const tagsMd = tagsStr ? ` _(${tagsStr})_` : '';
        lines.push(`- ${titleMd} — ${authors}${venueYear ? ` · ${venueYear}` : ''}.${doiMd}${tagsMd}`);
      }
      downloadTextFile(`${folderName}_papers.md`, lines.join('\n'));
      toast('Markdown 已导出');
    }, [fetchPapersForFolders, folders, tags]);
    const sensors = useSensors(useSensor(PointerSensor));
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
    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState(50);

    const [hoverPreviewId, setHoverPreviewId] = React.useState<number | null>(null);
    const [hoverPreviewRect, setHoverPreviewRect] = React.useState<DOMRect | null>(null);
    const [hoveringPreview, setHoveringPreview] = React.useState(false);
    const hoverTimer = React.useRef<number | null>(null);

    const handlePreviewHover = (id: number | null, rect?: DOMRect) => {
      if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
      if (id == null) {
        // 若预览面板仍在被鼠标悬停，则不立即关闭；稍作延迟避免抖动
        if (!hoveringPreview) setHoverPreviewId(null);
        return;
      }
      if (rect) setHoverPreviewRect(rect);
      hoverTimer.current = window.setTimeout(() => {
        setHoverPreviewId(id);
        hoverTimer.current = null;
      }, 1300); // 1.3 秒延迟
    };

    React.useEffect(() => {
      return () => { if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); } };
    }, []);
    const [ctx, setCtx] = React.useState<{ x: number; y: number; visible: boolean; payload?: Paper }>({ x: 0, y: 0, visible: false });

    const [vizNonce, setVizNonce] = React.useState(0);

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
    const [filterAuthors, setFilterAuthors] = React.useState<string[]>([]);
    const [graphOpen, setGraphOpen] = React.useState(false);
    const [graphSeed, setGraphSeed] = React.useState<string | null>(null);
    
    const openAuthorGraph = React.useCallback(async () => {
      if (!filterAuthors.length) {
        await Swal.fire({ icon: 'info', title: '请选择作者', text: '请先在“按作者”里选择一个作者。' });
        return;
      }
      let seed = filterAuthors[0];
      if (filterAuthors.length > 1) {
        const { value } = await Swal.fire({
          title: '选择要查看的作者',
          input: 'select',
          inputOptions: filterAuthors.reduce((m, n) => { (m as any)[n] = n; return m; }, {} as any),
          inputPlaceholder: '选择作者',
          showCancelButton: true
        });
        if (!value) return;
        seed = value as string;
      }
      setGraphSeed(seed);
      setGraphOpen(true);
    }, [filterAuthors]);
    const allAuthors = React.useMemo(() => {
    const s = new Set<string>();
    papers.forEach(p => (p.authors || []).forEach(a => a?.name && s.add(a.name)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
    }, [papers]);

      
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
        if (filterVenueAbbrs.length) url.searchParams.set("venue_abbr", filterVenueAbbrs.join(","));
        setPapers(await j<Paper[]>(url.toString()));
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

      // 作者筛选（命中任意一个选中作者即可）
      if (filterAuthors.length) {
        arr = arr.filter(p => {
          const names = (p.authors || []).map(a => a?.name).filter(Boolean) as string[];
          return names.some(n => filterAuthors.includes(n));
        });
      }

      // 会议/期刊缩写筛选（客户端兜底）
      if (filterVenueAbbrs.length) {
        arr = arr.filter(p => {
          const ab = abbrevVenue(p.venue);
          return ab ? filterVenueAbbrs.includes(ab) : false;
        });
      }

      // 标签筛选（沿用你原来的逻辑）
      if (!filterTagNames.length) return arr;
      const nameById = (id: number) => tags.find(t => t.id === id)?.name;
      return arr.filter(p => {
        const names = (p.tag_ids || []).map(id => nameById(id)).filter(Boolean) as string[];
        return names.some(n => filterTagNames.includes(n));
      });
    }, [papers, yearAsc, filterAuthors, filterTagNames, filterVenueAbbrs, tags]);

    // 本地分页数据
    const total = displayPapers.length;
    const totalPages = React.useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
    const pageData = React.useMemo(() => {
      const start = (page - 1) * pageSize;
      return displayPapers.slice(start, start + pageSize);
    }, [displayPapers, page, pageSize]);

    // 当筛选变化或总页数变化时，重置/纠正页码
    React.useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages]);
    React.useEffect(() => { setPage(1); }, [search, filterVenueAbbrs, filterAuthors, filterTagNames, yearMin, yearMax, activeFolderId]);

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
            if (!pageData.length) return;
            const idx = selectedId == null ? -1 : pageData.findIndex(p => p.id === selectedId);
            if (e.key === "ArrowDown") {
                const next = pageData[Math.min(pageData.length - 1, Math.max(0, idx + 1))];
                if (next) setSelectedId(next.id);
            } else if (e.key === "ArrowUp") {
                const prev = pageData[Math.max(0, Math.max(0, idx - 1))];
                if (prev) setSelectedId(prev.id);
            } else if (e.key === "Enter") {
                if (selectedId != null) setOpenId(selectedId);
            }
        };
        window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
    }, [pageData, selectedId]);
    // ✅ 仅本文件夹的引用网（兼容多字段名 + 提前检查 DOI）
    React.useEffect(() => {
        const handler = (ev: Event) => {
          (async () => {
            const detail = (ev as CustomEvent).detail || {};
            const folderId = Number(detail.folderId);
            const includeChildren = !!detail.includeChildren; // 以后要支持含子目录可用
            if (!folderId) return;
      
            // ✅ 忽略当前筛选：从后端按目录取全量论文
            const subset = await loadFolderPapersAll(folderId, includeChildren);
            if (!subset.length) {
              Swal.fire({
                icon: 'info',
                title: '该文件夹暂无可分析论文',
                text: '（已忽略筛选）未找到属于该目录的论文。',
                timer: 1400,
                showConfirmButton: false,
              });
              return;
            }
      
            const withDOI = subset.filter((p: any) => !!p?.doi);
            if (!withDOI.length) {
              Swal.fire({
                icon: 'info',
                title: '该文件夹暂无可分析论文',
                text: '该目录下的论文均缺少 DOI，无法构建引用关系网。',
                timer: 1600,
                showConfirmButton: false,
              });
              return;
            }
      
            setPaperGraphPapers(withDOI as Paper[]);
            setPaperGraphOpen(true);
          })();
        };
      
        window.addEventListener('infinipaper:open-folder-graph', handler as any);
        return () => window.removeEventListener('infinipaper:open-folder-graph', handler as any);
      }, []); // 👈 一定是空依赖，避免跟随筛选变化

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
                        <div
                          className={`px-2 py-1 rounded-md cursor-pointer mb-1 text-[14px] flex items-center justify-between ${activeFolderId == null ? "bg-blue-50/70 border border-blue-200" : "hover:bg-gray-50"}`}
                          onClick={() => { setActiveFolderId(null); setSelectedId(null); }}
                          onContextMenu={(e) => { e.preventDefault(); openFolderCtx(e.clientX, e.clientY, null); }}
                        >
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
                                onFolderContextMenu={(e, f) => openFolderCtx(e.clientX, e.clientY, f.id)}
                            />
                        ))}
                        </div>
                        {/* 目录右键菜单 */}
                        {folderCtx.visible && (
                            <div
                            className="fixed z-50 bg-white border shadow-lg rounded-md text-sm"
                            style={{ left: folderCtx.x, top: folderCtx.y, minWidth: 260 }}
                            >
                            <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={async () => { setFolderCtx(s => ({ ...s, visible: false })); await exportBibTeXOfFolder(folderCtx.folderId); }}>导出 BibTeX 为 .tex（含子目录）</button>
                            <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={async () => { setFolderCtx(s => ({ ...s, visible: false })); await exportCSVOfFolder(folderCtx.folderId); }}>导出为 Excel（CSV）</button>
                            <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={async () => { setFolderCtx(s => ({ ...s, visible: false })); await exportMarkdownOfFolder(folderCtx.folderId); }}>导出为 Markdown</button>
                            </div>
                        )}
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
                        <div className="relative z-[70] px-3 py-2 border-b bg-gray-50">
                          {/* 一体式可换行容器：第一排（基础筛选） + 第二排（高级筛选） */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                            {/* 基础筛选（第一排） */}
                            <button onClick={() => setYearAsc(v => !v)} className="px-2 py-1 rounded-md border hover:bg-white">
                              年份排序 {yearAsc ? <ChevronUp className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />}
                            </button>
                            <input
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                              placeholder="搜索标题 / DOI / 期刊（即时）"
                              className="px-2 py-1 rounded-md border"
                            />
                            <span className="text-xs text-gray-500">年份：</span>
                            <YearDualSlider
                              start={minYear}
                              end={maxYear}
                              value={[yearMin, yearMax]}
                              onChange={(a, b) => { setYearMin(a); setYearMax(b); }}
                            />
                            <span className="text-xs text-gray-600">{yearMin} - {yearMax}</span>
                            <button className="text-xs px-2 py-1 rounded border" onClick={loadPapers}>应用</button>

                            {/* 折叠按钮：固定在第一排最右侧 */}
                            <button
                              type="button"
                              onClick={() => setAdvFilterOpen(v => !v)}
                              className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border bg-white hover:bg-gray-50"
                              title={advFilterOpen ? "隐藏筛选栏" : "展开筛选栏"}
                            >
                              {advFilterOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>

                            {/* 高级筛选（第二排，整行显示，可折叠 + 动画） */}
                                                        {/* 高级筛选（第二排，整行显示，可折叠，overflow 仅在收起时隐藏） */}
                                                        <div
                              className={`basis-full transform-gpu transition-[max-height,opacity,transform] duration-300 ease-out origin-top ${advFilterOpen ? 'max-h-[260px] opacity-100 scale-y-100 overflow-visible' : 'max-h-0 opacity-0 scale-y-95 overflow-hidden'}`}
                            >
                              <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                                <VenueAbbrDropdown value={filterVenueAbbrs} onChange={setFilterVenueAbbrs} />
                                <TagFilterDropdown tags={tags} value={filterTagNames} onChange={setFilterTagNames} />
                                <AuthorFilterDropdown authors={allAuthors} value={filterAuthors} onChange={setFilterAuthors} />
                                <button
                                  type="button"
                                  onClick={openAuthorGraph}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
                                  disabled={!filterAuthors.length}
                                  title="查看所选作者的合作者关系网"
                                >
                                  <Share2 className="w-3.5 h-3.5" />
                                  关系网
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="relative z-0 max-h-[74vh] overflow-auto">
                            <table className="w-full text-sm table-fixed">
                                <thead className="sticky top-0 bg-gray-50">
                                    <tr className="text-left text-xs text-gray-500">
                                        <th className="px-2 py-1.5 w-[36px]"></th>
                                        <th className="px-2 py-1.5 w-[80px]">年</th>
                                        <th className="px-2 py-1.5 w-[48%] min-w-[360px]">标题</th>
                                        <th className="px-2 py-1.5 w-[18%]">作者</th>
                                        {showVenueCol && <th className="px-2 py-1.5 w-[10%]">期刊/会议</th>}
                                        <th className="px-2 py-1.5 w-[18%]">彩色标签</th>
                                        <th className="px-2 py-1.5 w-[18%]">文字标签</th>
                                        <th className="px-2 py-1.5 w-[60px]">PDF</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageData.map(p => (
                                        <PaperRow key={p.id}
                                            p={p}
                                            onOpen={id => setOpenId(id)}
                                            onSelect={(id) => setSelectedId(id)}
                                            onPreviewHover={handlePreviewHover}
                                            onContextMenu={showCtx}
                                            selected={selectedId === p.id}
                                            tagMap={tagMap}
                                            showVenueCol={showVenueCol}
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
                        {/* 分页条 */}
                        <div className="flex items-center gap-2 px-3 py-2 border-t bg-gray-50 text-sm">
                          <span>共 {total} 篇</span>
                          <span className="ml-2 text-xs text-gray-500">每页</span>
                          <select
                            value={pageSize}
                            onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }}
                            className="border rounded px-2 py-1"
                          >
                            {[20, 50, 100, 200].map(n => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                          <div className="ml-auto flex items-center gap-2">
                            <button
                              disabled={page <= 1}
                              onClick={() => setPage(p => Math.max(1, p - 1))}
                              className="px-2 py-1 border rounded disabled:opacity-50"
                            >上一页</button>
                            <span>{page} / {totalPages}</span>
                            <button
                              disabled={page >= totalPages}
                              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                              className="px-2 py-1 border rounded disabled:opacity-50"
                            >下一页</button>
                          </div>
                        </div>
                    </div>

                    {/* 右侧：预览 / 摘要 / 词云 */}
                    <div className="space-y-4">
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
            <AuthorGraphDialog
            open={graphOpen}
            seed={graphSeed}
            papers={displayPapers}
            onClose={() => setGraphOpen(false)}
            />
            <PaperGraphDialog
            open={paperGraphOpen}
            papers={paperGraphPapers ?? displayPapers}
            onClose={() => { setPaperGraphOpen(false); setPaperGraphPapers(null); }}
            />
        {/* Hide all scrollbars globally (keeps scrolling functional) */}
        <style jsx global>{`
          /* Hide all scrollbars globally (keeps scrolling functional) */
          * {
            -ms-overflow-style: none;  /* IE & old Edge */
            scrollbar-width: none;     /* Firefox */
          }
          *::-webkit-scrollbar {
            width: 0 !important;
            height: 0 !important;
          }
          *::-webkit-scrollbar-thumb,
          *::-webkit-scrollbar-track {
            background: transparent !important;
            border: none !important;
          }
        `}</style>
        {/* 悬停浮动 PDF 预览（延迟 2 秒生效，贴合行位置，允许交互） */}
        {hoverPreviewId && hoverPreviewRect ? (() => {
          const paper = displayPapers.find(p => p.id === hoverPreviewId);
          if (!paper || !paper.pdf_url) return null;
          const src = `${apiBase}${paper.pdf_url}#view=FitH,top&toolbar=0&navpanes=0`;
          const W = 880, H = 1000, GAP = 12; // 更大窗口
          // 先尝试放在行右侧，不够空间则放在左侧；再做上下边界裁剪
          const preferRight = (hoverPreviewRect.right + GAP + W) <= window.innerWidth - 8;
          const left = preferRight ? Math.min(window.innerWidth - W - 8, hoverPreviewRect.right + GAP)
                                   : Math.max(8, hoverPreviewRect.left - GAP - W);
          const topRaw = hoverPreviewRect.top;
          const top = Math.min(window.innerHeight - H - 8, Math.max(8, topRaw));
          const style: React.CSSProperties = {
            position: 'fixed', top, left, width: W, height: H, zIndex: 130,
            boxShadow: '0 10px 40px rgba(0,0,0,0.28)', borderRadius: 12, background: 'white',
          };
          return (
            <div
              style={style}
              className="overflow-hidden border bg-white"
              onMouseEnter={() => setHoveringPreview(true)}
              onMouseLeave={() => { setHoveringPreview(false); setTimeout(() => { if (!hoverTimer.current) setHoverPreviewId(null); }, 100); }}
            >
              <iframe src={src} className="w-full h-full" scrolling="auto" />
            </div>
          );
        })() : null}
        </DndContext>
    );
}