import React from "react";

/** 极轻量：随机点缓慢漂移（30fps cap） */
export default function Particles({ count = 24 }: { count?: number }) {
  const ref = React.useRef<HTMLCanvasElement|null>(null);

  React.useEffect(() => {
    const cvs = ref.current!;
    const ctx = cvs.getContext("2d")!;
    let w = (cvs.width = window.innerWidth), h = (cvs.height = window.innerHeight);
    let running = true; const DPR = Math.min(2, window.devicePixelRatio||1);
    cvs.width = w*DPR; cvs.height = h*DPR; ctx.scale(DPR, DPR);

    const pts = Array.from({length:count}, () => ({
      x: Math.random()*w, y: Math.random()*h,
      vx: (Math.random()-.5)*0.2, vy:(Math.random()-.5)*0.2, r: 1+Math.random()*1.5
    }));

    let last = 0;
    const loop = (t:number) => {
      if(!running) return;
      if (t-last < 33) { requestAnimationFrame(loop); return; } // ~30fps
      last = t; ctx.clearRect(0,0,w,h);
      ctx.fillStyle = "rgba(99,102,241,.35)";
      pts.forEach(p=>{
        p.x += p.vx; p.y += p.vy;
        if (p.x<0||p.x>w) p.vx*=-1; if (p.y<0||p.y>h) p.vy*=-1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
      });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const onResize = () => { w=window.innerWidth; h=window.innerHeight; cvs.width=w*DPR; cvs.height=h*DPR; ctx.scale(DPR,DPR); };
    window.addEventListener("resize", onResize);
    return () => { running=false; window.removeEventListener("resize", onResize); };
  }, [count]);

  return <canvas ref={ref} className="fixed inset-0 -z-10 opacity-40 pointer-events-none" />;
}