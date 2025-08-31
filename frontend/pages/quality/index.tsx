import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/utils/api";

// ------------------------- types (loose to fit different backends) -------------------------
type KV = Record<string, any>;
interface QualitySummary {
  total: number;
  missing?: Record<string, any[] | number>;
  coverage?: { doi?: number; pdf?: number; arxiv?: number; open_source?: number };
  year_hist?: Record<string, number> | Array<{ year: number; count: number }>;
  venue_top?: Array<{ name: string; count: number }>;
  tag_top?: Array<{ name: string; count: number }>;
  author_count_hist?: Array<{ authors: number; count: number }>;
}
// Minimal paper shape returned by GET /api/v1/papers
interface Paper {
  id: number;
  title?: string | null;
  abstract?: string | null;
  year?: number | null;
  doi?: string | null;
  venue?: string | null;
  pdf_url?: string | null;
  tag_ids?: number[];
  authors?: Array<{ id?: number; name?: string | null }>;
}

// ------------------------- tiny chart primitives (no deps) -------------------------
function setDPR(ctx: CanvasRenderingContext2D | null, w: number, h: number) {
  if (!ctx) return;
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const canvas = ctx.canvas;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.resetTransform();
  ctx.scale(dpr, dpr);
}

function downloadCanvasPNG(canvas: HTMLCanvasElement, filename: string) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}

// Bar chart (vertical)
function BarChart({
  title,
  data,
  height = 220,
  formatX,
  formatY = (v: number) => String(v),
}: {
  title: string;
  data: Array<{ x: string; y: number }>;
  height?: number;
  formatX?: (x: string) => string;
  formatY?: (y: number) => string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const wrap = wrapRef.current; const canvas = canvasRef.current; if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    setDPR(ctx, w, height);

    const maxY = Math.max(1, ...data.map(d => d.y));
    const pad = { l: 36, r: 12, t: 24, b: 32 };
    const innerW = w - pad.l - pad.r, innerH = height - pad.t - pad.b;

    const bw = innerW / Math.max(1, data.length);

    // draw axes
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = "#111827"; ctx.font = "12px system-ui";
    ctx.fillText(title, pad.l, 14);

    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, height - pad.b + 0.5); ctx.lineTo(w - pad.r, height - pad.b + 0.5); ctx.stroke();

    // bars
    const bars: { x: number; y: number; w: number; h: number; label: string; v: number }[] = [];
    data.forEach((d, i) => {
      const h = (d.y / maxY) * innerH;
      const x = pad.l + i * bw + bw*0.15;
      const y = height - pad.b - h;
      const ww = bw * 0.7;
      ctx.fillStyle = "#60a5fa"; // blue-400
      ctx.fillRect(x, y, ww, h);
      ctx.fillStyle = "#6b7280"; ctx.font = "11px system-ui"; ctx.textAlign = "center";
      const label = formatX ? formatX(d.x) : d.x;
      ctx.fillText(label, x + ww/2, height - pad.b + 14);
      bars.push({ x, y, w: ww, h, label, v: d.y });
    });

    // tooltip
    const onMove = (ev: MouseEvent) => {
      const rect2 = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect2.left, my = ev.clientY - rect2.top;
      const hit = bars.find(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
      const tip = tipRef.current!;
      if (hit) {
        tip.style.display = "block"; tip.style.left = ev.clientX + 10 + "px"; tip.style.top = ev.clientY + 10 + "px";
        tip.innerHTML = `${hit.label}<br/><b>${formatY(hit.v)}</b>`;
      } else tip.style.display = "none";
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [data, height, title, formatX, formatY]);

  return (
    <div ref={wrapRef} className="relative rounded-2xl border bg-white p-3">
      <canvas ref={canvasRef} />
      <button
        onClick={() => canvasRef.current && downloadCanvasPNG(canvasRef.current, `${title}.png`)}
        className="absolute right-2 top-2 text-xs px-2 py-0.5 rounded border bg-white hover:bg-gray-50"
      >导出PNG</button>
      <div ref={tipRef} style={{ display: "none" }} className="pointer-events-none absolute z-50 px-2 py-1 rounded bg-black/80 text-white text-[12px] leading-tight" />
    </div>
  );
}

// Horizontal bars
function HBarChart({ title, data, height = 280 }: { title: string; data: Array<{ name: string; value: number }>; height?: number }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const wrap = wrapRef.current; const canvas = canvasRef.current; if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = wrap.getBoundingClientRect(); const w = Math.max(360, Math.floor(rect.width));
    const h = height; const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr); canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.resetTransform(); ctx.scale(dpr, dpr);

    const pad = { l: 120, r: 12, t: 22, b: 10 };
    const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
    const n = data.length; const rowH = innerH / Math.max(1, n);
    const maxV = Math.max(1, ...data.map(d => d.value));

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#111827"; ctx.font = "12px system-ui"; ctx.fillText(title, pad.l, 14);

    data.forEach((d, i) => {
      const y = pad.t + i * rowH + 4; const bw = (d.value / maxV) * innerW;
      ctx.fillStyle = "#e5e7eb"; ctx.fillRect(pad.l, y, innerW, rowH - 8);
      ctx.fillStyle = "#34d399"; ctx.fillRect(pad.l, y, bw, rowH - 8);
      ctx.fillStyle = "#374151"; ctx.textAlign = "right"; ctx.font = "12px system-ui";
      ctx.fillText(d.name, pad.l - 8, y + (rowH - 8) / 2 + 4);
      ctx.textAlign = "left"; ctx.fillText(String(d.value), pad.l + bw + 6, y + (rowH - 8) / 2 + 4);
    });
  }, [data, height, title]);

  return (
    <div ref={wrapRef} className="relative rounded-2xl border bg-white p-3">
      <canvas ref={canvasRef} />
    </div>
  );
}

// Donut chart
function DonutChart({ title, a, b, labels = ["有", "无"], height = 220 }: { title: string; a: number; b: number; labels?: [string, string]; height?: number }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const wrap = wrapRef.current; const canvas = canvasRef.current; if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = wrap.getBoundingClientRect(); const w = Math.max(240, Math.floor(rect.width));
    const h = height; const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr); canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.resetTransform(); ctx.scale(dpr, dpr);

    const cx = w/2, cy = h/2 + 4; const R = Math.min(w, h) * 0.35; const r = R * 0.55;
    const total = Math.max(1, a + b);
    const angleA = (a / total) * Math.PI * 2;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#111827"; ctx.font = "12px system-ui"; ctx.textAlign = "center"; ctx.fillText(title, cx, 16);

    ctx.beginPath(); ctx.fillStyle = "#60a5fa"; ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, -Math.PI/2, -Math.PI/2 + angleA); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.fillStyle = "#e5e7eb"; ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, -Math.PI/2 + angleA, -Math.PI/2 + Math.PI*2); ctx.closePath(); ctx.fill();

    // hole
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // legend
    ctx.fillStyle = "#374151"; ctx.textAlign = "left"; ctx.font = "12px system-ui";
    ctx.fillRect(cx + R + 18, cy - 12, 10, 10); ctx.fillStyle = "#111827"; ctx.fillText(`${labels[0]}：${a}`, cx + R + 34, cy - 3);
    ctx.fillStyle = "#9ca3af"; ctx.fillRect(cx + R + 18, cy + 8, 10, 10); ctx.fillStyle = "#111827"; ctx.fillText(`${labels[1]}：${b}`, cx + R + 34, cy + 17);
  }, [a, b, height, title, labels]);

  return (
    <div ref={wrapRef} className="rounded-2xl border bg-white p-3">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ------------------------- page -------------------------
export default function QualityPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true); setErr(null);
      try {
        // 直接使用现有列表接口，忽略质量 summary 的后端依赖
        const res = await apiGet("/api/v1/papers?dedup=true");
        const arr = Array.isArray(res) ? res : (res?.items || res?.data || []);
        if (mounted) setPapers(arr as Paper[]);
      } catch (e: any) {
        setErr(String(e?.message || e));
      } finally { setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  // 年份直方图（基于 papers 现算；保证在 early return 之前定义）
  const yearData = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of papers) {
      const y = Number((p as any)?.year);
      if (!Number.isFinite(y) || !y) continue;
      m.set(y, (m.get(y) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([y, c]) => ({ x: String(y), y: c }));
  }, [papers]);

  if (loading) return <div className="container py-6">加载中...</div>;
  if (err) return <div className="container py-6 text-red-600">加载失败：{err}</div>;

  const total = papers.length;

  // 直接前端统计缺失字段
  const missingFields = ["abstract", "doi", "year", "venue", "pdf_url"] as const;
  const missingPairs = missingFields.map((k) => [k, papers.reduce((acc, p: any) => acc + ((k === "year" ? !p?.year : !p?.[k]) ? 1 : 0), 0)] as [string, number]);
  const missingSorted = [...missingPairs].sort((a, b) => b[1] - a[1]);

  const covDoi = papers.reduce((n, p: any) => n + (!!p?.doi ? 1 : 0), 0);
  const covPdf = papers.reduce((n, p: any) => n + (!!p?.pdf_url ? 1 : 0), 0);
  const covArxiv = papers.reduce((n, p: any) => n + ((String(p?.doi || "").toLowerCase().includes("arxiv") || String(p?.doi || "").startsWith("10.48550/")) ? 1 : 0), 0);
  const donutBlocks = [
    { title: "DOI 覆盖", a: covDoi, b: Math.max(0, total - covDoi), labels: ["有 DOI", "无 DOI"] as [string, string] },
    { title: "PDF 可用", a: covPdf, b: Math.max(0, total - covPdf), labels: ["有 PDF", "无 PDF"] as [string, string] },
    { title: "arXiv 关联", a: covArxiv, b: Math.max(0, total - covArxiv), labels: ["有 arXiv", "无 arXiv"] as [string, string] },
  ];

  const venueTop = (() => {
    const m = new Map<string, number>();
    for (const p of papers) {
      const v = String((p as any)?.venue || '').trim();
      if (!v) continue; m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12);
  })();

  const authorTop = (() => {
    const m = new Map<string, number>();
    for (const p of papers) {
      for (const a of (p as any)?.authors || []) {
        const name = String(a?.name || '').trim(); if (!name) continue;
        m.set(name, (m.get(name) || 0) + 1);
      }
    }
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 20);
  })();

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">质量面板</h1>
        <span className="text-sm text-gray-500">总记录：{total}</span>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {missingSorted.map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-gray-500">缺失 {k}</div>
            <div className="text-2xl font-semibold mt-1">{v}</div>
            <div className="mt-2 h-1.5 bg-gray-100 rounded">
              <div className="h-1.5 bg-red-400 rounded" style={{ width: `${Math.min(100, (v / Math.max(1, total)) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Coverage donuts */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {donutBlocks.map((b, i) => (
          <DonutChart key={i} title={b.title} a={b.a} b={b.b} labels={b.labels} />
        ))}
      </div>

      {/* Missing fields bar */}
      {missingSorted.length > 0 && (
        <HBarChart
          title="缺失字段概览"
          data={missingSorted.map(([k, v]) => ({ name: k, value: v }))}
        />
      )}

      {/* Year distribution */}
      {yearData.length > 0 && (
        <BarChart title="年份分布" data={yearData} formatX={(x) => x} />
      )}

      {/* Venue & Author top */}
      <div className="grid md:grid-cols-2 gap-4">
        {venueTop.length > 0 && (
          <HBarChart title="会议/期刊 Top" data={venueTop} />
        )}
        {authorTop.length > 0 && (
          <HBarChart title="作者 Top" data={authorTop} />
        )}
      </div>

    </div>
  );
}
