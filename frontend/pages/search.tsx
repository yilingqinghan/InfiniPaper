import { useState } from "react";
import useSWR from "swr";
import { apiGet } from "@/utils/api";
import PaperCard from "@/components/PaperCard";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const { data } = useSWR(q ? `/api/v1/search?q=${encodeURIComponent(q)}` : null, apiGet);
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-semibold mb-4">搜索论文</h1>
      <input
        className="border rounded-md px-3 py-2 w-full"
        placeholder="输入关键词（标题匹配）"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-6 grid gap-4">
        {data?.map((p: any) => <PaperCard key={p.id} paper={p} />)}
      </div>
    </div>
  );
}