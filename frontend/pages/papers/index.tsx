// frontend/pages/index.tsx
import React from "react";
import { motion } from "framer-motion";
import {
  Search, UploadCloud, Tags, BookOpen, Sparkles, TrendingUp, FolderKanban, Link as LinkIcon, IdCard
} from "lucide-react";
import DirectorySidebar from "@/components/DirectorySidebar";
import RecentPapers from "@/components/RecentPapers";
import PaperDetailDialog from "@/components/Library/PaperDetailDialog";
import UploadDropzone from "@/components/UploadDropzone";

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

  const [papers, setPapers] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [currentFolder, setCurrentFolder] = React.useState<number | null>(null);
  const [openId, setOpenId] = React.useState<number | null>(null);

  // 统计
  const [stats, setStats] = React.useState({
    papers: 0,
    authors: 0,
    tags: 0,
    pdf: 0,
  });

  const loadList = React.useCallback(async () => {
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

  const loadStats = React.useCallback(async () => {
    try {
      const all = await fetch(`${apiBase}/api/v1/papers/?dedup=true`).then(r => r.ok ? r.json() : []);
      const authorSet = new Set<string | number>();
      let pdf = 0;
      for (const p of all) {
        if (p?.pdf_url) pdf += 1;
        (p?.authors || []).forEach((a: any) => authorSet.add(a?.id ?? a?.name));
      }
      let tagsCount = 0;
      try {
        const ts = await fetch(`${apiBase}/api/v1/tags/`).then(r => r.ok ? r.json() : []);
        tagsCount = Array.isArray(ts) ? ts.length : 0;
      } catch {}
      setStats({ papers: all.length, authors: authorSet.size, tags: tagsCount, pdf });
    } catch {
      setStats({ papers: 0, authors: 0, tags: 0, pdf: 0 });
    }
  }, [apiBase]);

  React.useEffect(() => { loadList(); }, [loadList]);
  React.useEffect(() => { loadStats(); }, [loadStats]);

  const Quick = ({ icon: Icon, text, href }: any) => (
    <a href={href} className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-gray-50 transition">
      <Icon className="w-4 h-4" /><span className="text-sm">{text}</span>
    </a>
  );

  return (
    <>
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Hero + 快速导航 + 上传 */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border bg-gradient-to-br from-white to-gray-50 p-6">
          <div className="flex items-start justify-between gap-6 flex-col md:flex-row">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                <Sparkles className="w-3.5 h-3.5" /> 学术资料中心 · InfiniPaper
              </div>
              <h1 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
                把论文“收、管、找、看、讲”一站式做好
              </h1>
              <p className="mt-2 text-sm text-gray-600">
                支持 PDF 导入、目录管理、彩色标签、语义搜索与导出。
              </p>

              {/* 快速导航 */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Quick icon={Search} text="搜索" href="/search" />
                <Quick icon={BookOpen} text="论文列表" href="/papers" />
                <Quick icon={FolderKanban} text="目录管理" href="/library" />
                <Quick icon={Tags} text="标签" href="/tags" />
                <Quick icon={TrendingUp} text="质量面板" href="/quality" />
                <Quick icon={IdCard} text="论文卡片" href="/cards" />
              </div>
            </div>

            {/* 上传区 */}
            <div className="w-full md:w-[360px]">
              <UploadDropzone
                folderId={currentFolder}
                onUploaded={() => { loadList(); loadStats(); }}
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

        {/* 数据统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="论文总数" value={stats.papers} />
          <StatCard title="作者人数" value={stats.authors} />
          <StatCard title="标签数" value={stats.tags} />
          <StatCard title="PDF 可用" value={stats.pdf} />
        </div>

        {/* 主体：目录 + 最近导入 */}
        <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4">
          <DirectorySidebar
            className="hidden md:block"
            currentFolder={currentFolder}
            onChangeFolder={(id) => { setCurrentFolder(id); loadList(); }}
          />
          <RecentPapers
            loading={loading}
            papers={papers.slice(0, 30)}
            onOpen={(id) => setOpenId(id)}
            onReload={() => { loadList(); loadStats(); }}
          />
        </div>
      </div>

      {/* 右侧常用链接浮窗（顶会/站点） */}
      <div className="fixed right-4 bottom-4 hidden md:block">
        <div className="rounded-2xl border bg-white shadow-md p-3 w-56">
          <div className="text-xs mb-2 text-gray-600 flex items-center gap-1">
            <LinkIcon className="w-3.5 h-3.5" /> 常用链接
          </div>
          <div className="space-y-1 text-sm">
            <a className="block hover:text-blue-600" href="https://arxiv.org" target="_blank">arXiv</a>
            <a className="block hover:text-blue-600" href="https://openreview.net" target="_blank">OpenReview</a>
            <a className="block hover:text-blue-600" href="https://dl.acm.org" target="_blank">ACM DL</a>
            <a className="block hover:text-blue-600" href="https://ieeexplore.ieee.org" target="_blank">IEEE Xplore</a>
            <a className="block hover:text-blue-600" href="https://scholar.google.com" target="_blank">Google Scholar</a>
          </div>
        </div>
      </div>

      <PaperDetailDialog openId={openId} onClose={() => setOpenId(null)} onChanged={() => { loadList(); loadStats(); }} />
    </>
  );
}

/* ---------------- components in-file ---------------- */

function StatCard({ title, value }: { title: string; value: number | string }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value ?? 0}</div>
    </div>
  );
}
