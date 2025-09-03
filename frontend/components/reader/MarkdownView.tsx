"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import { remarkCiteAnchorsAndLinks } from "@/components/Reading/MarkdownDecor";

// 稳定 key 用（避免大段 markdown 频繁重排）
function hash32(str: string) {
  let h = (2166136261 >>> 0) as number;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

type Props = {
  html: string | null;
  md: string | null;
  assetsBase: string | null;
  cacheKey: string | null;
  mdBase: string | null;
  mdRel: string | null;
  apiBase: string;
};

const MarkdownView: React.FC<Props> = ({
  html,
  md,
  assetsBase,
  cacheKey,
  mdBase,
  mdRel,
  apiBase,
}) => {
  if (html) {
    return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (md) {
    const componentsMap: any = {
      a: ({ node, href, className, ...props }: any) => {
        const cls = (className || "").toString();
        const isCite =
          cls.includes("cite-link") ||
          (typeof href === "string" && href.startsWith("#ref-"));
        if (isCite) {
          return React.createElement(
            "a",
            {
              href,
              className,
              onClick: (e: any) => {
                try {
                  if (!href) return;
                  if ((href as string).startsWith("#")) {
                    e.preventDefault();
                    const id = (href as string).slice(1);
                    const el = document.getElementById(id);
                    if (el) {
                      el.scrollIntoView({ block: "start", behavior: "smooth" });
                      if ((history as any)?.replaceState) (history as any).replaceState(null, "", href as string);
                    }
                  }
                } catch {}
              },
              ...props,
            },
            props.children
          );
        }
        return React.createElement(
          "a",
          { href, className, target: "_blank", rel: "noreferrer", ...props },
          props.children
        );
      },
      table: ({ node, ...props }: any) =>
        React.createElement(
          "div",
          { className: "md-table" },
          React.createElement("table", { ...props })
        ),
      img: ({ node, src = "", alt, ...props }: any) => {
        let finalSrc: string = src;
        if (!/^https?:\/\//i.test(finalSrc)) {
          const base = assetsBase || (cacheKey ? `${apiBase}/api/v1/mineru/assets/${cacheKey}` : "");
          if (base) {
            const relBase = (mdBase || mdRel || "").replace(/^\/+|\/+$/g, "");
            const prefix = relBase
              ? `${base.replace(/\/+$/, "")}/${relBase}/`
              : `${base.replace(/\/+$/, "")}/`;
            try {
              finalSrc = new URL(finalSrc.replace(/^\/+/, ""), prefix).toString();
            } catch {
              finalSrc = `${prefix}${finalSrc.replace(/^\/+/, "")}`;
            }
          }
        }
        const caption = typeof alt === "string" ? (alt as string).trim() : "";
        return React.createElement(
          "figure",
          null,
          React.createElement("img", { src: finalSrc, alt: caption, ...props }),
          caption ? React.createElement("figcaption", null, caption) : null
        );
      },
    };

    return React.createElement(
      "article",
      { key: `md-${hash32(md)}`, className: "markdown-body" },
      React.createElement(
        ReactMarkdown as any,
        {
          remarkPlugins: [remarkGfm as any, remarkMath as any, remarkCiteAnchorsAndLinks as any],
          rehypePlugins: [rehypeKatex as any, rehypeHighlight as any, rehypeRaw as any],
          components: componentsMap,
        },
        md
      )
    );
  }
  return null;
};

export default MarkdownView;