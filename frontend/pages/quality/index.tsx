import { useEffect, useState } from "react";
import { apiGet } from "@/utils/api";

export default function QualityPage() {
  const [data, setData] = useState<any>(null);
  useEffect(()=>{
    apiGet("/api/v1/quality/summary").then(setData);
  }, []);
  if (!data) return <div className="container py-6">加载中...</div>;
  const miss = data.missing || {};
  return (
    <div className="container py-6">
      <h1 className="text-2xl font-semibold mb-4">质量面板</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(miss).map(([k, v]: any) => (
          <div key={k} className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-gray-500">缺失 {k}</div>
            <div className="text-2xl font-semibold mt-1">{v.length}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-gray-600 mt-6">总记录：{data.total}</p>
    </div>
  );
}
