import React from "react";
import { motion } from "framer-motion";
import {
  Search,
  UploadCloud,
  Tags,
  BookOpen,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import UploadDropzone from "@/components/UploadDropzone";
import StatsCards, { StatsData } from "@/components/StatsCards";
import RecentPapers from "@/components/RecentPapers";
import DirectorySidebar from "@/components/DirectorySidebar";
import QuickLinksDock from "@/components/QuickLinksDock";

type PaperItem = any;

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

  const [papers, setPapers] = React.useState<PaperItem[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [stats, setStats] = React.useState<StatsData>({
    papers: 0,
    authors: 0,
    tags: 0,
    withPDF: 0,
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL(`${apiBase}/api/v1/papers/`);
      url.searchParams.set("dedup", "true");
      const r = await fetch(url.toString());
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: PaperItem[] = await r.json();
      setPapers(data);

      const authors = new Set<string>();
      const tags = new Set<number>();
      let withPDF = 0;
      data.forEach((p) => {
        (p.authors || []).forEach((a: any) => a?.name && authors.add(a.name));
        (p.tag_ids || []).forEach((t: number) => tags.add(t));
        if (p.pdf_url) withPDF += 1;
      });
      setStats({
        papers: data.length,
        authors: authors.size,
        tags: tags.size,
        withPDF,
      });
    } catch {
      setPapers([]);
      setStats({ papers: 0, authors: 0, tags: 0, withPDF: 0 });
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  React.useEffect(() => {
    load();
  }, [load]);

  const QuickButton = ({
    icon: Icon,
    text,
    href,
  }: { icon: any; text: string; href: string }) => (
    <a
      href={href}
      className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-gray-50 transition"
    >
      <Icon className="w-4 h-4" />
      <span className="text-sm">{text}</span>
    </a>
  );

  const handleSelect = (payload: any) => {
    // 先简单跳转到对应页面；后续可在首页中部联动筛选
    if (payload.type === "tag" && payload.value) {
      window.location.href = `/papers?tag_id=${payload.value.id}`;
    } else if (payload.type === "withpdf") {
      window.location.href = `/papers?has_pdf=1`;
    } else if (payload.type === "withoutpdf") {
      window.location.href = `/papers?has_pdf=0`;
    } else if (payload.type === "recent") {
      window.location.href = `/papers?sort=created_desc`;
    } else if (payload.type === "favorite") {
      window.location.href = `/papers?fav=1`;
    } else {
      window.location.href = `/papers`;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* 顶部 Hero + 上传 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border bg-gradient-to-br from-white to-gray-50 p-6"
      >
        <div className="flex items-start justify-between gap-6 flex-col md:flex-row">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
              <Sparkles className="w-3.5 h-3.5" />
              学术资料中心 · InfiniPaper
            </div>
            <h1 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
              把论文“收、管、找、看、讲”一站式做好
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              支持 PDF 导入、元数据自动补全、标签/主题、语义搜索与导出。
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <QuickButton icon={Search} text="搜索" href="/search" />
              <QuickButton icon={BookOpen} text="论文列表" href="/papers" />
              <QuickButton icon={Tags} text="标签" href="/tags" />
              <QuickButton icon={TrendingUp} text="质量面板" href="/quality" />
            </div>
          </div>

          <div className="w-full md:w-[360px]">
            <UploadDropzone
              onUploaded={load}
              className="rounded-2xl border-dashed border-2 p-4 bg-white"
            >
              <div className="flex items-center gap-2 text-sm">
                <UploadCloud className="w-4 h-4" />
                拖拽 PDF 到这里，或点击选择
              </div>
              <div className="text-xs text-gray-500 mt-1">
                自动识别标题/年份/作者/单位/DOI（可用时）
              </div>
            </UploadDropzone>
          </div>
        </div>
      </motion.div>

      <StatsCards loading={loading} stats={stats} />

      {/* 三栏布局：左目录 + 中内容 */}
      <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4">
        <DirectorySidebar className="hidden md:block" papers={papers} onSelect={handleSelect} />
        <RecentPapers loading={loading} papers={papers.slice(0, 8)} onReload={load} />
      </div>

      {/* 右下角浮动链接面板（可拖拽） */}
      <QuickLinksDock />
    </div>
  );
}
