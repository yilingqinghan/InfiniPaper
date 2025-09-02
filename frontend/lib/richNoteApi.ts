// frontend/lib/richNoteApi.ts
export type MdNoteRead = { id: number; paper_id: number; content: string };

export async function getByPaper(api: (p: string)=>string, paperId: number): Promise<MdNoteRead | null> {
  const r = await fetch(api(`/api/v1/richnotes/by-paper/${paperId}`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as MdNoteRead | null;
}

export async function upsertByPaper(api: (p: string)=>string, paperId: number, content: string): Promise<MdNoteRead> {
  const r = await fetch(api(`/api/v1/richnotes/by-paper/${paperId}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as MdNoteRead;
}

export function exportMarkdown(api: (p: string)=>string, paperId: number) {
  // 直接打开下载
  window.open(api(`/api/v1/richnotes/by-paper/${paperId}/export`), "_blank");
}