import React from "react";
import withReactContent from "sweetalert2-react-content";
import SwalCore from "sweetalert2";
const Swal = withReactContent(SwalCore);
type Paper = {
    id: number; title: string; abstract?: string | null; year?: number | null; venue?: string | null;
    doi?: string | null; pdf_url?: string | null;
    authors?: { id?: number; name?: string; affiliation?: string | null }[];
    tag_ids?: number[];
  };
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
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
  export default AbstractNotePanel;