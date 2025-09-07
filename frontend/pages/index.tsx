import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Search, UploadCloud, Tags, BookOpen, Sparkles, TrendingUp, ChevronRight, Wand2, Palette, CalendarClock, CreditCard } from "lucide-react";
import DirectorySidebar from "@/components/DirectorySidebar";
import RecentPapers from "@/components/RecentPapers";
import PaperDetailDialog from "@/components/Library/PaperDetailDialog";
import UploadDropzone from "@/components/UploadDropzone";

import DecorBG from "@/components/DecorBG";
import Particles from "@/components/Particles";
import MagneticButton from "@/components/MagneticButton";
import TiltCard from "@/components/TiltCard";
import Reveal from "@/components/Reveal";
import Skeleton from "@/components/Skeleton";
import { fireConfetti } from "@/utils/confetti";

type Tab = { key: string; label: string; href: string; icon: React.ComponentType<any>; grad: string };

const TABS: Tab[] = [
  { key: "search",  label: "搜索",     href: "/search",  icon: Search,     grad: "from-sky-500 to-cyan-400" },
  { key: "ccf",     label: "CCF 截止", href: "/ccf",     icon: CalendarClock, grad: "from-sky-500 to-violet-500" },
  { key: "library", label: "论文列表", href: "/library", icon: BookOpen,   grad: "from-indigo-500 to-fuchsia-500" },
  { key: "import",  label: "导入",     href: "/library?import=1", icon: UploadCloud, grad: "from-emerald-500 to-lime-400" },
  { key: "tags",    label: "标签",     href: "/tags",    icon: Tags,       grad: "from-rose-500 to-orange-500" },
  { key: "quality", label: "质量面板", href: "/quality", icon: TrendingUp, grad: "from-violet-500 to-indigo-400" },
  { key: "cards", label: "论文卡片", href: "/cards", icon: CreditCard, grad: "from-silver-500 to-indigo-400" },
];

function AuroraBG({ enabled = true }: { enabled?: boolean }) {
  const reduce = useReducedMotion();
  const pulse = (reduce || !enabled) ? "" : "animate-pulse";
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* lighter blobs (smaller + less blur + optional animation) */}
      <div className={`absolute -top-28 -left-32 w-[420px] h-[420px] bg-gradient-to-br from-indigo-400/25 to-fuchsia-400/20 blur-xl rounded-full ${pulse}`} />
      <div className={`absolute -bottom-24 -right-24 w-[420px] h-[420px] bg-gradient-to-tr from-sky-400/20 to-emerald-400/20 blur-xl rounded-full ${pulse}`} />
      {/* removed the spinning conic gradient to avoid continuous GPU repaint */}
    </div>
  );
}

function FancyTabs() {
  const [hover, setHover] = React.useState<string | null>(null);
  return (
    <div className="relative inline-flex items-center gap-1.5 p-1 rounded-2xl border bg-white/70 backdrop-blur shadow-sm max-w-full flex-nowrap overflow-x-auto">
      {TABS.map((t) => {
        const Icon = t.icon as any;
        const active = hover === t.key;
        return (
          <a
            key={t.key}
            href={t.href}
            className="relative inline-flex shrink-0 group"
            onMouseEnter={() => setHover(t.key)}
            onMouseLeave={() => setHover(null)}
          >
            <AnimatePresence>
              {active && (
                <motion.div
                  layoutId="tab-pill"
                  className={`absolute inset-0 rounded-xl bg-gradient-to-r ${t.grad} shadow-sm`}
                  initial={{ opacity: 0.0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </AnimatePresence>
            <div
              className={`relative z-10 flex items-center gap-1.5 px-3 py-2 rounded-xl transition-colors whitespace-nowrap ${
                active ? "text-white" : "text-gray-900 hover:text-gray-900"
              }`}
            >
              <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="text-xs md:text-sm font-medium">{t.label}</span>
              <ChevronRight className={`w-3.5 h-3.5 flex-none ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition`} />
            </div>
          </a>
        );
      })}
    </div>
  );
}

function StatBadge({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-xs text-gray-700 bg-white/60 backdrop-blur px-2.5 py-1 rounded-full border shadow-sm">
      <Icon className="w-3.5 h-3.5 text-indigo-500" />
      <span>{text}</span>
    </div>
  );
}

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
  const [papers, setPapers] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [currentFolder, setCurrentFolder] = React.useState<number | null>(null);
  const [openId, setOpenId] = React.useState<number | null>(null);
  // site-wide (page-level) motion toggle; default on, persisted in localStorage
  const [motionOn, setMotionOn] = React.useState<boolean>(true);
  React.useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('ip_motion_on') : null;
      if (saved !== null) setMotionOn(saved === '1');
    } catch {}
  }, []);
  React.useEffect(() => {
    try { if (typeof window !== 'undefined') window.localStorage.setItem('ip_motion_on', motionOn ? '1' : '0'); } catch {}
  }, [motionOn]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL(`${apiBase}/api/v1/papers/`);
      url.searchParams.set("dedup", "true");
      if (currentFolder != null) url.searchParams.set("folder_id", String(currentFolder));
      const r = await fetch(url.toString());
      setPapers(r.ok ? await r.json() : []);
    } finally {
      setLoading(false);
    }
  }, [apiBase, currentFolder]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className={`relative ${motionOn ? '' : 'no-motion'}`}>
        <AuroraBG enabled={motionOn} />
        <div className="max-w-[1400px] mx-auto px-6 xl:px-8 pt-10 pb-6 space-y-8">
          {/* HERO */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="relative overflow-hidden rounded-3xl border bg-white/80 backdrop-blur-sm p-6 shadow-sm"
          >
            {/* glow stripe */}
            <div className="pointer-events-none absolute -inset-x-10 -top-10 h-20 bg-gradient-to-r from-fuchsia-400/30 via-indigo-400/30 to-sky-400/30 blur-2xl" />
            <div className="flex items-start justify-between gap-8 flex-col md:flex-row">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded-full border border-blue-200 shadow-sm">
                  <Sparkles className="w-3.5 h-3.5" /> 学术资料中心 · InfiniPaper
                </div>
                <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-sky-600">
                  一站式论文管理套件 by 逸翎清晗
                </h1>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatBadge icon={Search} text="语义搜索" />
                  <StatBadge icon={UploadCloud} text="PDF 导入与解析" />
                  <StatBadge icon={Tags} text="彩色标签" />
                  <StatBadge icon={TrendingUp} text="质量面板" />
                  <StatBadge icon={Palette} text="美观的可视化" />
                  <StatBadge icon={Wand2} text="自动化小助手" />
                </div>
                <div className="mt-3 flex items-center gap-4">
                  <div className="inline-flex items-center gap-2 text-xs text-gray-600 select-none">
                    <span>动画</span>
                    <button
                      onClick={() => setMotionOn(v => !v)}
                      aria-pressed={motionOn}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${motionOn ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-gray-300'}`}
                      title={motionOn ? '点击关闭动画' : '点击开启动画'}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${motionOn ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  <FancyTabs />
                </div>
              </div>

              {/* Upload card */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="w-full md:w-[340px] xl:w-[360px] relative"
              >
                <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-sky-400 opacity-60 blur" />
                <UploadDropzone
                  folderId={currentFolder}
                  onUploaded={load}
                  className="relative rounded-2xl border p-4 bg-white/90 backdrop-blur shadow-sm"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <UploadCloud className="w-4 h-4 text-indigo-600" /> 拖拽 PDF 到这里，或点击选择（支持多选）
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    自动识别标题/年份/作者/单位/DOI{currentFolder != null ? " · 导入到当前目录" : ""}
                  </div>
                </UploadDropzone>
              </motion.div>
            </div>

            {/* marquee of venues */}
            <div className="mt-6 overflow-hidden">
              <div className={`whitespace-nowrap will-change-transform ${motionOn ? 'marquee' : ''} text-xs text-gray-500`}>
                {["MICRO","ISCA","PLDI","ASPLOS","DAC","TACO","TODAES","NeurIPS","ICML","CVPR","ICCV","ECCV","VLDB","SIGMOD","WWW","SC","SIGGRAPH"]
                  .concat(["MICRO","ISCA","PLDI","ASPLOS","DAC","TACO","TODAES","NeurIPS","ICML","CVPR","ICCV","ECCV","VLDB","SIGMOD","WWW","SC","SIGGRAPH"])
                  .map((v, i) => (
                    <span key={v + i} className="inline-flex items-center mx-3 px-2 py-1 rounded-md border bg-white/70 backdrop-blur">
                      {v}
                    </span>
                  ))}
              </div>
            </div>
          </motion.div>

          {/* CONTENT */}
          <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4">
            <DirectorySidebar className="hidden md:block" currentFolder={currentFolder} onChangeFolder={(id)=>{setCurrentFolder(id);}} />
            <RecentPapers loading={loading} papers={papers.slice(0, 30)} onOpen={(id)=>setOpenId(id)} onReload={load} />
          </div>
        </div>
      </div>

      <PaperDetailDialog openId={openId} onClose={()=>setOpenId(null)} onChanged={load} />

      <style jsx global>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .marquee { animation: marquee 26s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .marquee { animation: none !important; } }
        /* Hard no-motion mode triggered by wrapper class */
        .no-motion *, .no-motion *::before, .no-motion *::after { animation: none !important; transition: none !important; }
      `}</style>
    </>
  );
}
