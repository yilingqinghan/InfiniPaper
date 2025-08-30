// frontend/components/TiltCard.tsx
import React from "react";
export default function TiltCard({children, className=""}:{children:React.ReactNode; className?:string}) {
  const ref = React.useRef<HTMLDivElement|null>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current!; const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left+r.width/2)) / r.width;
    const dy = (e.clientY - (r.top +r.height/2)) / r.height;
    el.style.transform = `rotateX(${ -dy*6 }deg) rotateY(${ dx*8 }deg) translateZ(0)`;
  };
  return (
    <div ref={ref}
      onMouseMove={onMove}
      onMouseLeave={()=>{ if(ref.current) ref.current.style.transform=""; }}
      className={`[transform-style:preserve-3d] transition-transform ${className}`}
    >{children}</div>
  );
}