"use client";

import React from "react";

/**
 * 为 Toast UI Editor 挂载代码高亮插件（基于 Prism）。
 * 若依赖未安装，会自动降级为无插件，保证不报错。
 *
 * 需要的依赖：
 *   pnpm add @toast-ui/editor-plugin-code-syntax-highlight prismjs
 */
export function useTuiPlugins() {
  const [plugins, setPlugins] = React.useState<any[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [{ default: codeSyntaxHighlight }, Prism] = await Promise.all([
          import("@toast-ui/editor-plugin-code-syntax-highlight"),
          import("prismjs"),
        ]);

        // 常用语言按需加载（失败也没关系）
        await Promise.all(
          [
            "markup",
            "css",
            "clike",
            "javascript",
            "typescript",
            "jsx",
            "tsx",
            "json",
            "bash",
            "python",
            "markdown",
            "java",
            "c",
            "cpp",
            "go",
            "rust",
            "sql",
            "yaml",
          ].map((lang) =>
            import(
              /* @vite-ignore */ `prismjs/components/prism-${lang}.js`
            ).catch(() => null)
          )
        );

        if (!cancelled) {
          // React Editor 的 plugins 传法与原生一致
          setPlugins([[codeSyntaxHighlight, { highlighter: (Prism as any).default || Prism }]]);
        }
      } catch (e) {
        console.warn("[useTuiPlugins] 未安装代码高亮插件，已降级为空。", e);
        if (!cancelled) setPlugins([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return plugins;
}