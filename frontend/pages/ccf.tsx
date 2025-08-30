import React from "react";
import DecorBG from "@/components/DecorBG";
import Particles from "@/components/Particles";
import EmbedCcfddl from "@/components/EmbedCcfddl";
import Reveal from "@/components/Reveal";

export default function CCFPage() {
  const [h, setH] = React.useState(900);
  React.useEffect(() => {
    const calc = () => setH(Math.max(700, window.innerHeight - 160)); // 自适应视口高度
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  return (
    <div className="relative">
      <DecorBG />
      <Particles count={18} />
      <div className="max-w-[1200px] mx-auto px-6 xl:px-8 pt-10 pb-10 space-y-6">
        <div className="gradient-border rounded-3xl">
          <div className="glass rounded-3xl p-6">
            <h1 className="display text-3xl font-semibold bg-clip-text text-transparent
               bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-sky-600">
              CCF 推荐会议 / 期刊截止
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              点击标题可直达官网；时间已按本地时区显示（“早/晚X点”）。
            </p>
          </div>
        </div>

        <Reveal>
          <EmbedCcfddl height={h} />
        </Reveal>
      </div>
    </div>
  );
}