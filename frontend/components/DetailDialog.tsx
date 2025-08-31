
import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
type Paper = {
    id: number; title: string; abstract?: string | null; year?: number | null; venue?: string | null;
    doi?: string | null; pdf_url?: string | null;
    authors?: { id?: number; name?: string; affiliation?: string | null }[];
    tag_ids?: number[];
  };
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

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
export default Detail;