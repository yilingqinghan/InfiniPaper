
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

/* --------------------------- author graph dialog (interactive) --------------------------- */
function AuthorGraphDialog({ open, seed, papers, onClose }: { open: boolean; seed: string | null; papers: Paper[]; onClose: () => void }) {
  const [hops, setHops] = React.useState<1 | 2>(1);
  const [focus, setFocus] = React.useState<string | null>(seed);
  React.useEffect(() => setFocus(seed), [seed]);

  // 从当前筛选后的 papers 构建全局计数与邻接
  const { nodesAll, adj } = React.useMemo(() => {
    const cnt = new Map<string, number>();
    const ad = new Map<string, Map<string, number>>();
    const addEdge = (a: string, b: string) => {
      if (!ad.has(a)) ad.set(a, new Map());
      if (!ad.has(b)) ad.set(b, new Map());
      ad.get(a)!.set(b, (ad.get(a)!.get(b) || 0) + 1);
      ad.get(b)!.set(a, (ad.get(b)!.get(a) || 0) + 1);
    };
    for (const p of papers) {
      const names = Array.from(new Set((p.authors || []).map(a => a?.name).filter(Boolean))) as string[];
      for (const n of names) cnt.set(n, (cnt.get(n) || 0) + 1);
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) addEdge(names[i]!, names[j]!);
    }
    const nodesAll = Array.from(cnt.entries()).map(([id, count]) => ({ id, count }));
    return { nodesAll, adj: ad };
  }, [papers]);

  // 以 focus 作者为中心的 ego 网络（1 跳或 2 跳）
  const graph = React.useMemo(() => {
    if (!focus) return { nodes: [] as { id: string; count: number }[], edges: [] as { s: string; t: string; w: number }[] };
    const keep = new Set<string>([focus]);
    const visited = new Set<string>([focus]);
    let frontier = [focus];
    for (let depth = 0; depth < hops; depth++) {
      const next: string[] = [];
      for (const u of frontier) {
        const m = adj.get(u); if (!m) continue;
        m.forEach((_w, v) => { if (!visited.has(v)) { visited.add(v); keep.add(v); next.push(v); } });
      }
      frontier = next;
    }
    const nodes = nodesAll.filter(n => keep.has(n.id));
    const edges: { s: string; t: string; w: number }[] = [];
    keep.forEach(a => {
      const m = adj.get(a); if (!m) return;
      m.forEach((w, b) => { if (keep.has(b) && a < b) edges.push({ s: a, t: b, w }); });
    });
    return { nodes, edges };
  }, [focus, hops, nodesAll, adj]);

  // 画布 + 交互
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const tipRef = React.useRef<HTMLDivElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const stop = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };

  React.useEffect(() => {
    if (!open) { stop(); return; }
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

    const size = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const w = Math.max(320, Math.floor((rect?.width || 960)));
      const h = Math.max(420, Math.floor((rect?.height || 600)));
      canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.resetTransform(); ctx.scale(dpr, dpr);
      return { w, h };
    };
    let { w, h } = size();
    const onResize = () => { const s = size(); w = s.w; h = s.h; };
    window.addEventListener('resize', onResize);

    type NodeT = { id: string; count: number; x: number; y: number; vx: number; vy: number; fixed?: boolean };
    const nodes: NodeT[] = graph.nodes.map((n, i) => ({
      id: n.id, count: n.count,
      x: (w/2)+160*Math.cos(2*Math.PI*i/Math.max(1, graph.nodes.length)),
      y: (h/2)+160*Math.sin(2*Math.PI*i/Math.max(1, graph.nodes.length)),
      vx: 0, vy: 0
    }));
    const idx = new Map(nodes.map((n, i) => [n.id, i] as const));
    const edges = graph.edges.map(e => ({ s: idx.get(e.s)!, t: idx.get(e.t)!, w: e.w }));

    const maxC = Math.max(1, ...nodes.map(n => n.count));
    const R = (c: number) => 8 + 18 * (c / maxC);

    // 视图变换（平移缩放）
    const view = { s: 1, tx: 0, ty: 0 };
    const toWorld = (sx: number, sy: number) => ({ x: (sx - view.tx) / view.s, y: (sy - view.ty) / view.s });

    // 交互状态
    const mouse = { x: 0, y: 0, down: false, mode: 'none' as 'none'|'pan'|'drag', dragIdx: -1 };

    const nearest = (sx: number, sy: number) => {
      const p = toWorld(sx, sy);
      let best = -1, bd = 1e9;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dx = p.x - n.x, dy = p.y - n.y; const d = Math.hypot(dx, dy);
        if (d < Math.max(14, R(n.count)) && d < bd) { bd = d; best = i; }
      }
      return best;
    };

    const onWheel = (ev: WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const ds = Math.exp(-ev.deltaY * 0.0015);
      const s2 = Math.max(0.4, Math.min(3, view.s * ds));
      // 以鼠标为中心缩放
      view.tx = mx - (mx - view.tx) * (s2 / view.s);
      view.ty = my - (my - view.ty) * (s2 / view.s);
      view.s = s2; ev.preventDefault();
    };
    const onDown = (ev: MouseEvent) => {
      mouse.down = true;
      const rect = canvas.getBoundingClientRect(); const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      mouse.x = x; mouse.y = y;
      const i = nearest(x, y);
      if (i >= 0) { mouse.mode = 'drag'; mouse.dragIdx = i; nodes[i].fixed = true; }
      else { mouse.mode = 'pan'; }
    };
    const onMove = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect(); const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      if (mouse.down && mouse.mode === 'pan') { view.tx += (x - mouse.x); view.ty += (y - mouse.y); }
      if (mouse.down && mouse.mode === 'drag' && mouse.dragIdx >= 0) {
        const p = toWorld(x, y); const n = nodes[mouse.dragIdx]; n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0;
      }
      mouse.x = x; mouse.y = y;
      // tooltip
      const tip = tipRef.current; if (tip) {
        const i = nearest(x, y);
        if (i >= 0) {
          const n = nodes[i];
          tip.style.display = 'block'; tip.style.left = (ev.clientX + 12) + 'px'; tip.style.top = (ev.clientY + 12) + 'px';
          tip.innerHTML = `${n.id}<br/>论文数：${n.count}`;
        } else tip.style.display = 'none';
      }
    };
    const onUp = (ev: MouseEvent) => {
      if (mouse.mode === 'drag' && mouse.dragIdx >= 0) {
        // 点击（非拖动）切换中心
        if (Math.hypot(ev.movementX, ev.movementY) < 2) {
          const n = nodes[mouse.dragIdx]; setFocus(n.id);
        }
      }
      mouse.down = false; mouse.mode = 'none'; mouse.dragIdx = -1;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // 力导向模拟（持续动画）
    const K = 140;
    const step = () => {
      // 斥力
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y; const dist = Math.hypot(dx, dy) + 0.01;
        const rep = (K * K) / dist; const rx = (dx / dist) * rep, ry = (dy / dist) * rep;
        a.vx += rx; a.vy += ry; b.vx -= rx; b.vy -= ry;
      }
      // 引力
      for (const e of edges) {
        const a = nodes[e.s], b = nodes[e.t];
        let dx = a.x - b.x, dy = a.y - b.y; const dist = Math.hypot(dx, dy) + 0.01;
        const att = (dist * dist) / K * Math.log(1 + e.w);
        const ax = (dx / dist) * att, ay = (dy / dist) * att;
        a.vx -= ax; a.vy -= ay; b.vx += ax; b.vy += ay;
      }
      for (const n of nodes) { if (n.fixed) continue; n.x += n.vx * 0.01; n.y += n.vy * 0.01; n.vx *= 0.6; n.vy *= 0.6; }

      // 绘制
      ctx.clearRect(0, 0, w, h);
      ctx.save(); ctx.translate(view.tx, view.ty); ctx.scale(view.s, view.s);
      // 边
      ctx.strokeStyle = 'rgba(100,116,139,0.55)'; ctx.lineWidth = 1;
      for (const e of edges) { const a = nodes[e.s], b = nodes[e.t]; ctx.globalAlpha = Math.min(0.2 + Math.log(1 + e.w) * 0.25, 0.9); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // 点 + 标签
      for (const n of nodes) {
        const r = R(n.count);
        ctx.beginPath(); ctx.fillStyle = (n.id === focus) ? '#1E90FF' : '#64748b'; ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#111827'; ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto'; ctx.textAlign = 'center';
        const label = n.id.length > 20 ? n.id.slice(0, 19) + '…' : n.id; ctx.fillText(label, n.x, n.y - r - 2);
      }
      ctx.restore();

      rafRef.current = requestAnimationFrame(step);
    };
    step();

    return () => {
      stop(); window.removeEventListener('resize', onResize);
      canvas.removeEventListener('wheel', onWheel as any);
      canvas.removeEventListener('mousedown', onDown as any);
      window.removeEventListener('mousemove', onMove as any);
      window.removeEventListener('mouseup', onUp as any);
    };
  }, [open, graph, seed]);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[960px] max-w-[96vw] h-[640px] max-h-[92vh] overflow-hidden rounded-2xl bg-white shadow-xl">
          <div className="h-full flex flex-col" ref={wrapRef}>
            <div className="px-4 py-2 border-b bg-gradient-to-r from-sky-50 to-blue-50 flex items-center gap-3">
              <Share2 className="w-4 h-4 text-blue-600" />
              <div className="text-sm font-medium">作者关系网</div>
              <div className="text-xs text-gray-500">中心：<span className="font-semibold">{focus || '—'}</span></div>
              <div className="ml-auto flex items-center gap-3">
                <label className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={hops === 2} onChange={e => setHops(e.target.checked ? 2 : 1)} /> 包含二跳
                </label>
                <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={onClose}>关闭</button>
              </div>
            </div>
            <div className="relative flex-1">
              <canvas ref={canvasRef} className="block w-full h-full" />
              <div ref={tipRef} style={{ display: 'none' }} className="pointer-events-none absolute z-50 px-2 py-1 rounded bg-black/80 text-white text-[12px] leading-tight" />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}


  export default AuthorGraphDialog;