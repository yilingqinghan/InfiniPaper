import React from "react";

/* --------------------------- dual year slider (non-linear) --------------------------- */
function YearDualSlider({
    start, end, value, onChange,
}: { start: number; end: number; value: [number, number]; onChange: (a: number, b: number) => void }) {
    const [a, b] = value;
    const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
    // 非线性映射（反向）：p ∈ [0,1] -> year = start + (end-start) * sqrt(p)
    // 目的：靠近“现在(end)”更细腻，靠近早年(start)更稀疏
    const pctToYear = (p: number) => Math.round(start + (end - start) * Math.sqrt(p));
    const yearToPct = (y: number) => {
        const r = Math.max(1, (end - start));
        const t = clamp((y - start) / r, 0, 1);
        return t * t; // 反变换：p = ((y-start)/range)^2
    };
    const pMin = Math.round(yearToPct(a) * 100);
    const pMax = Math.round(yearToPct(b) * 100);

    const handleMin = (p: number) => {
        const y = clamp(pctToYear(p / 100), start, b);
        onChange(y, b);
    };
    const handleMax = (p: number) => {
        const y = clamp(pctToYear(p / 100), a, end);
        onChange(a, y);
    };

    const trackSel = `linear-gradient(to right, transparent ${pMin}%, #60a5fa ${pMin}%, #60a5fa ${pMax}%, transparent ${pMax}%)`;

    return (
        <div className="relative w-[260px] h-6">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded bg-slate-200" />
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded pointer-events-none" style={{ background: trackSel }} />

            <input
            type="range" min={0} max={100} value={pMin}
            onChange={(e) => handleMin(Number(e.currentTarget.value))}
            className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none z-20
                        [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:pointer-events-auto
                        [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:pointer-events-auto"
            />
            <input
            type="range" min={0} max={100} value={pMax}
            onChange={(e) => handleMax(Number(e.currentTarget.value))}
            className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none z-30
                        [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:pointer-events-auto
                        [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:pointer-events-auto"
            />
        </div>
    );
}

export default YearDualSlider;