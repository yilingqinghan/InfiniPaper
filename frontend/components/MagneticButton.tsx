// frontend/components/MagneticButton.tsx
import React from "react";

export default function MagneticButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>
) {
  const ref = React.useRef<HTMLButtonElement|null>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current!; const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left+r.width/2)) / r.width;
    const dy = (e.clientY - (r.top +r.height/2)) / r.height;
    el.style.transform = `translate(${dx*6}px, ${dy*6}px)`;
    el.style.setProperty("--rx", (e.nativeEvent.offsetX)+"px");
    el.style.setProperty("--ry", (e.nativeEvent.offsetY)+"px");
  };
  const onLeave = () => { const el = ref.current!; el.style.transform = ""; };
  return (
    <button {...props}
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`ripple transition-transform will-change-transform ${props.className||""}`}
    />
  );
}