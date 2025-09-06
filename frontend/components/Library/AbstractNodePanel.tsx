import React from "react";
import withReactContent from "sweetalert2-react-content";
import SwalCore from "sweetalert2";
const Swal = withReactContent(SwalCore);

// 简单的 fetch 封装，返回 JSON，非 2xx 会 throw
async function j<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const NOTE_SECTIONS = [
  { key: "innovation", label: "创新点" },
  { key: "motivation", label: "动机" },
  { key: "method", label: "方法简述" },
  { key: "tools", label: "工具+平台" },
  { key: "limits", label: "局限性" },
] as const;

type NoteSections = {
  innovation: string;
  motivation: string;
  method: string;
  tools: string;
  limits: string;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseStructuredNote(raw: string): NoteSections {
  const result: NoteSections = {
    innovation: "",
    motivation: "",
    method: "",
    tools: "",
    limits: "",
  };
  if (!raw) return result;

  // Normalize line breaks: CRLF/CR -> LF
  const text = raw.replace(/\r\n?/g, "\n");

  // Build a single-line matcher for label lines
  const labelGroup = NOTE_SECTIONS.map(s => escapeRegExp(s.label)).join("|");
  const headingRe = new RegExp(`^\n?\s*(${labelGroup})\s*[：:]\s*`, "gm");

  // Find all headings with their start offsets
  const hits: Array<{ label: string; start: number; endOfHeading: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text)) !== null) {
    const label = m[1];
    const endOfHeading = headingRe.lastIndex; // content starts here
    const start = m.index;
    hits.push({ label, start, endOfHeading });
  }

  if (hits.length === 0) {
    // No headings detected; put everything into 方法简述 作为回退
    result.method = text.trim();
    return result;
  }

  // Walk headings and slice content between them
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const nextStart = (i + 1 < hits.length) ? hits[i + 1].start : text.length;
    const content = text.slice(cur.endOfHeading, nextStart).trim();
    const entry = NOTE_SECTIONS.find(s => s.label === cur.label);
    if (entry) {
      (result as any)[entry.key] = content;
    }
  }

  return result;
}

function buildStructuredNote(sections: NoteSections): string {
  return NOTE_SECTIONS
    .map(s => `${s.label}：${(sections as any)[s.key] || ""}`)
    .join("\n\n");
}

// 轻量日志工具
const dbg = (...args: any[]) => { try { console.debug('[AbstractNotePanel]', ...args); } catch {} };

async function fetchNoteContent(paperId: number): Promise<string> {
  const url = `${apiBase}/api/v1/papers/${paperId}/note`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET note failed: ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data: any = await res.json();
      // 兼容多种返回结构：{content}, {note}, {data:{content}}
      const v = data?.content ?? data?.note ?? data?.data?.content ?? data?.data?.note;
      return typeof v === 'string' ? v : '';
    } else {
      // 兼容 text/plain
      const text = await res.text();
      return text ?? '';
    }
  } catch (e) {
    dbg('fetchNoteContent error', e);
    return '';
  }
}

type Paper = {
    id: number; title: string; abstract?: string | null; year?: number | null; venue?: string | null;
    doi?: string | null; pdf_url?: string | null;
    authors?: { id?: number; name?: string; affiliation?: string | null }[];
    tag_ids?: number[];
  };
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
function AbstractNotePanel({ paper }: { paper: Paper | null }) {
    const [note, setNote] = React.useState("");
    const [editingAbs, setEditingAbs] = React.useState(false);
    const [sections, setSections] = React.useState<NoteSections>({
      innovation: "",
      motivation: "",
      method: "",
      tools: "",
      limits: "",
    });
    const [absDraft, setAbsDraft] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
    const [open, setOpen] = React.useState(true);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const [maxH, setMaxH] = React.useState(0);
  
    React.useEffect(() => {
      if (!paper) {
        setNote(""); setAbsDraft(""); setEditingAbs(false);
        setSections({ innovation: "", motivation: "", method: "", tools: "", limits: "" });
        return;
      }
      setAbsDraft(paper.abstract || "");
      let alive = true; // 防止快速切换论文导致后到的请求覆盖现有内容
      (async () => {
        try {
          dbg('fetch note for paper', paper.id);
          const raw = await fetchNoteContent(paper.id);
          if (!alive) return;
          setNote(raw);
          setSections(parseStructuredNote(raw));
        } catch (e) {
          dbg('fetch note failed', e);
          if (!alive) return;
          setNote('');
          setSections({ innovation: '', motivation: '', method: '', tools: '', limits: '' });
        }
      })();
      return () => { alive = false; };
    }, [paper?.id]);
  
    // 根据展开状态与内容动态计算高度，提供平滑折叠/展开动画
    React.useLayoutEffect(() => {
      const el = contentRef.current;
      if (!el) return;
      if (open) {
        setMaxH(el.scrollHeight);
      } else {
        setMaxH(0);
      }
    }, [open, sections, absDraft, editingAbs]);

    // 监听内容尺寸变化（例如用户输入时）以更新展开时的高度
    React.useEffect(() => {
      const el = contentRef.current;
      if (!el || !open) return;
      let ro: ResizeObserver | null = null;
      try {
        ro = new ResizeObserver(() => {
          setMaxH(el.scrollHeight);
        });
        ro.observe(el);
      } catch {}
      return () => {
        try { ro && ro.disconnect(); } catch {}
      };
    }, [open]);
  
    return (
      <div className="rounded-2xl border bg-white overflow-hidden">
        <button
          type="button"
          className="w-full px-3 py-2 border-b bg-gradient-to-r from-amber-50 to-yellow-50 text-sm font-medium flex items-center justify-between"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls="abs-note-panel"
        >
          <span>摘要 / 笔记</span>
          <svg
            className={`h-4 w-4 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <div
          id="abs-note-panel"
          ref={contentRef}
          style={{ maxHeight: maxH, transition: 'max-height 300ms ease', overflow: 'hidden' }}
        >
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
              <div className="text-xs text-gray-500 mb-1">笔记（已拆分为模块）</div>
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-gray-500 mb-1">创新点</div>
                  <textarea
                    value={sections.innovation}
                    onChange={e => setSections(s => ({ ...s, innovation: e.target.value }))}
                    className="w-full text-sm border rounded-md p-2"
                    rows={3}
                    placeholder="这篇工作的关键创新…"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">动机</div>
                  <textarea
                    value={sections.motivation}
                    onChange={e => setSections(s => ({ ...s, motivation: e.target.value }))}
                    className="w-full text-sm border rounded-md p-2"
                    rows={3}
                    placeholder="为什么要做这件事…"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">方法简述</div>
                  <textarea
                    value={sections.method}
                    onChange={e => setSections(s => ({ ...s, method: e.target.value }))}
                    className="w-full text-sm border rounded-md p-2"
                    rows={4}
                    placeholder="核心方法/框架/流程…"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">工具+平台</div>
                  <textarea
                    value={sections.tools}
                    onChange={e => setSections(s => ({ ...s, tools: e.target.value }))}
                    className="w-full text-sm border rounded-md p-2"
                    rows={3}
                    placeholder="代码库、模型、数据、算力/云平台等…"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">局限性</div>
                  <textarea
                    value={sections.limits}
                    onChange={e => setSections(s => ({ ...s, limits: e.target.value }))}
                    className="w-full text-sm border rounded-md p-2"
                    rows={3}
                    placeholder="适用范围、失败案例、未来工作…"
                  />
                </div>
              </div>

              {/* 预览（解析显示自动映射） */}
              <div className="mt-3 p-2 bg-gray-50 rounded-md">
                <div className="text-xs text-gray-500 mb-1">预览</div>
                <div className="text-sm leading-6 text-gray-800 whitespace-pre-wrap">
                  {buildStructuredNote(sections)}
                </div>
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  className="text-xs px-2 py-1 rounded border bg-green-50 disabled:opacity-60"
                  disabled={saving}
                  onClick={async () => {
                    if (!paper) return;
                    const payload = buildStructuredNote(sections);
                    setSaving(true);
                    dbg('saving note for paper', paper.id, payload);
                    try {
                      // 优先 PUT 更新；若失败再尝试 POST（兼容后端可能的语义差异）
                      try {
                        await j(`${apiBase}/api/v1/papers/${paper.id}/note`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ content: payload, note: payload })
                        });
                      } catch (e: any) {
                        dbg('PUT failed, try POST', e);
                        await j(`${apiBase}/api/v1/papers/${paper.id}/note`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ content: payload, note: payload })
                        });
                      }
                      setNote(payload);
                      setLastSavedAt(Date.now());
                      // 保存后立刻拉取一次，确认确实持久化（避免你切换论文回来丢失）
                      try {
                        const serverRaw = await fetchNoteContent(paper.id);
                        if (serverRaw !== payload) {
                          dbg('post-save verify mismatch, server returned different content');
                          console.warn('[AbstractNotePanel] Post-save verify mismatch', { local: payload, server: serverRaw });
                        }
                      } catch (e) {
                        dbg('post-save verify fetch failed', e);
                      }
                      Swal.fire({ toast: true, icon: "success", title: "笔记已保存", timer: 1000, showConfirmButton: false, position: "top" });
                    } catch (e: any) {
                      console.error('[AbstractNotePanel] save error', e);
                      Swal.fire({ icon: "error", title: "保存失败", text: String(e?.message || e) });
                    } finally {
                      setSaving(false);
                    }
                  }}
                >{saving ? '保存中…' : '保存笔记'}</button>
                <button
                  className="text-xs px-2 py-1 rounded border"
                  onClick={() => { dbg('re-parse from saved note for paper', paper?.id); setSections(parseStructuredNote(note)); }}
                >从已保存笔记解析</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  export default AbstractNotePanel;