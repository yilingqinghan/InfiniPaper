"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";

const GemChatItems: React.FC<{ items: { role: "user" | "assistant"; text: string }[] }> = React.memo(({ items }) => (
  <>
    {items.map((m, i) => (
      <div key={i} className={m.role === "user" ? "text-sm p-2 rounded bg-indigo-50" : "text-sm p-2 rounded bg-gray-50"}>
        <div className="text-[11px] text-gray-500 mb-1">{m.role === "user" ? "你" : "AI"}</div>
        {m.role === "assistant"
          ? <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}>{m.text}</ReactMarkdown></div>
          : <div className="whitespace-pre-wrap">{m.text}</div>}
      </div>
    ))}
  </>
));

export default GemChatItems;