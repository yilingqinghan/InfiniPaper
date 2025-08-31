import * as Dialog from "@radix-ui/react-dialog";
import React from "react";

export default function PaperDetailDialog({
  openId,
  onClose,
  onChanged,
}: {
  openId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
  const [data, setData] = React.useState<any | null>(null);

  React.useEffect(() => {
    let abort = false;
    async function run() {
      if (!openId) return;
      const r = await fetch(`${apiBase}/api/v1/papers/${openId}`);
      if (!abort) setData(r.ok ? await r.json() : null);
    }
    run();
    return () => { abort = true; };
  }, [openId, apiBase]);

  const del = async () => {
    if (!openId) return;
    const ok = confirm("确定删除这篇论文吗？");
    if (!ok) return;
    const r = await fetch(`${apiBase}/api/v1/papers/${openId}`, { method: "DELETE" });
    if (r.ok) { onChanged?.(); onClose(); } else { alert("删除失败"); }
  };

  return (
    <Dialog.Root open={!!openId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] max-w-[95vw] max-h-[85vh] overflow-auto rounded-2xl bg-white p-6 shadow-xl">
          {!data ? (
            <div className="text-sm text-gray-500">加载中…</div>
          ) : (
            <div className="space-y-3">
              <Dialog.Title className="text-lg font-semibold leading-snug">{data.title}</Dialog.Title>
              <div className="text-xs text-gray-500">
                {(data.venue || "未知 venue")} · {(data.year || "年份未知")}
                {data.doi ? <> · DOI: <a className="underline" href={`https://doi.org/${data.doi}`} target="_blank">{data.doi}</a></> : null}
              </div>
              {Array.isArray(data.authors) && data.authors.length > 0 && (
                <div className="text-sm text-gray-700">
                  {data.authors.map((a: any, i: number) => (
                    <span key={i} className="mr-2">
                      {a.name}{a.affiliation ? <span className="text-gray-500">（{a.affiliation}）</span> : null}{i < data.authors.length - 1 ? "，" : ""}
                    </span>
                  ))}
                </div>
              )}
              {data.abstract && <p className="text-sm text-gray-700 whitespace-pre-wrap">{data.abstract}</p>}
              <div className="flex items-center gap-2 pt-2">
                {data.pdf_url && (
                  <a href={data.pdf_url} target="_blank" className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50">查看PDF</a>
                )}
                <button onClick={del} className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50">删除</button>
                <div className="ml-auto">
                  <Dialog.Close className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50">关闭</Dialog.Close>
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
