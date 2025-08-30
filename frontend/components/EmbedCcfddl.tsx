// frontend/components/EmbedCcfddl.tsx
import React from "react";

export default function EmbedCcfddl({ height = 820, className = "" }:{
  height?: number; className?: string;
}) {
  const ref = React.useRef<HTMLIFrameElement|null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 同源，尝试自动高度（若内部有路由切换，定时读取 scrollHeight）
    let t = window.setInterval(() => {
      try {
        const doc = el.contentDocument || el.contentWindow?.document;
        const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight;
        if (h && Math.abs(el.style.height.replace('px','') as any - h) > 8) {
          el.style.height = `${Math.min(Math.max(h, 600), 1600)}px`; // 600~1600 自适应
        }
      } catch { /* 跨域则忽略（我们是同源就没事） */ }
    }, 500);
    return () => { window.clearInterval(t); };
  }, []);

  return (
    <div className={`gradient-border rounded-3xl ${className}`}>
      <div className="glass rounded-3xl overflow-hidden">
        <iframe
          ref={ref}
          src="/ccfddl/index.html"
          style={{ width: "100%", height }}
          className="border-0"
          // sandbox 可按需收紧： 'allow-scripts allow-same-origin' 足够运行大多数前端
          // sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}