export default function TagSelector() {
  return (
    <div className="flex gap-2 items-center">
      <input className="border rounded-md px-2 py-1" placeholder="添加标签..." />
      <button className="px-3 py-1 bg-gray-800 text-white rounded-md text-sm">添加</button>
    </div>
  );
}