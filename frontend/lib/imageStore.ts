// frontend/lib/imageStore.ts
export type UploadResp = {
    internalUrl: string;       // 内部可访问地址（你现有后端返回的 url）
    externalUrl?: string;      // 外部图床地址（后端可选返回）
    width?: number;
    height?: number;
    format?: string;
    size?: number;
  };
  
  // 将 data:URL 转成 Blob（用于把粘贴的 base64 转为文件上传）
  export function dataURLtoBlob(dataURL: string): Blob {
    const i = dataURL.indexOf(",");
    const header = dataURL.slice(0, i);
    const b64 = dataURL.slice(i + 1);
    const m = header.match(/^data:([^;,]+)(?:;[^,]*)*$/i);
    const mime = m ? m[1] : "application/octet-stream";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    return new Blob([arr], { type: mime });
  }
  
  // 从字符串里抓 data:*;base64,XXXX
  export function extractDataUrls(text: string): string[] {
    const re = /(data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,\s]+)*;base64,[A-Za-z0-9+/=]+)/ig;
    const all = text ? text.match(re) || [] : [];
    return Array.from(new Set(all));
  }
  
  // 统一上传：支持 mirror=1（让后端同时推外链）
  // api('/path') 是你项目里现成的 path 拼接函数
  export async function uploadImageViaApi(
    api: (p: string) => string,
    paperId: number,
    file: File,
    opts?: { mirror?: boolean }
  ): Promise<UploadResp> {
    const fd = new FormData();
    fd.append("file", file);
    const url = opts?.mirror
      ? api(`/api/v1/richnotes/by-paper/${paperId}/images?mirror=1`)
      : api(`/api/v1/richnotes/by-paper/${paperId}/images`);
    const r = await fetch(url, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    return {
      internalUrl: data.url || data.internal_url || data.path || "",
      externalUrl: data.external_url || data.cdn_url || data.public_url || "",
      width: data.width, height: data.height, format: data.format, size: data.size,
    };
  }
  
  // 给编辑器插入 Markdown 图片（primary 优先外链，backup 内链做注释）
  export function buildImageMarkdown(primaryUrl: string, alt: string, backupUrl?: string) {
    return backupUrl
      ? `![${alt}](${primaryUrl}) <!-- backup:${backupUrl} -->`
      : `![${alt}](${primaryUrl})`;
  }
  
  // 统一拦截粘贴/拖拽图片：自动上传并插入 Markdown
  // - root: WYSIWYG / Toast 编辑器根节点（给它绑 paste/drop）
  // - textarea: 纯 Markdown 文本域（可选）
  // - onInsert: 实际插入文本的方法（不同编辑器不同）
  export function attachImagePasteDrop(opts: {
    root?: HTMLElement | null;
    textarea?: HTMLTextAreaElement | null;
    paperId: number;
    api: (p: string) => string;
    onInsert: (markdown: string) => void;
    onStart?: (msg?: string) => void;
    onDone?: (ok: boolean, msg?: string) => void;
    maxSize?: number; // 默认 25MB
  }) {
    const maxSize = (opts.maxSize ?? 25) * 1024 * 1024;
  
    const inside = (host: HTMLElement | null | undefined, el: EventTarget | null): boolean => {
      if (!host || !el || !(el as Node)) return false;
      try { return !!(el as Node) && (host === el || host.contains(el as Node)); } catch { return false; }
    };
  
    const getTUICell = (el: EventTarget | null): HTMLElement | null => {
      if (!el || !(el as Node)) return null;
      const node = el as Node;
      const elem = (node.nodeType === 1 ? (node as HTMLElement) : (node.parentElement as HTMLElement | null));
      if (!elem) return null;
      return elem.closest?.('.toastui-editor-contents') as HTMLElement | null;
    };
  
    const handle = async (e: ClipboardEvent | DragEvent) => {
      console.log("[attachImagePasteDrop] event received", e.type, e);
      const dt = (e as ClipboardEvent).clipboardData || (e as DragEvent).dataTransfer;
      if (!dt) return;
  
      // 仅当事件发生在我们关注的区域（Toast/textarea）内才处理
      const root = opts.root || null;
      const ta = opts.textarea || null;
      const inToast = inside(root, e.target) || inside(root, document.activeElement) || !!getTUICell(e.target);
      const inTextarea = ta ? (inside(ta, e.target) || document.activeElement === ta) : false;
      if (!(inToast || inTextarea)) {
        console.log("[attachImagePasteDrop] skip event, not inside editor", { inToast, inTextarea });
        return;
      }
  
      // 收集图片文件
      const files: File[] = [];
      const items = dt.items || ([] as any);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it && it.kind === "file") {
          const f = it.getAsFile();
          if (f && /^image\//i.test(f.type)) files.push(f);
        }
      }
  
      // 从 HTML / Text 中抓 data:URL
      const fromHtml = (dt.getData && dt.getData("text/html")) || "";
      const fromText = (dt.getData && dt.getData("text/plain")) || "";
      const dataUrls = [...extractDataUrls(fromHtml), ...extractDataUrls(fromText)];
      for (const du of dataUrls) {
        try {
          const blob = dataURLtoBlob(du);
          const ext = (blob.type.split("/")[1] || "png").replace("+xml", "");
          const file = new File([blob], `pasted.${ext}`, { type: blob.type });
          files.push(file);
        } catch {}
      }
  
      console.log("[attachImagePasteDrop] collected files", files, "dataUrls", dataUrls);
      if (!files.length) return;
  
      // —— 关键：阻止 Toast UI 默认把 base64 插进去 ——
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
  
      opts.onStart?.("正在上传图片…");
      try {
        for (const f of files) {
          if (f.size > maxSize) throw new Error(`图片过大（>${Math.round(maxSize / 1024 / 1024)}MB）`);
          const { internalUrl, externalUrl } = await uploadImageViaApi(opts.api, opts.paperId, f, {} as any);
          const primary0 = externalUrl || internalUrl;
          const backup0 = externalUrl ? internalUrl : undefined;
          // absolute-ize URLs so frontend on a different origin can load images served by backend
          const base = opts.api("");
          const toAbs = (u?: string) => {
            if (!u) return u as any;
            if (/^https?:\/\//i.test(u)) return u;
            if (u.startsWith("/")) return `${base.replace(/\/$/, "")}${u}`;
            return u;
          };
          const primary = toAbs(primary0) as string;
          const backup = toAbs(backup0) as string | undefined;
          const md = buildImageMarkdown(primary, f.name, backup);
          opts.onInsert(md);
          console.log("[attachImagePasteDrop] inserted image markdown", md);
        }
        opts.onDone?.(true, "上传完成");
      } catch (err: any) {
        console.log("[attachImagePasteDrop] upload/insert error", err);
        opts.onDone?.(false, err?.message || String(err));
      }
    };
  
    const root = opts.root || null;
    const ta = opts.textarea || null;
    const ww = root ? (root.querySelector(".toastui-editor-contents") as HTMLElement | null) : null;
  
    const bind = (el: EventTarget | null) => {
      if (!el) return () => {};
      el.addEventListener("paste", handle as any, true); // capture
      el.addEventListener("drop", handle as any, true);
      return () => {
        el.removeEventListener("paste", handle as any, true);
        el.removeEventListener("drop", handle as any, true);
      };
    };
  
    const offRoot = bind(root);
    const offWw = bind(ww);
  
    // 全局兜底：仅当事件目标在 root/ww/textarea 内时才处理
    const onDoc = (e: Event) => {
      console.log("[attachImagePasteDrop] onDoc triggered", e.type, e.target);
      const t = e as ClipboardEvent | DragEvent;
      if (inside(root, t.target) || inside(ww, t.target) || (ta && inside(ta, t.target))) {
        handle(t);
      }
    };
    document.addEventListener("paste", onDoc, true);
    document.addEventListener("drop", onDoc, true);
  
    return () => {
      offRoot();
      offWw();
      document.removeEventListener("paste", onDoc, true);
      document.removeEventListener("drop", onDoc, true);
    };
  }