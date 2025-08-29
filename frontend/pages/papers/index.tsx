import useSWR from "swr";
import Link from "next/link";
import { apiGet } from "@/utils/api";
import PaperCard from "@/components/PaperCard";

export default function PaperList() {
  const { data } = useSWR("/api/v1/papers", apiGet);
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-semibold mb-4">论文列表</h1>
      <div className="grid gap-4">
        {data?.map((p: any) => (
          <Link key={p.id} href={`/papers/${p.id}`}>
            <PaperCard paper={p} />
          </Link>
        ))}
      </div>
    </div>
  );
}