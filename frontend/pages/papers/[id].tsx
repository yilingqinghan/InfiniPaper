import { useRouter } from "next/router";
import useSWR from "swr";
import { apiGet } from "@/utils/api";
import PaperDetail from "@/components/PaperDetail";

export default function PaperDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { data } = useSWR(id ? `/api/v1/papers/${id}` : null, apiGet);
  return (
    <div className="container py-8">
      {data ? <PaperDetail paper={data} /> : <p>加载中...</p>}
    </div>
  );
}