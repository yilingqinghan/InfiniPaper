import React from "react";
import { motion } from "framer-motion";
import { Search, UploadCloud, Tags, BookOpen, Sparkles, TrendingUp } from "lucide-react";
import DirectorySidebar from "@/components/DirectorySidebar";
import RecentPapers from "@/components/RecentPapers";
import PaperDetailDialog from "@/components/PaperDetailDialog";
import UploadDropzone from "@/components/UploadDropzone";

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
  const [papers, setPapers] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [currentFolder, setCurrentFolder] = React.useState<number | null>(null);
  const [openId, setOpenId] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL(`${apiBase}/api/v1/papers/`);
      url.searchParams.set("dedup", "true");
      if (currentFolder != null) url.searchParams.set("folder_id", String(currentFolder));
      const r = await fetch(url.toString());
      setPapers(r.ok ? await r.json() : []);
    } finally { setLoading(false); }
  }, [apiBase, currentFolder]);

  React.useEffect(() => { load(); }, [load]);

  const Quick = ({ icon: Icon, text, href }: any) => (
    <a href={href} className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-gray-50 transition">
      <Icon className="w-4 h-4" /><span className="text-sm">{text}</span>
    </a>
  );

  return (
    <>
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border bg-gradient-to-br from-white to-gray-50 p-6">
          <div className="flex items-start justify-between gap-6 flex-col md:flex-row">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                <Sparkles className="w-3.5 h-3.5" /> 学术资料中心 · InfiniPaper
              </div>
              <h1 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">把论文“收、管、找、看、讲”一站式做好</h1>
              <p className="mt-2 text-sm text-gray-600">支持 PDF 导入、目录管理、彩色标签、语义搜索与导出。</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Quick icon={Search} text="搜索" href="/search" />
                <Quick icon={BookOpen} text="论文列表" href="/papers" />
                <Quick icon={Tags} text="标签" href="/tags" />
                <Quick icon={TrendingUp} text="质量面板" href="/quality" />
                <Quick icon={BookOpen} text="目录管理" href="/library" />
              </div>
            </div>
            <div className="w-full md:w-[360px]">
              <UploadDropzone
                folderId={currentFolder}
                onUploaded={load}
                className="rounded-2xl border-dashed border-2 p-4 bg-white"
              >
                <div className="flex items-center gap-2 text-sm">
                  <UploadCloud className="w-4 h-4" /> 拖拽 PDF 到这里，或点击选择（支持多选）
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  自动识别标题/年份/作者/单位/DOI（可用时）{currentFolder != null ? " · 导入到当前目录" : ""}
                </div>
              </UploadDropzone>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4">
          <DirectorySidebar className="hidden md:block" currentFolder={currentFolder} onChangeFolder={(id)=>{setCurrentFolder(id);}} />
          <RecentPapers loading={loading} papers={papers.slice(0, 30)} onOpen={(id)=>setOpenId(id)} onReload={load} />
        </div>
      </div>

      <PaperDetailDialog openId={openId} onClose={()=>setOpenId(null)} onChanged={load} />
    </>
  );
}
