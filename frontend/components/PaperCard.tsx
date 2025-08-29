export default function PaperCard({ paper }: { paper: any }) {
  return (
    <div className="bg-white rounded-md shadow p-4 hover:shadow-md transition">
      <div className="font-semibold">{paper.title}</div>
      <div className="text-sm text-gray-600">{paper.venue || "未知 venue"} · {paper.year || "年份未知"}</div>
      {paper.abstract && <p className="text-sm mt-2 line-clamp-2">{paper.abstract}</p>}
    </div>
  );
}