export default function NoteEditor() {
  return (
    <div className="bg-white p-4 rounded-md shadow">
      <textarea className="w-full border rounded-md p-2" rows={8} placeholder="写下你的结构化读书笔记..."></textarea>
      <div className="mt-2 text-right">
        <button className="px-4 py-2 bg-blue-600 text-white rounded-md">保存</button>
      </div>
    </div>
  );
}