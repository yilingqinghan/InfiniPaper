
/* -------------------- Markdown修饰（作者块/参考文献锚点） -------------------- */
export function decorateAuthorBlock(md: string): string {
  try {
    const lines = md.split(/\r?\n/);
    const looksLikeAuthorBlock = (arr: string[]) => {
      if (!arr.length) return false;
      const text = arr.join(" ");
      const hasAff = /(University|Institute|Laboratory|College|School|Department|Faculty)/i.test(text);
      const hasCommaNames = arr.some((l) => /,\s*[A-Z]/.test(l));
      const manyShortLines = arr.length >= 2 && arr.length <= 20;
      return (hasAff || hasCommaNames) && manyShortLines;
    };

    const candidates: Array<{ start: number; end: number }> = [];
    { // 顶部块
      let i = 0;
      while (i < lines.length && !lines[i].trim()) i++;
      const start = i;
      let end = i;
      for (; end < lines.length; end++) {
        const ln = lines[end];
        if (!ln.trim()) break;
        if (/^\s*#/.test(ln)) break;
      }
      if (end > start) candidates.push({ start, end });
    }

    const hIdx = lines.findIndex((l) => /^\s*#{1,2}\s+/.test(l));
    if (hIdx >= 0) { // 标题后块
      let i = hIdx + 1;
      let blanks = 0;
      while (i < lines.length && blanks < 3 && !lines[i].trim()) { i++; blanks++; }
      const start = i;
      let end = i;
      for (; end < lines.length; end++) {
        const ln = lines[end];
        if (!ln.trim()) break;
        if (/^\s*#/.test(ln)) break;
      }
      if (end > start) candidates.push({ start, end });
    }

    for (const { start, end } of candidates) {
      const slice = lines.slice(start, end);
      if (!looksLikeAuthorBlock(slice)) continue;
      const before = lines.slice(0, start).join("\n");
      const after = lines.slice(end).join("\n");
      const inner = slice.map((t) => `<p>${t.trim()}</p>`).join("\n");
      return `${before}\n<div class="author-block">\n${inner}\n</div>\n\n<hr class="body-hr"/>\n${after}`.trim();
    }
  } catch {}
  return md;
}

export function remarkCiteAnchorsAndLinks() {
  return (tree: any) => {
    const nodeText = (node: any): string => {
      if (!node) return "";
      if (typeof node.value === "string") return node.value;
      if (Array.isArray(node.children)) return node.children.map(nodeText).join("");
      return "";
    };
    const isSkippable = (node: any) => node && (node.type === "link" || node.type === "inlineCode" || node.type === "code");

    let inRefs = false;
    let refDepth = 0;

    const walk = (node: any, parent: any = null) => {
      if (!node) return;

      if (node.type === "heading") {
        const text = nodeText(node).trim();
        const isRef = /^(references?|bibliography)$/i.test(text);
        if (isRef) { inRefs = true; refDepth = node.depth || 1; }
        else if (inRefs && (node.depth || 1) <= refDepth) inRefs = false;
      }

      if (inRefs && (node.type === "paragraph" || node.type === "listItem")) {
        const children = Array.isArray(node.children) ? node.children : [];
        for (let ci = 0; ci < children.length; ci++) {
          const ch = children[ci];
          if (!ch || ch.type !== "text") continue;
          const value: string = ch.value || "";
          const parts: any[] = [];
          let last = 0;
          const rx = /\[(\d+)\]/g;
          let m: RegExpExecArray | null;
          while ((m = rx.exec(value))) {
            const idx = m.index, num = m[1];
            if (idx > last) parts.push({ type: "text", value: value.slice(last, idx) });
            parts.push({ type: "html", value: `<span id="ref-${num}" class="ref-anchor"></span>` });
            parts.push({ type: "text", value: m[0] });
            last = idx + m[0].length;
          }
          if (parts.length) {
            if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
            children.splice(ci, 1, ...parts);
            ci += parts.length - 1;
          }
        }
      }

      if (!inRefs && !isSkippable(node) && node.type === "text" && parent && Array.isArray(parent.children)) {
        const value: string = node.value || "";
        const parts: any[] = [];
        let last = 0;
        const rx = /\[(\d+)\]/g;
        let m: RegExpExecArray | null;
        while ((m = rx.exec(value))) {
          const idx = m.index, num = m[1];
          if (idx > last) parts.push({ type: "text", value: value.slice(last, idx) });
          parts.push({ type: "link", url: `#ref-${num}`, data: { hProperties: { className: "cite-link" } }, children: [{ type: "text", value: `[${num}]` }] });
          last = idx + m[0].length;
        }
        if (parts.length) {
          if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
          const idx = parent.children.indexOf(node);
          parent.children.splice(idx, 1, ...parts);
          return;
        }
      }

      if (Array.isArray(node.children)) {
        const copy = [...node.children];
        for (const child of copy) walk(child, node);
      }
    };

    walk(tree, null);
  };
}