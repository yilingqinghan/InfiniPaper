import useSWR from "swr";
import { apiGet } from "@/utils/api";
import Link from "next/link";

export default function TagList() {
  const { data } = useSWR("/api/v1/tags", apiGet);
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-semibold mb-4">标签</h1>
      <ul className="list-disc pl-6">
        {data?.map((t: any) => (
          <li key={t.id}><Link href={`/tags/${encodeURIComponent(t.name)}`}>{t.name}</Link></li>
        ))}
      </ul>
    </div>
  );
}