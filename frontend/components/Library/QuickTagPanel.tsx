import React from "react";
import { Tag as TagIcon } from "lucide-react";
import SwalCore from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
const Swal = withReactContent(SwalCore);
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

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
export function getTagColor(name: string) { return loadViz()[name]?.color; }
export function getTagPrio(name: string) { return loadViz()[name]?.prio; }
function setTagColor(name: string, color?: string) { const v = loadViz(); v[name] = { ...(v[name] || {}), color }; saveViz(v); }
function setTagPrio(name: string, prio?: string) { const v = loadViz(); v[name] = { ...(v[name] || {}), prio }; saveViz(v); }


type Paper = {
    id: number; title: string; abstract?: string | null; year?: number | null; venue?: string | null;
    doi?: string | null; pdf_url?: string | null;
    authors?: { id?: number; name?: string; affiliation?: string | null }[];
    tag_ids?: number[];
  };
  type Tag = { id: number; name: string; color?: string | null };

// 特殊标签：开源（深色底、白字）
const OPEN_SOURCE_TAGS = new Set(["开源", "Open Source"]);
export function isOpenSourceTag(name: string) { return OPEN_SOURCE_TAGS.has(name.trim()); }
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
        : "rounded-2xl border bg-white h-full flex flex-col overflow-hidden  max-h-[350px]";
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
export { QuickTagPanel };