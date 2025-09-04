import React from "react";
import withReactContent from "sweetalert2-react-content";
import SwalCore from "sweetalert2";
const Swal = withReactContent(SwalCore);

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

function parseStructuredNote(raw: string): NoteSections {
  const result: NoteSections = {
    innovation: "",
    motivation: "",
    method: "",
    tools: "",
    limits: "",
  };
  if (!raw) return result;

  // Build a regex that captures each labeled section until the next label or end.
  // Accept both Chinese colon `：` and ASCII `:` after labels.
  const labelGroup = NOTE_SECTIONS.map(s => s.label).join("|");
  const re = new RegExp(`(?:^|\n)\s*((${labelGroup}))\s*[：:]\s*([\s\S]*?)(?=(?:\n\s*(?:${labelGroup})\s*[：:]|$))`, "g");
  let matched = false;
  for (const m of raw.matchAll(re)) {
    matched = true;
    const label = m[1];
    const content = m[3].trim();
    const entry = NOTE_SECTIONS.find(s => s.label === label);
    if (entry) {
      (result as any)[entry.key] = content;
    }
  }
  // If no labeled sections were found, put the whole note into “方法简述”作为回退
  if (!matched) {
    result.method = raw.trim();
  }
  return result;
}

function buildStructuredNote(sections: NoteSections): string {
  return NOTE_SECTIONS
    .map(s => `${s.label}：${(sections as any)[s.key] || ""}`)
    .join("\n\n");
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
  
    React.useEffect(() => {
      if (!paper) { setNote(""); setAbsDraft(""); setEditingAbs(false); return; }
      setAbsDraft(paper.abstract || "");
      (async () => {
        try {
          const r = await j<{ paper_id: number; content: string }>(`${apiBase}/api/v1/papers/${paper.id}/note`);
          const raw = r?.content || "";
          setNote(raw);
          setSections(parseStructuredNote(raw));
        } catch {
          setNote("");
          setSections({ innovation: "", motivation: "", method: "", tools: "", limits: "" });
        }
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
                className="text-xs px-2 py-1 rounded border bg-green-50"
                onClick={async () => {
                  if (!paper) return;
                  const payload = buildStructuredNote(sections);
                  setNote(payload);
                  await j(`${apiBase}/api/v1/papers/${paper.id}/note`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: payload }),
                  });
                  Swal.fire({ toast: true, icon: "success", title: "笔记已保存", timer: 1000, showConfirmButton: false, position: "top" });
                }}
              >保存笔记</button>
              <button
                className="text-xs px-2 py-1 rounded border"
                onClick={() => setSections(parseStructuredNote(note))}
              >从已保存笔记解析</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  export default AbstractNotePanel;