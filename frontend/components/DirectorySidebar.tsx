import React from "react";
import { motion } from "framer-motion";
import { FolderTree, Plus, ChevronRight, ChevronDown } from "lucide-react";
import SwalCore from "sweetalert2";
import withReactContent from "sweetalert2-react-content";

const Swal = withReactContent(SwalCore);

type Folder = {
  id: number;
  name: string;
  color?: string | null;
  priority?: number | null;
  parent_id?: number | null;
};

function buildTree(items: Folder[]) {
  const map = new Map<number, any>();
  const roots: any[] = [];
  items.forEach((it) => map.set(it.id, { ...it, children: [] }));
  items.forEach((it) => {
    const node = map.get(it.id);
    if (it.parent_id && map.get(it.parent_id)) {
      map.get(it.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

export default function DirectorySidebar({
  currentFolder,
  onChangeFolder,
  className = "",
}: {
  currentFolder?: number | null;
  onChangeFolder?: (id: number | null) => void;
  className?: string;
}) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
  const [folders, setFolders] = React.useState<Folder[]>([]);
  const [open, setOpen] = React.useState<Record<number, boolean>>({});

  const load = React.useCallback(async () => {
    const r = await fetch(`${apiBase}/api/v1/folders/`);
    if (r.ok) setFolders(await r.json());
  }, [apiBase]);

  React.useEffect(() => {
    load();
  }, [load]);

  const createFolder = async () => {
    const { value: name } = await Swal.fire({
      title: "新建目录",
      input: "text",
      inputLabel: "目录名称",
      inputPlaceholder: "例如：组会/方法/综述",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      showCancelButton: true,
      customClass: {
        popup: "rounded-2xl",
        confirmButton: "swal2-confirm !rounded-xl",
        cancelButton: "swal2-cancel !rounded-xl",
      },
    });
    if (!name) return;
    await fetch(`${apiBase}/api/v1/folders/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    load();
  };

  const TreeNode = ({ node, depth = 0 }: { node: any; depth?: number }) => {
    const hasChildren = node.children && node.children.length > 0;
    const expanded = open[node.id] ?? true;
    const colorDot = node.color || "#CBD5E1";
    return (
      <div>
        <div
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer ${currentFolder === node.id ? "bg-gray-50" : ""}`}
          onClick={() => onChangeFolder?.(node.id)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); if (hasChildren) setOpen({ ...open, [node.id]: !expanded }); }}
            className="w-5 h-5 flex items-center justify-center"
            title={expanded ? "收起" : "展开"}
          >
            {hasChildren ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <span className="w-4 h-4" />}
          </button>
          <span className="w-2 h-2 rounded-full" style={{ background: colorDot }} />
          <span className="text-sm truncate" title={node.name}>{node.name}</span>
        </div>
        {hasChildren && expanded && (
          <div className="ml-5">
            {node.children.map((c: any) => <TreeNode key={c.id} node={c} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  };

  const tree = buildTree(folders);

  return (
    <aside className={`${className} sticky top-20`}>
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-gray-600 flex items-center gap-2">
            <FolderTree className="w-4 h-4" />
            目录
          </div>
          <button onClick={createFolder} className="text-xs px-2 py-1 rounded-lg border hover:bg-gray-50 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> 新建
          </button>
        </div>

        <div className="space-y-1">
          <button
            onClick={() => onChangeFolder?.(null)}
            className={`w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 ${currentFolder == null ? "bg-gray-50" : ""}`}
          >
            全部
          </button>
          {tree.map((n) => <TreeNode key={n.id} node={n} />)}
        </div>
      </motion.div>
    </aside>
  );
}
