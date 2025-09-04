import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronUp, BookOpen, ExternalLink, Loader2 } from "lucide-react";

// --- Small fetch helper (JSON) ---
async function j<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

// --- Types ---
export type Paper = {
  id: number;
  title: string;
  year?: number | null;
  venue?: string | null;
  pdf_url?: string | null;
  authors?: { name?: string }[];
};

type NoteSections = {
  innovation: string;
  motivation: string;
  method: string;
  tools: string;
  limits: string;
};

const NOTE_SECTIONS = [
  { key: "innovation", label: "创新点" },
  { key: "motivation", label: "动机" },
  { key: "method", label: "方法简述" },
  { key: "tools", label: "工具+平台" },
  { key: "limits", label: "局限性" },
] as const;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseStructuredNote(raw: string): NoteSections {
  const result: NoteSections = { innovation: "", motivation: "", method: "", tools: "", limits: "" };
  if (!raw) return result;
  const text = raw.replace(/\r\n?/g, "\n");
  const labelGroup = NOTE_SECTIONS.map(s => escapeRegExp(s.label)).join("|");
  const headingRe = new RegExp(`^\n?\s*(${labelGroup})\s*[：:]\s*`, "gm");
  const hits: Array<{ label: string; start: number; endOfHeading: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text)) !== null) {
    hits.push({ label: m[1], start: m.index, endOfHeading: headingRe.lastIndex });
  }
  if (hits.length === 0) { result.method = text.trim(); return result; }
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const nextStart = i + 1 < hits.length ? hits[i+1].start : text.length;
    const content = text.slice(cur.endOfHeading, nextStart).trim();
    const entry = NOTE_SECTIONS.find(s => s.label === cur.label);
    if (entry) (result as any)[entry.key] = content;
  }
  return result;
}

function buildStructuredNote(sections: NoteSections): string {
  return NOTE_SECTIONS.map(s => `${s.label}：${(sections as any)[s.key] || ""}`).join("\n\n");
}

// Lazy fetch a note only when needed
async function fetchNoteContent(paperId: number): Promise<string> {
  const url = `${apiBase}/api/v1/papers/${paperId}/note`;
  const res = await fetch(url);
  if (!res.ok) return "";
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const data: any = await res.json();
    return (
      data?.content ?? data?.note ?? data?.data?.content ?? data?.data?.note ?? ""
    ) as string;
  }
  return (await res.text()) ?? "";
}

// Intersection observer hook for lazy work
function useInView(opts?: IntersectionObserverInit) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver(([e]) => setInView(!!e.isIntersecting), opts);
    io.observe(el);
    return () => io.disconnect();
  }, [opts?.root, opts?.rootMargin, opts?.threshold]);
  return { ref, inView } as const;
}

// Small util for truncation
function clip(s: string, n = 160) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Card component
function NoteCard({
  paper,
  index,
  onExpand,
  expanded,
}: {
  paper: Paper;
  index: number;
  onExpand: (id: number | null) => void;
  expanded: boolean;
}) {
  const prefersReduced = useReducedMotion();
  const { ref, inView } = useInView({ rootMargin: "200px" });
  const [loading, setLoading] = React.useState(false);
  const [sections, setSections] = React.useState<NoteSections>({ innovation: "", motivation: "", method: "", tools: "", limits: "" });
  const [loaded, setLoaded] = React.useState(false);

  // Lazy load note only when the card is visible or expanded
  React.useEffect(() => {
    let alive = true;
    if ((inView || expanded) && !loaded) {
      setLoading(true);
      fetchNoteContent(paper.id)
        .then((raw) => { if (!alive) return; setSections(parseStructuredNote(raw)); setLoaded(true); })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false); });
    }
    return () => { alive = false; };
  }, [inView, expanded, loaded, paper.id]);

  const depth = Math.max(0, 8 - index); // top ~8 cards get depth, rest flat
  const collapsedStyles = {
    zIndex: 100 - index,
    transform: `translateY(${index * -12}px) translateZ(${depth * -12}px)`
  } as React.CSSProperties;

  const shadow = prefersReduced ? "0 2px 12px rgba(0,0,0,0.08)" : "0 10px 30px rgba(0,0,0,0.18)";

  return (
    <motion.div
      ref={ref}
      layoutId={`paper-${paper.id}`}
      className="relative w-full"
      style={{ perspective: 1000 }}
      onClick={() => onExpand(expanded ? null : paper.id)}
    >
      <motion.div
        className="rounded-2xl bg-white border overflow-hidden select-none"
        initial={false}
        animate={expanded ? {
          rotateX: prefersReduced ? 0 : 0,
          rotateY: prefersReduced ? 0 : 0,
          y: 0,
          x: 0,
          scale: 1,
          boxShadow: shadow,
          width: 'min(820px, 92vw)',
          height: 'min(560px, 72vh)'
        } : {
          rotateX: prefersReduced ? 0 : -2,
          rotateY: prefersReduced ? 0 : 3,
          scale: 1,
          boxShadow: shadow,
          width: 'min(620px, 92vw)',
          height: 180,
          ...collapsedStyles,
        }}
        transition={{ type: "spring", stiffness: 160, damping: 20 }}
        style={{ willChange: "transform" }}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b bg-gradient-to-r from-slate-50 to-slate-100 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-sky-600" />
          <div className="text-sm font-medium line-clamp-1">{paper.title}</div>
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            {paper.venue && <span>{paper.venue}</span>}
            {paper.year && <span>· {paper.year}</span>}
            <motion.span layout>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </motion.span>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 h-full overflow-hidden">
          <div className={`grid ${expanded ? 'grid-cols-2 gap-4 h-full' : 'grid-cols-1'} `}>
            {/* Left column: brief */}
            <div className={`${expanded ? 'overflow-auto pr-1' : ''}`}>
              {!loaded && (
                <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> 正在加载笔记…</div>
              )}
              {loaded && (
                <div className="space-y-3 text-sm leading-6 text-slate-800">
                  {NOTE_SECTIONS.map(s => (
                    <div key={s.key}>
                      <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">{s.label}</div>
                      <div className={`rounded-lg border px-3 py-2 ${expanded ? 'bg-white' : 'bg-slate-50'}`}>
                        {clip((sections as any)[s.key], expanded ? 380 : 140) || <span className="text-slate-400">（无）</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right column: actions / preview */}
            {expanded && (
              <div className="flex flex-col h-full">
                <div className="text-xs text-slate-500 mb-2">快速操作</div>
                <div className="flex flex-wrap gap-2">
                  {paper.pdf_url && (
                    <a
                      href={`/reader/${paper.id}?pdf=${encodeURIComponent(paper.pdf_url)}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border hover:bg-slate-50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      打开阅读器 <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    className="text-xs px-3 py-1.5 rounded-lg border hover:bg-slate-50"
                    onClick={(e) => { e.stopPropagation(); const text = buildStructuredNote(sections); navigator.clipboard?.writeText(text).catch(()=>{}); }}
                  >复制笔记</button>
                </div>

                <div className="mt-4 text-xs text-slate-500">作者</div>
                <div className="text-sm text-slate-800 line-clamp-5">{paper.authors?.map(a => a?.name).filter(Boolean).join(', ') || '未知'}</div>
                <div className="mt-auto"></div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Main page widget
export default function PaperNoteCards({ papers: initialPapers }: { papers?: Paper[] }) {
  const prefersReduced = useReducedMotion();
  const [papers, setPapers] = React.useState<Paper[]>(initialPapers || []);
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [limit, setLimit] = React.useState(12); // keep small for performance

  // Optional: fetch a default list when not provided
  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (initialPapers?.length) return;
      try {
        const data = await j<Paper[]>(`${apiBase}/api/v1/papers?limit=30`);
        if (alive) setPapers(data || []);
      } catch {
        // ignore
      }
    })();
    return () => { alive = false; };
  }, [initialPapers]);

  const visible = React.useMemo(() => papers.slice(0, limit), [papers, limit]);

  return (
    <div className="w-full flex justify-center">
      <div className="w-full max-w-[980px]">
        {/* Toolbar */}
        <div className="mb-3 flex items-center gap-2">
          <div className="text-sm text-slate-600">3D 笔记卡片（轻量模式）</div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <label className="text-slate-500">显示数量</label>
            <select
              className="border rounded-md px-2 py-1"
              value={limit}
              onChange={(e) => setLimit(Math.max(4, Math.min(24, Number(e.target.value) || 12)))}
            >
              {[6, 8, 10, 12, 16, 20].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        {/* Stack container */}
        <div className="relative flex flex-col items-center" style={{ perspective: 1200 }}>
          <AnimatePresence initial={false}>
            {visible.map((p, i) => (
              <NoteCard
                key={p.id}
                paper={p}
                index={i}
                expanded={expandedId === p.id}
                onExpand={(id) => setExpandedId(id)}
              />
            ))}
          </AnimatePresence>
        </div>

        {prefersReduced && (
          <div className="mt-2 text-xs text-slate-500">* 检测到系统“减少动态效果”，动画已尽量简化。</div>
        )}
      </div>
    </div>
  );
}
