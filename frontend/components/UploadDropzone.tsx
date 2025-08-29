import React from "react";
import { motion } from "framer-motion";

export default function UploadDropzone({
  onUploaded,
  className = "",
  children,
}: {
  onUploaded?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

  const [drag, setDrag] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  const doUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setProgress(8);
    try {
      // 单/多文件自动选择接口
      if (files.length === 1) {
        const fd = new FormData();
        fd.append("file", files[0]);
        const r = await fetch(`${apiBase}/api/v1/papers/upload`, {
          method: "POST",
          body: fd,
        });
        setProgress(70);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await r.json();
      } else {
        const fd = new FormData();
        Array.from(files).forEach((f) => fd.append("files", f));
        const r = await fetch(`${apiBase}/api/v1/papers/upload/batch`, {
          method: "POST",
          body: fd,
        });
        setProgress(70);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await r.json();
      }
      setProgress(100);
      onUploaded?.();
    } catch (e) {
      alert("上传失败");
    } finally {
      setTimeout(() => {
        setBusy(false);
        setProgress(0);
      }, 400);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        doUpload(e.dataTransfer.files);
      }}
      className={`${className} relative cursor-pointer select-none`}
      onClick={() => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = ".pdf";
        input.onchange = () => doUpload(input.files);
        input.click();
      }}
    >
      <motion.div
        animate={{ scale: drag ? 1.02 : 1 }}
        className="min-h-[120px] flex flex-col items-start justify-center gap-1"
      >
        {children}
      </motion.div>

      {busy ? (
        <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-xl">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}