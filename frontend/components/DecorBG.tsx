import React from "react";

export default function DecorBG() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      {/* 极光/mesh */}
      <div className="absolute -top-24 -left-24 w-[600px] h-[600px] rounded-full blur-3xl"
           style={{background:"radial-gradient(closest-side, rgba(99,102,241,.24), transparent 60%)"}} />
      <div className="absolute -bottom-24 -right-24 w-[620px] h-[620px] rounded-full blur-3xl"
           style={{background:"radial-gradient(closest-side, rgba(14,165,233,.22), transparent 60%)"}} />
      {/* 网格 + 噪声 */}
      <div className="absolute inset-0 bg-grid opacity-[.25]" />
      <div className="absolute inset-0 bg-noise" />
      {/* 鼠标 spotlight */}
      <div id="spot" className="absolute inset-0"
           style={{background:"radial-gradient(600px circle at var(--mx,50%) var(--my,50%), rgba(255,255,255,.08), transparent 40%)"}} />
      <script dangerouslySetInnerHTML={{__html:`
        (function(){
          const el = document.getElementById('spot'); if(!el) return;
          window.addEventListener('pointermove', e=>{
            el.style.setProperty('--mx', e.clientX+'px');
            el.style.setProperty('--my', e.clientY+'px');
          }, {passive:true});
        })();
      `}} />
    </div>
  );
}