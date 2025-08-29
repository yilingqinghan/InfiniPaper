import React from "react";

export default function UploadDropzone({
  children,
  className="",
  onUploaded,
  folderId,
}: {
  children?: React.ReactNode;
  className?: string;
  onUploaded?: () => void;
  folderId?: number | null;
}) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
  const ref = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      if (files.length > 1) {
        const fd = new FormData();
        Array.from(files).forEach(f => fd.append("files", f));
        await fetch(`${apiBase}/api/v1/papers/upload/batch`, { method: "POST", body: fd });
      } else {
        const fd = new FormData();
        fd.append("file", files[0]);
        if (folderId != null) fd.append("tag_ids", JSON.stringify([folderId]));
        await fetch(`${apiBase}/api/v1/papers/upload`, { method: "POST", body: fd });
      }
    } finally { onUploaded?.(); }
  };

  return (
    <div
      className={`${className} ${drag ? "ring-2 ring-blue-400" : ""}`}
      onDragOver={(e)=>{e.preventDefault(); setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={(e)=>{e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files);}}
      onClick={()=>ref.current?.click()}
    >
      <input ref={ref} type="file" multiple className="hidden" onChange={(e)=>onFiles(e.target.files)}/>
      {children}
    </div>
  );
}
