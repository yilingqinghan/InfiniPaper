/* -------------------- 选择映射 & 高亮工具 -------------------- */
function getLinearTextAndMap(container: HTMLElement) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const segments: { node: Text; start: number; end: number }[] = [];
    let text = "";
    let off = 0;
    let n: any;
    while ((n = walker.nextNode())) {
      const t = (n as Text).nodeValue || "";
      const start = off;
      const end = start + t.length;
      segments.push({ node: n as Text, start, end });
      text += t;
      off = end;
    }
    return { text, segments };
  }
  
  export function selectionToOffsets(container: HTMLElement) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  
    const { text, segments } = getLinearTextAndMap(container);
  
    const toPos = (node: Node, nodeOffset: number) => {
      const idx = segments.findIndex((s) => s.node === node);
      if (idx < 0) return null;
      return segments[idx].start + nodeOffset;
    };
  
    const norm = (node: Node, offset: number) => {
      if (node.nodeType === Node.TEXT_NODE) return { node, offset };
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const first = walker.nextNode();
      if (first) return { node: first as Node, offset: 0 };
      return { node, offset };
    };
  
    const s = norm(range.startContainer, range.startOffset);
    const e = norm(range.endContainer, range.endOffset);
    const start = toPos(s.node, s.offset);
    const end = toPos(e.node, e.offset);
    if (start == null || end == null) return null;
  
    const a = Math.min(start, end);
    const b = Math.max(start, end);
    const quote = text.slice(a, b);
    return { start: a, end: b, quote };
  }
  
  /** 更稳妥的包裹：extractContents + insertNode */
  function wrapRange(range: Range, tagName: string, attrs: Record<string, string>, styles: Record<string, string>) {
    const el = document.createElement(tagName);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    Object.entries(styles || {}).forEach(([k, v]) => ((el.style as any)[k] = v));
    const frag = range.extractContents();
    el.appendChild(frag);
    range.insertNode(el);
    return el;
  }
  
  /**
   * 将 [start,end) 的线性区间拆成多个纯文本范围逐段高亮，
   * 避免把整个 <p> 等块级元素包进 <mark> 导致布局异常。
   */
  function highlightOffsetsMulti(container: HTMLElement, start: number, end: number, id: string, color: string) {
    const { segments } = getLinearTextAndMap(container);
    const created: HTMLElement[] = [];
    segments.forEach((seg) => {
      const L = Math.max(start, seg.start);
      const R = Math.min(end, seg.end);
      // 跳过纯空白/换行，避免空行整行着色
      const slice = (seg.node.nodeValue || '').slice(L - seg.start, R - seg.start);
      if (!slice || slice.trim() === '') {
        return; // 跳过纯空白/换行，避免空行整行着色
      }
      if (L < R) {
        const r = document.createRange();
        r.setStart(seg.node, L - seg.start);
        r.setEnd(seg.node, R - seg.start);
        const el = wrapRange(
          r,
          "mark",
          { "data-ann-id": id, class: "ann-mark" },
          { background: color || "#FFE58F", padding: "0 2px" }
        );
        created.push(el as HTMLElement);
      }
    });
    return created;
  }
  
  export function highlightByOffsets(container: HTMLElement, start: number, end: number, id: string, color: string) {
    return highlightOffsetsMulti(container, start, end, id, color);
  }
  
  // 浮动层判断：工具条/右键菜单/备注面板等
  export function isInFloating(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    return !!el?.closest?.('[data-floating-ui]');
  }