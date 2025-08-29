export default function PaperDetail({ paper }: { paper: any }) {
  return (
    <div className="bg-white p-6 rounded-md shadow">
      <h1 className="text-2xl font-bold mb-2">{paper.title}</h1>
      <div className="text-gray-600">{paper.venue || "未知 venue"} · {paper.year || "年份未知"}</div>
      {paper.doi && (
        <div className="mt-2">
          <a className="text-blue-600" href={`https://doi.org/${paper.doi}`} target="_blank">DOI: {paper.doi}</a>
        </div>
      )}
      {paper.abstract && <p className="mt-4 whitespace-pre-wrap">{paper.abstract}</p>}
    </div>
  );
}