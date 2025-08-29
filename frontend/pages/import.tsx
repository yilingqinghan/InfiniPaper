
import { useState } from "react";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState<number | undefined>(undefined);
  const [venue, setVenue] = useState("");

  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold mb-6">导入 PDF</h1>

      <div className="space-y-4 max-w-3xl">
        <input type="file" accept="application/pdf" multiple onChange={(e)=> setFile(e.target.files?.[0] || null)} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input className="border rounded px-3 py-2" placeholder="标题（可留空）" value={title} onChange={(e)=>setTitle(e.target.value)} />
          <input className="border rounded px-3 py-2" placeholder="年份（可留空）" value={year ?? ""} onChange={(e)=>setYear(e.target.value ? Number(e.target.value) : undefined)} />
          <input className="border rounded px-3 py-2" placeholder="Venue（可留空）" value={venue} onChange={(e)=>setVenue(e.target.value)} />
        </div>

        <button
          className="px-4 py-2 bg-blue-600 text-white rounded"
          onClick={async ()=>{
            const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
            const input = document.querySelector('input[type="file"]') as HTMLInputElement;
            const files = input?.files;
            if (!files || files.length === 0) { alert("请选择 PDF"); return; }

            if (files.length === 1) {
              const fd = new FormData();
              fd.append("file", files[0]);
              if (title) fd.append("title", title);
              if (year) fd.append("year", String(year));
              if (venue) fd.append("venue", venue);
              const res = await fetch(`${apiBase}/api/v1/papers/upload`, { method: "POST", body: fd });
              if (!res.ok) { const text = await res.text(); alert("上传失败: " + text); return; }
              const paper = await res.json();
              window.location.href = `/papers/${paper.id}`;
            } else {
              const fd = new FormData();
              for (let i = 0; i < files.length; i++) fd.append("files", files[i]);
              const res = await fetch(`${apiBase}/api/v1/papers/upload/batch`, { method: "POST", body: fd });
              if (!res.ok) { const text = await res.text(); alert("批量上传失败: " + text); return; }
              const arr = await res.json();
              alert(`批量上传成功: ${arr.length} 篇`);
              window.location.href = "/papers";
            }
          }}
        >上传</button>
      </div>
    </div>
  );
}
