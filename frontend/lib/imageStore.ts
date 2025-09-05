// frontend/lib/imageStore.ts
export type UploadResp = {
    internalUrl: string;       // 内部可访问地址（你现有后端返回的 url），用于应用内部引用和权限控制
    externalUrl?: string;      // 外部图床地址（后端可选返回），用于公开访问或 CDN 加速
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
  
  // —— 配置解析：优先 .env.local (NEXT_PUBLIC_*)，其次代码入参 / window 全局 / localStorage ——
  // 注意：Next.js 需要“直接属性访问”才能在客户端替换 env；不要用 (process as any).env 动态访问
  const ENV_IMGBB_KEY = process.env.NEXT_PUBLIC_IMGBB_KEY;
  const ENV_UPLOAD_PROVIDER = process.env.NEXT_PUBLIC_UPLOAD_PROVIDER as ('backend'|'imgbb'|'both'|undefined);
  const ENV_IMGBB_EXPIRATION = process.env.NEXT_PUBLIC_IMGBB_EXPIRATION;

  function resolveImgBBKey(explicit?: string): string {
    return explicit
      || (ENV_IMGBB_KEY as string)
      || (typeof window !== 'undefined' && ((window as any).__IMGBB_KEY__ || localStorage.getItem('IMGBB_API_KEY')))
      || '';
  }
  function resolveUploadProvider(explicit?: 'backend'|'imgbb'|'both', keyMaybe?: string): 'backend'|'imgbb'|'both' {
    const fromEnv = ENV_UPLOAD_PROVIDER;
    return explicit || fromEnv || (keyMaybe ? 'both' : 'backend');
  }
  function resolveImgBBExpiration(explicit?: number): number | undefined {
    if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
    const raw = ENV_IMGBB_EXPIRATION;
    const v = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(v) ? v : undefined;
  }
  
  // —— 调试工具 ——
  const __IS_DEV__ = typeof process !== 'undefined' ? ((process as any).env?.NODE_ENV !== 'production') : true;
  const redact = (s?: string) => (s ? (s.length <= 8 ? '*'.repeat(Math.max(0, s.length - 2)) + s.slice(-2) : s.slice(0, 2) + '***' + s.slice(-4)) : '');
  export function debugUploadEnv() {
    console.log('[debugUploadEnv] env', {
      NEXT_PUBLIC_UPLOAD_PROVIDER: ENV_UPLOAD_PROVIDER,
      NEXT_PUBLIC_IMGBB_KEY_tail: redact(ENV_IMGBB_KEY as any),
      NEXT_PUBLIC_IMGBB_EXPIRATION: ENV_IMGBB_EXPIRATION,
      has_window_key: typeof window !== 'undefined' && !!(window as any).__IMGBB_KEY__,
      localStorage_key_tail: typeof window !== 'undefined' ? redact(localStorage.getItem('IMGBB_API_KEY') || '') : '',
    });
  }
  if (typeof window !== 'undefined') {
    (window as any).__IP_debugUploadEnv = debugUploadEnv; // 在控制台可调用 window.__IP_debugUploadEnv()
    ;(window as any).__IP__debugUploadEnv = debugUploadEnv; // 兼容多一个下划线的误输入
  }
  
  // 上传到 ImgBB 图床（返回 externalUrl；其余字段尽量补齐）
  export async function uploadImageViaImgBB(
    file: File,
    opts: { apiKey: string; name?: string; expirationSec?: number }
  ): Promise<UploadResp> {
    const { apiKey, name, expirationSec } = opts || ({} as any);
    if (!apiKey) throw new Error('ImgBB apiKey missing');
    const fd = new FormData();
    fd.append('image', file); // 直接二进制文件
    if (name) fd.append('name', name);
    const url = new URL('https://api.imgbb.com/1/upload');
    url.searchParams.set('key', apiKey);
    if (expirationSec && Number.isFinite(expirationSec)) {
      url.searchParams.set('expiration', String(Math.max(60, Math.min(15552000, Math.floor(expirationSec)))));
    }
    console.log('[uploadImageViaImgBB] POST', { to: url.toString().replace(/key=[^&]+/, 'key=***'), name, size: file.size, type: file.type, expiration: expirationSec });
    const r = await fetch(url.toString(), { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    console.log('[uploadImageViaImgBB] resp', { ok: r.ok, status: r.status, success: j?.success, hasData: !!j?.data });
    if (!r.ok || !j || j.success === false) {
      const msg = (j && (j.error?.message || j.data?.error?.message)) || r.statusText || 'ImgBB upload failed';
      throw new Error(msg);
    }
    // 尽力从多处字段拿直链
    const data = j.data || {};
    const ex = data.url || data.display_url || data.image?.url || '';
    console.log('[uploadImageViaImgBB] parsed', { externalUrl: ex, width: data?.width || data?.image?.width, height: data?.height || data?.image?.height });
    return {
      internalUrl: '',
      externalUrl: ex,
      width: data.width || data.image?.width,
      height: data.height || data.image?.height,
      format: data.image?.mime || data.image?.extension,
      size: data.size || undefined,
    } as UploadResp;
  }
  
  // 统一上传：支持 mirror=1（让后端同时推外链）
  // api('/path') 是你项目里现成的 path 拼接函数
  export async function uploadImageViaApi(
    api: (p: string) => string,
    paperId: number,
    file: File,
    opts?: { mirror?: boolean; provider?: 'backend' | 'imgbb' | 'both'; imgbbKey?: string; expirationSec?: number }
  ): Promise<UploadResp> {
    const keyResolved = resolveImgBBKey(opts?.imgbbKey);
    const provider = resolveUploadProvider(opts?.provider, keyResolved);
    const expResolved = resolveImgBBExpiration(opts?.expirationSec);
    console.log('[uploadImageViaApi] config', { provider, hasKey: !!keyResolved, key_tail: redact(keyResolved), expiration: expResolved });

    let imgbbError: any = null;

    // 1) 如果需要 ImgBB，先传 ImgBB
    let imgbb: UploadResp | null = null;
    if (provider === 'imgbb' || provider === 'both') {
      const key = keyResolved;
      if (!key && provider === 'imgbb') throw new Error('ImgBB key is required');
      if (key) {
        try {
          imgbb = await uploadImageViaImgBB(file, { apiKey: key, name: file.name, expirationSec: expResolved });
        } catch (e: any) {
          console.log('[uploadImageViaApi] ImgBB failed', e);
          imgbbError = e;
          if (provider === 'imgbb') throw e;
        }
      }
    }

    // 2) 后端（为了生成内部可用的备份/权限控制）
    let backend: UploadResp | null = null;
    if (provider === 'backend' || provider === 'both') {
      const fd = new FormData();
      fd.append('file', file);
      const url = opts?.mirror
        ? api(`/api/v1/richnotes/by-paper/${paperId}/images?mirror=1`)
        : api(`/api/v1/richnotes/by-paper/${paperId}/images`);
      const r = await fetch(url, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      backend = {
        internalUrl: data.url || data.internal_url || data.path || '',
        externalUrl: data.external_url || data.cdn_url || data.public_url || '',
        width: data.width, height: data.height, format: data.format, size: data.size,
      } as UploadResp;
    }

    // 3) 组装：优先 external，再给出 backup internal
    const externalUrl = (imgbb?.externalUrl) || (backend?.externalUrl) || '';
    const internalUrl = backend?.internalUrl || '';
    console.log('[uploadImageViaApi] summary', {
      provider,
      usedExternal: !!externalUrl,
      externalUrl,
      internalUrl,
      imgbbTried: provider !== 'backend',
      imgbbOk: !!(imgbb && imgbb.externalUrl),
      imgbbError: imgbbError ? (imgbbError.message || String(imgbbError)) : null,
      backendOk: !!(backend && backend.internalUrl),
    });
    return { internalUrl, externalUrl, width: imgbb?.width || backend?.width, height: imgbb?.height || backend?.height, format: imgbb?.format || backend?.format, size: imgbb?.size || backend?.size } as UploadResp;
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
    uploadProvider?: 'backend' | 'imgbb' | 'both';
    imgbbKey?: string;            // 也可从 localStorage.IMGBB_API_KEY 或 window.__IMGBB_KEY__ 读取
    imgbbExpiration?: number;     // 可选，秒（60~15552000）
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

      // 解析上传配置并打印（不暴露完整 key）
      const _key = resolveImgBBKey(opts.imgbbKey);
      const _provider = resolveUploadProvider(opts.uploadProvider, _key);
      const _exp = resolveImgBBExpiration(opts.imgbbExpiration);
      console.log('[attachImagePasteDrop] resolved', { provider: _provider, hasKey: !!_key, key_tail: redact(_key), expiration: _exp });

      opts.onStart?.("正在上传图片…");
      try {
        for (const f of files) {
          if (f.size > maxSize) throw new Error(`图片过大（>${Math.round(maxSize / 1024 / 1024)}MB）`);
          const { internalUrl, externalUrl } = await uploadImageViaApi(
            opts.api, opts.paperId, f,
            ((): any => {
              const key = resolveImgBBKey(opts.imgbbKey);
              const provider = resolveUploadProvider(opts.uploadProvider, key);
              const expirationSec = resolveImgBBExpiration(opts.imgbbExpiration);
              return { provider, imgbbKey: key, expirationSec };
            })()
          );
          console.log('[attachImagePasteDrop] urls', { externalUrl, internalUrl });
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
          console.log('[attachImagePasteDrop] chosen', { primary, backup });
          const md = buildImageMarkdown(primary, f.name, backup);
          opts.onInsert(md);
          console.log("[attachImagePasteDrop] inserted image markdown", md);
          console.log('[attachImagePasteDrop] provider-summary', { provider: _provider });
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