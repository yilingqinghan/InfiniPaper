import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Share2 } from "lucide-react";
/* --------------------------- paper citation graph dialog --------------------------- */
// 简单并发限制
type Paper = {
  id: number; title: string; abstract?: string | null; year?: number | null; venue?: string | null;
  doi?: string | null; pdf_url?: string | null;
  authors?: { id?: number; name?: string; affiliation?: string | null }[];
  tag_ids?: number[];
};

const OA_BASE = "https://api.openalex.org";
const __oaCache = new Map<string, any>(); // key: doi(lower)
async function fetchOpenAlexByDOI(doi?: string) {
  if (!doi) return null;
  const key = doi.trim().toLowerCase();
  if (__oaCache.has(key)) return __oaCache.get(key);
  const enc = encodeURIComponent(doi);
  // 优先 doi: 前缀，其次绝对链接形式（个别 DOI 特殊字符）
  const urls = [
    `${OA_BASE}/works/doi:${enc}`,
    `${OA_BASE}/works/https://doi.org/${enc}`,
  ];
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      const out = {
        id: data?.id as string | null,
        title: (data?.title as string) || null,
        cited_by_count: (data?.cited_by_count as number) || 0,
        referenced_works: Array.isArray(data?.referenced_works) ? (data.referenced_works as string[]) : [],
      };
      __oaCache.set(key, out);
      return out;
    } catch (e) { lastErr = e; }
  }
  console.warn("OpenAlex fetch failed for", doi, lastErr);
  return null;
}

async function runLimited<T>(limit: number, tasks: (() => Promise<T>)[]): Promise<T[]> {
  const ret: T[] = [];
  let i = 0, active = 0;
  return await new Promise<T[]>((resolve, reject) => {
    const kick = () => {
      while (active < limit && i < tasks.length) {
        const idx = i++; active++;
        tasks[idx]().then(v => {
          ret[idx] = v; active--; (ret.length === tasks.length ? resolve(ret) : kick());
        }).catch(reject);
      }
      if (tasks.length === 0) resolve([]);
    };
    kick();
  });
}
function PaperGraphDialog({ open, papers, onClose }: { open: boolean; papers: Paper[]; onClose: () => void }) {
    const [loading, setLoading] = React.useState(false);
    const [useExternal, setUseExternal] = React.useState(true);   // 是否联网取引用
    const [limitN, setLimitN] = React.useState(120);              // 最大论文数
    const [graph, setGraph] = React.useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
    const [focus, setFocus] = React.useState<number | null>(null); // 以 paper.id 为中心
  
    const wrapRef = React.useRef<HTMLDivElement | null>(null);
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const tipRef = React.useRef<HTMLDivElement | null>(null);
    const rafRef = React.useRef<number | null>(null);
  
    // 拉取 & 构建图
    React.useEffect(() => {
      if (!open) return;
      let cancel = false;
      (async () => {
        setLoading(true);
        try {
          const rows = papers.filter(p => !!p.doi).slice(0, limitN);
          const byDOI = new Map(rows.map(p => [String(p.doi).trim().toLowerCase(), p.id] as const));
  
          // 拉取 OpenAlex 元信息（被引数 & 引用列表）
          const metas = useExternal ? await runLimited(4, rows.map(p => () => fetchOpenAlexByDOI(p.doi!))) : rows.map(_ => null);
          if (cancel) return;
  
          const idByOpenAlex = new Map<string, number>();
          metas.forEach((m, i) => { if (m?.id) idByOpenAlex.set(m.id, rows[i]!.id); });
  
          const nodes = rows.map((p, i) => ({
            key: p.id,
            title: p.title,
            year: p.year || null,
            cited: metas[i]?.cited_by_count ?? 0,
          }));
  
          const edges: { s: number; t: number }[] = [];
          metas.forEach((m, i) => {
            if (!m) return;
            for (const ref of m.referenced_works || []) {
              const to = idByOpenAlex.get(ref);
              if (to) edges.push({ s: rows[i]!.id, t: to }); // i 引用了 to
            }
          });
  
          setGraph({ nodes, edges });
        } finally {
          if (!cancel) setLoading(false);
        }
      })();
      return () => { cancel = true; };
    }, [open, papers, useExternal, limitN]);
  
    // 画布 + 交互渲染（力导向 + 箭头）
    React.useEffect(() => {
      if (!open) return;
      const canvas = canvasRef.current; if (!canvas) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  
      const size = () => {
        const rect = wrapRef.current?.getBoundingClientRect();
        const w = Math.max(480, Math.floor((rect?.width || 1100)));
        const h = Math.max(480, Math.floor((rect?.height || 720)));
        canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        ctx.resetTransform(); ctx.scale(dpr, dpr); return { w, h };
      };
      let { w, h } = size();
      const onResize = () => { const s = size(); w = s.w; h = s.h; };
      window.addEventListener('resize', onResize);
  
      type NodeT = { key: number; title: string; year: number|null; cited: number; x: number; y: number; vx: number; vy: number; fixed?: boolean };
      const allNodes: NodeT[] = graph.nodes.map((n, i) => ({
        key: n.key, title: n.title, year: n.year, cited: n.cited,
        x: (w/2)+220*Math.cos(2*Math.PI*i/Math.max(1, graph.nodes.length)),
        y: (h/2)+220*Math.sin(2*Math.PI*i/Math.max(1, graph.nodes.length)),
        vx: 0, vy: 0
      }));
      const index = new Map(allNodes.map((n, i) => [n.key, i] as const));
      const edges = graph.edges.map(e => ({ s: index.get(e.s)!, t: index.get(e.t)! }));
  
      const maxCited = Math.max(1, ...allNodes.map(n => n.cited));
      const R = (cited: number) => 8 + 18 * Math.sqrt(cited / maxCited);
  
      const view = { s: 1, tx: 0, ty: 0 };
      const toWorld = (sx: number, sy: number) => ({ x: (sx - view.tx) / view.s, y: (sy - view.ty) / view.s });
      const mouse = { x: 0, y: 0, down: false, mode: 'none' as 'none'|'pan'|'drag', dragIdx: -1 };
  
      const nearest = (sx: number, sy: number) => {
        const p = toWorld(sx, sy); let best = -1, bd = 1e9;
        for (let i = 0; i < allNodes.length; i++) {
          const n = allNodes[i]; const d = Math.hypot(p.x - n.x, p.y - n.y);
          if (d < Math.max(14, R(n.cited)) && d < bd) { bd = d; best = i; }
        }
        return best;
      };
  
      const onWheel = (ev: WheelEvent) => { 
        const rect = canvas.getBoundingClientRect(); const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
        const ds = Math.exp(-ev.deltaY * 0.0015); const s2 = Math.max(0.4, Math.min(3, view.s * ds));
        view.tx = mx - (mx - view.tx) * (s2 / view.s); view.ty = my - (my - view.ty) * (s2 / view.s); view.s = s2; ev.preventDefault();
      };
      const onDown = (ev: MouseEvent) => { 
        mouse.down = true; const rect = canvas.getBoundingClientRect(); const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
        mouse.x = x; mouse.y = y; const i = nearest(x, y);
        if (i >= 0) { mouse.mode = 'drag'; mouse.dragIdx = i; allNodes[i].fixed = true; } else { mouse.mode = 'pan'; }
      };
      const onMove = (ev: MouseEvent) => {
        const rect = canvas.getBoundingClientRect(); const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
        if (mouse.down && mouse.mode === 'pan') { view.tx += (x - mouse.x); view.ty += (y - mouse.y); }
        if (mouse.down && mouse.mode === 'drag' && mouse.dragIdx >= 0) {
          const p = toWorld(x, y); const n = allNodes[mouse.dragIdx]; n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0;
        }
        mouse.x = x; mouse.y = y;
        const tip = tipRef.current; if (tip) {
          const i = nearest(x, y);
          if (i >= 0) {
            const n = allNodes[i];
            tip.style.display = 'block'; tip.style.left = (ev.clientX + 12) + 'px'; tip.style.top = (ev.clientY + 12) + 'px';
            tip.innerHTML = `${n.title || 'Untitled'}${n.year ? ` (${n.year})` : ''}<br/>被引：${n.cited}`;
          } else tip.style.display = 'none';
        }
      };
      const onUp = (ev: MouseEvent) => { 
        if (mouse.mode === 'drag' && mouse.dragIdx >= 0) {
          if (Math.hypot(ev.movementX, ev.movementY) < 2) { const n = allNodes[mouse.dragIdx]; setFocus(n.key); }
        }
        mouse.down = false; mouse.mode = 'none'; mouse.dragIdx = -1;
      };
  
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
  
      const step = () => {
        const K = 160;
        // 斥力
        for (let i = 0; i < allNodes.length; i++) for (let j = i + 1; j < allNodes.length; j++) {
          const a = allNodes[i], b = allNodes[j];
          const dx = a.x - b.x, dy = a.y - b.y; const dist = Math.hypot(dx, dy) + 0.01;
          const rep = (K*K) / dist; const rx = (dx/dist)*rep, ry = (dy/dist)*rep;
          a.vx += rx; a.vy += ry; b.vx -= rx; b.vy -= ry;
        }
        // 引力（沿边）
        for (const e of edges) {
          const a = allNodes[e.s], b = allNodes[e.t];
          const dx = a.x - b.x, dy = a.y - b.y; const dist = Math.hypot(dx, dy) + 0.01;
          const att = (dist*dist)/K; const ax = (dx/dist)*att, ay = (dy/dist)*att;
          a.vx -= ax; a.vy -= ay; b.vx += ax; b.vy += ay;
        }
        for (const n of allNodes) { if (n.fixed) continue; n.x += n.vx*0.01; n.y += n.vy*0.01; n.vx *= 0.6; n.vy *= 0.6; }
  
        // 绘制
        ctx.clearRect(0, 0, w, h);
        ctx.save(); ctx.translate(view.tx, view.ty); ctx.scale(view.s, view.s);
        // 边（带箭头；焦点相关高亮）
        for (const e of edges) {
          const a = allNodes[e.s], b = allNodes[e.t];
          const dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1; const ux = dx/len, uy = dy/len;
          const rA = R(a.cited), rB = R(b.cited);
          const sx = a.x + ux * (rA + 2), sy = a.y + uy * (rA + 2);
          const tx = b.x - ux * (rB + 4), ty = b.y - uy * (rB + 4);
          const onPath = (!!focus && (a.key === focus || b.key === focus));
          ctx.strokeStyle = onPath ? 'rgba(59,130,246,0.85)' : 'rgba(100,116,139,0.55)';
          ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
          // 箭头
          const ah = 6, aw = 4;
          ctx.beginPath(); ctx.moveTo(tx, ty);
          ctx.lineTo(tx - ux*ah + -uy*aw, ty - uy*ah + ux*aw);
          ctx.lineTo(tx - ux*ah + uy*aw,  ty - uy*ah + -ux*aw);
          ctx.closePath(); ctx.fillStyle = ctx.strokeStyle as string; ctx.fill();
        }
        // 点 + 标签
        for (const n of allNodes) {
          const r = R(n.cited);
          ctx.beginPath(); ctx.fillStyle = (focus === n.key) ? '#1E90FF' : '#64748b'; ctx.arc(n.x, n.y, r, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = '#111827'; ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto'; ctx.textAlign = 'center';
          const s = n.title || 'Untitled'; const label = s.length > 30 ? s.slice(0, 29) + '…' : s;
          ctx.fillText(label, n.x, n.y - r - 2);
        }
        ctx.restore();
  
        rafRef.current = requestAnimationFrame(step);
      };
      step();
  
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        window.removeEventListener('resize', onResize);
        canvas.removeEventListener('wheel', onWheel as any);
        canvas.removeEventListener('mousedown', onDown as any);
        window.removeEventListener('mousemove', onMove as any);
        window.removeEventListener('mouseup', onUp as any);
      };
    }, [open, graph, focus]);
  
    return (
      <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1100px] max-w-[96vw] h-[720px] max-h-[92vh] overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="h-full flex flex-col" ref={wrapRef}>
              <div className="px-4 py-2 border-b bg-gradient-to-r from-violet-50 to-fuchsia-50 flex items-center gap-3">
                <Share2 className="w-4 h-4 text-violet-600" />
                <div className="text-sm font-medium">论文引用关系网</div>
                <div className="text-xs text-gray-500">{graph.nodes.length} 篇 · {graph.edges.length} 条引用</div>
                <div className="ml-auto flex items-center gap-3">
                  <label className="text-xs flex items-center gap-1">
                    <input type="checkbox" checked={useExternal} onChange={e => setUseExternal(e.target.checked)} /> 联网扩展引用（OpenAlex）
                  </label>
                  <label className="text-xs flex items-center gap-1">
                    上限：
                    <input type="number" value={limitN} min={30} max={300} step={10}
                           onChange={e => setLimitN(Math.max(30, Math.min(300, Number(e.target.value)||120)))} className="w-16 text-xs px-2 py-1 border rounded" />
                  </label>
                  <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={onClose}>关闭</button>
                </div>
              </div>
              <div className="relative flex-1">
                {loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">加载引用中…</div>}
                <canvas ref={canvasRef} className="block w-full h-full" />
                <div ref={tipRef} style={{ display: 'none' }} className="pointer-events-none absolute z-50 px-2 py-1 rounded bg-black/80 text-white text-[12px] leading-tight" />
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }


  export default PaperGraphDialog;