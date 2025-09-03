"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import { remarkCiteAnchorsAndLinks } from "@/components/Reading/MarkdownDecor";

type Props = {
  html: string | null;
  md: string | null;
  assetsBase: string | null;
  cacheKey: string | null;
  mdBase: string | null;
  mdRel: string | null;
  apiBase: string | null;
};

export default function MarkdownPane({
  html, md, assetsBase, cacheKey, mdBase, mdRel, apiBase
}: Props) {
  if (html) {
    return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (!md) return null;

  return (
    <article className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkCiteAnchorsAndLinks]}
        rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeRaw as any]}
        components={{
          a: ({ node, href, className, ...props }) => {
            const cls = (className || "").toString();
            const isCite = cls.includes("cite-link") || (typeof href === "string" && href.startsWith("#ref-"));
            if (isCite) {
              return (
                <a
                  href={href}
                  className={className}
                  onClick={(e) => {
                    try {
                      if (!href) return;
                      if (href.startsWith("#")) {
                        e.preventDefault();
                        const id = href.slice(1);
                        const el = document.getElementById(id);
                        if (el) {
                          el.scrollIntoView({ block: "start", behavior: "smooth" });
                          if (history?.replaceState) history.replaceState(null, "", href);
                        }
                      }
                    } catch {}
                  }}
                  {...props}
                />
              );
            }
            return <a href={href} className={className} target="_blank" rel="noreferrer" {...props} />;
          },
          table: ({ node, ...props }) => (
            <div className="md-table"><table {...props} /></div>
          ),
          img: ({ node, src = "", alt, ...props }) => {
            let finalSrc = src;
            if (!/^https?:\/\//i.test(finalSrc)) {
              const base = assetsBase || (cacheKey ? `${apiBase}/api/v1/mineru/assets/${cacheKey}` : "");
              if (base) {
                const relBase = (mdBase || mdRel || "").replace(/^\/+|\/+$/g, "");
                const prefix = relBase ? `${base.replace(/\/+$/, "")}/${relBase}/` : `${base.replace(/\/+$/, "")}/`;
                try { finalSrc = new URL(finalSrc.replace(/^\/+/, ""), prefix).toString(); }
                catch { finalSrc = `${prefix}${finalSrc.replace(/^\/+/, "")}`; }
              }
            }
            const caption = typeof alt === "string" ? alt.trim() : "";
            return (
              <figure>
                <img src={finalSrc} alt={caption} {...props} />
                {caption ? <figcaption>{caption}</figcaption> : null}
              </figure>
            );
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </article>
  );
}