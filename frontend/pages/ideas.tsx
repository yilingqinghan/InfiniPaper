import React from "react";

/**
 * Ideas 管理页（本地存储后端的 /api/v1/ideas）
 * - 增：新建想法
 * - 删：删除想法
 * - 改：编辑想法
 * - 查：列表、搜索、过滤、排序、分页
 * 纯 TSX，自带 Modal/Toast，无第三方依赖；样式使用 Tailwind。
 */

type Idea = {
  id: number;
  title: string;
  description: string;
  priority: 1 | 2 | 3 | 4 | 5;
  feasibility_proved: boolean;
  estimated_minutes: number;
  planned_conferences: string[];
  created_at: string; // ISO
  updated_at: string; // ISO
};

type IdeaListOut = {
  items: Idea[];
  total: number;
  page: number;
  page_size: number;
};

const API_ROOT = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
const API_BASE = `${API_ROOT}/api/v1/ideas`;

// --------------------------- 小工具 ---------------------------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    // 只读一次 body，避免“body stream already read”
    let detail = "";
    try {
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        detail = (j && (j.detail || j.message)) ? (j.detail || j.message) : text;
      } catch {
        detail = text;
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail || res.statusText);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

function fmtMinutes(m: number): string {
  const d = m / 1440; // 60 * 24
  const rounded = Math.round(d * 10) / 10;
  return `${rounded.toFixed(rounded % 1 ? 1 : 0)} 天`;
}

function cls(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function toQuery(params: Record<string, any>) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    usp.set(k, String(v));
  });
  const q = usp.toString();
  return q ? `?${q}` : "";
}

// --------------------------- Toast ---------------------------

type ToastItem = { id: number; text: string; type?: "info" | "success" | "error" };
function useToasts() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const push = React.useCallback((text: string, type: ToastItem["type"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((arr) => [...arr, { id, text, type }]);
    setTimeout(() => setItems((arr) => arr.filter((t) => t.id !== id)), 2400);
  }, []);
  const Toasts = React.useCallback(
    () => (
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cls(
              "px-3 py-2 rounded-md shadow text-sm text-white",
              t.type === "success" && "bg-emerald-600",
              t.type === "error" && "bg-rose-600",
              (!t.type || t.type === "info") && "bg-gray-800"
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    ),
    [items]
  );
  return { push, Toasts };
}

// --------------------------- Modal ---------------------------

function Modal(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={props.onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl border border-gray-100">
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <h3 className="text-lg font-semibold">{props.title}</h3>
            <button
              onClick={props.onClose}
              className="rounded-md p-1 hover:bg-gray-100"
              aria-label="Close"
              title="关闭"
            >
              ✕
            </button>
          </div>
          <div className="px-5 py-4 max-h-[70vh] overflow-auto">{props.children}</div>
          <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl flex justify-end gap-2">{props.footer}</div>
        </div>
      </div>
    </div>
  );
}

// --------------------------- 表单 ---------------------------

type IdeaFormState = {
  title: string;
  description: string;
  priority: 1 | 2 | 3 | 4 | 5;
  feasibility_proved: boolean;
  estimated_minutes: number;
  planned_conferences: string[];
  planned_conferences_text?: string;
};

function IdeaForm(props: {
  value: IdeaFormState;
  onChange: (v: IdeaFormState) => void;
}) {
  const v = props.value;
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">一句话标题</label>
        <input
          className="w-full rounded-md border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="新的论文..."
          value={v.title}
          maxLength={120}
          onChange={(e) => props.onChange({ ...v, title: e.target.value })}
        />
        <div className="text-xs text-gray-400 mt-1">{v.title.length}/120</div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
        <textarea
          className="w-full rounded-md border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          rows={5}
          placeholder=""
          value={v.description}
          maxLength={4000}
          onChange={(e) => props.onChange({ ...v, description: e.target.value })}
        />
        <div className="text-xs text-gray-400 mt-1">{v.description.length}/4000</div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">计划投稿的会议（多个）</label>
        <input
          className="w-full rounded-md border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="例如：ASPLOS, PLDI, CGO"
          value={v.planned_conferences_text ?? v.planned_conferences.join(", ")}
          onChange={(e) => {
            const raw = e.target.value;
            const parts = raw
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean);
            props.onChange({ ...v, planned_conferences_text: raw, planned_conferences: parts });
          }}
          onBlur={() => {
            const normalized = (v.planned_conferences_text ?? "")
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .join(", ");
            const parts = normalized
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean);
            props.onChange({ ...v, planned_conferences_text: normalized, planned_conferences: parts });
          }}
        />
        <div className="text-xs text-gray-400 mt-1">用逗号分隔多个会议（英文或中文逗号均可），例如：ASPLOS, PLDI</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">优先级</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={cls(
                  "flex-1 py-1.5 rounded-md border text-sm",
                  v.priority === n
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-gray-300 hover:bg-gray-50"
                )}
                onClick={() => props.onChange({ ...v, priority: n as any })}
                title={`优先级 ${n}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">可行性已论证？</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => props.onChange({ ...v, feasibility_proved: !v.feasibility_proved })}
              className={cls(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-md border",
                v.feasibility_proved ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-gray-300 hover:bg-gray-50"
              )}
            >
              <span className="text-lg">{v.feasibility_proved ? "✅" : "⬜️"}</span>
              <span>{v.feasibility_proved ? "已论证" : "未论证"}</span>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">预计投入（天）</label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={Number.isFinite(v.estimated_minutes) ? Math.round((v.estimated_minutes / 1440) * 10) / 10 : 0}
            onChange={(e) => {
              const days = Math.max(0, Number(e.target.value || 0));
              const minutes = Math.round(days * 1440);
              props.onChange({ ...v, estimated_minutes: minutes });
            }}
            className="w-full rounded-md border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <div className="text-xs text-gray-500 mt-1">≈ {fmtMinutes(v.estimated_minutes)}</div>
        </div>
      </div>
    </div>
  );
}

// --------------------------- 主页面 ---------------------------

export default function IdeasPage() {
  const { push, Toasts } = useToasts();

  // 查询/过滤/分页/排序
  const [q, setQ] = React.useState("");
  const [prioritySet, setPrioritySet] = React.useState<Set<number>>(new Set()); // 选中则过滤
  const [feasible, setFeasible] = React.useState<"all" | "true" | "false">("all");
  const [timeMin, setTimeMin] = React.useState<number | "">("");
  const [timeMax, setTimeMax] = React.useState<number | "">("");
  const [sort, setSort] = React.useState<string>("-updated_at");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);

  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<IdeaListOut>({ items: [], total: 0, page: 1, page_size: 20 });
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  // 新建/编辑 Modal
  const [editing, setEditing] = React.useState<Idea | null>(null);
  const [form, setForm] = React.useState<IdeaFormState>({
    title: "",
    description: "",
    priority: 3,
    feasibility_proved: false,
    estimated_minutes: 60,
    planned_conferences: [],
    planned_conferences_text: "",
  });
  const [open, setOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        page_size: pageSize,
        sort,
      };
      if (q.trim()) params.q = q.trim();
      if (prioritySet.size) params.priority = Array.from(prioritySet).join(",");
      if (feasible !== "all") params.feasible = feasible === "true";
      if (timeMin !== "") params.time_min = Math.round(Number(timeMin) * 1440);
      if (timeMax !== "") params.time_max = Math.round(Number(timeMax) * 1440);
      const res = await api<IdeaListOut>(`${API_BASE}${toQuery(params)}`);
      setData(res);
    } catch (err: any) {
      push(`加载失败：${err.message || err}`, "error");
    } finally {
      setLoading(false);
    }
  }, [q, prioritySet, feasible, timeMin, timeMax, sort, page, pageSize, push]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  function openCreate() {
    setEditing(null);
    setForm({ title: "", description: "", priority: 3, feasibility_proved: false, estimated_minutes: 60, planned_conferences: [], planned_conferences_text: "" });
    setOpen(true);
  }

  function openEdit(it: Idea) {
    setEditing(it);
    setForm({
      title: it.title,
      description: it.description,
      priority: it.priority,
      feasibility_proved: it.feasibility_proved,
      estimated_minutes: it.estimated_minutes,
      planned_conferences: it.planned_conferences || [],
      planned_conferences_text: (it.planned_conferences || []).join(", "),
    });
    setOpen(true);
  }

  async function submit() {
    try {
      if (!form.title.trim()) {
        push("标题(方向)不能为空", "error");
        return;
      }
      if (editing) {
        const payload: Partial<Idea> = {
          title: form.title.trim(),
          description: form.description,
          priority: form.priority,
          feasibility_proved: form.feasibility_proved,
          estimated_minutes: form.estimated_minutes,
          planned_conferences: form.planned_conferences,
        };
        const updated = await api<Idea>(`${API_BASE}/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        push("已更新", "success");
        setOpen(false);
        // 局部替换
        setData((d) => ({ ...d, items: d.items.map((x) => (x.id === updated.id ? updated : x)) }));
      } else {
        const created = await api<Idea>(`${API_BASE}`, {
          method: "POST",
          body: JSON.stringify({
            title: form.title.trim(),
            description: form.description,
            priority: form.priority,
            feasibility_proved: form.feasibility_proved,
            estimated_minutes: form.estimated_minutes,
            planned_conferences: form.planned_conferences,
          }),
        });
        push("已创建", "success");
        setOpen(false);
        // 放到列表顶部并刷新分页信息
        setData((d) => ({ ...d, items: [created, ...d.items], total: d.total + 1 }));
      }
    } catch (err: any) {
      push(`保存失败：${err.message || err}`, "error");
    }
  }

  async function remove(it: Idea) {
    if (!confirm(`确认删除「${it.title}」？`)) return;
    try {
      await api<void>(`${API_BASE}/${it.id}`, { method: "DELETE" });
      push("已删除", "success");
      setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== it.id), total: Math.max(0, d.total - 1) }));
    } catch (err: any) {
      push(`删除失败：${err.message || err}`, "error");
    }
  }

  function PriorityBadge({ n }: { n: number }) {
    const palette = ["bg-gray-200 text-gray-700", "bg-blue-100 text-blue-700", "bg-indigo-100 text-indigo-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700"];
    return (
      <span className={cls("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", palette[Math.min(4, Math.max(0, n - 1))])}>
        P{n}
      </span>
    );
  }

  // --------------------------- UI ---------------------------

  return (
    <div className="p-6">
      <Toasts />

      <header className="mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">论文思考（Ideas）</h1>
          <p className="text-sm text-gray-500 mt-1">用于记录你对论文方向的最新思考：是否可发、理由、优先级与预计投入时间等。</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 text-white px-4 py-2 hover:bg-indigo-700 active:bg-indigo-800 shadow"
          >
            <span className="text-lg">＋</span>
            <span>新建想法</span>
          </button>
        </div>
      </header>

      {/* 工具栏 */}
      <section className="mb-4 rounded-xl border bg-white shadow-sm">
        <div className="p-3 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">搜索</label>
            <div className="flex">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); refresh(); } }}
                placeholder="按思考/方向关键词搜索…"
                className="flex-1 rounded-l-md border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <button
                onClick={() => { setPage(1); refresh(); }}
                className="rounded-r-md border border-l-0 border-gray-300 px-4 hover:bg-gray-50"
                title="搜索"
              >
                🔎
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">优先级（投稿潜力）</label>
            <div className="flex gap-1 flex-wrap">
              {[1,2,3,4,5].map(n => {
                const on = prioritySet.has(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      const next = new Set(prioritySet);
                      if (on) next.delete(n); else next.add(n);
                      setPrioritySet(next); setPage(1);
                    }}
                    className={cls(
                      "px-2 py-1 rounded-md border text-sm",
                      on ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-gray-300 hover:bg-gray-50"
                    )}
                  >
                    P{n}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => { setPrioritySet(new Set()); setPage(1); }}
                className="ml-1 px-2 py-1 rounded-md border border-gray-300 text-sm hover:bg-gray-50"
                title="清空优先级过滤"
              >
                清空
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">其它过滤 / 排序</label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={feasible}
                onChange={(e) => { setFeasible(e.target.value as any); setPage(1); }}
                className="rounded-md border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                title="是否已论证可行性"
              >
                <option value="all">全部</option>
                <option value="true">已论证</option>
                <option value="false">未论证</option>
              </select>
              <select
                value={sort}
                onChange={(e) => { setSort(e.target.value); setPage(1); }}
                className="rounded-md border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                title="排序"
              >
                <option value="-updated_at">按更新时间（新→旧）</option>
                <option value="updated_at">按更新时间（旧→新）</option>
                <option value="-priority">按优先级（高→低）</option>
                <option value="priority">按优先级（低→高）</option>
                <option value="-estimated_minutes">按用时（多→少）</option>
                <option value="estimated_minutes">按用时（少→多）</option>
              </select>

              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="最少天数"
                value={timeMin}
                onChange={(e) => setTimeMin(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                className="rounded-md border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                title="预计投入下限（天）"
              />
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="最多天数"
                value={timeMax}
                onChange={(e) => setTimeMax(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                className="rounded-md border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                title="预计投入上限（天）"
              />
            </div>
          </div>
        </div>
        <div className="px-3 pb-3 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            共 <b>{data.total}</b> 条
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="rounded-md border-gray-300 text-sm"
              title="每页数量"
            >
              {[10,20,50,100].map(n => <option key={n} value={n}>{n}/页</option>)}
            </select>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={cls(
                  "px-2 py-1 rounded-md border",
                  page <= 1 ? "text-gray-400 border-gray-200" : "hover:bg-gray-50 border-gray-300"
                )}
              >上一页</button>
              <span className="text-sm text-gray-600 px-1">第 {page}/{totalPages} 页</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={cls(
                  "px-2 py-1 rounded-md border",
                  page >= totalPages ? "text-gray-400 border-gray-200" : "hover:bg-gray-50 border-gray-300"
                )}
              >下一页</button>
            </div>
            <button
              onClick={refresh}
              className="ml-2 px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
              title="刷新"
            >刷新</button>
          </div>
        </div>
      </section>

      {/* 列表表格 */}
      <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500">
          <div className="col-span-5">标题</div>
          <div className="col-span-2">优先级</div>
          <div className="col-span-2">可行性</div>
          <div className="col-span-2">预计天数</div>
          <div className="col-span-1 text-right pr-2">操作</div>
        </div>

        {loading && (
          <div className="p-6 text-center text-gray-500">加载中…</div>
        )}

        {!loading && data.items.length === 0 && (
          <div className="p-10 text-center text-gray-500">
            没有数据。点击右上角的 <span className="font-medium">「新建想法」</span> 开始吧～
          </div>
        )}

        <ul className="divide-y">
          {data.items.map((it) => (
            <li key={it.id} className="grid grid-cols-12 px-4 py-3 hover:bg-gray-50">
              <div className="col-span-5 pr-4">
                <div className="font-medium leading-6 text-gray-900">{it.title}</div>
                {it.description && (
                  <div className="text-sm text-gray-600 line-clamp-2 mt-0.5">{it.description}</div>
                )}
                {it.planned_conferences && it.planned_conferences.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {it.planned_conferences.map((c, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-50 text-sky-700 text-[11px] border border-sky-200"
                        title={`计划投稿：${c}`}
                      >
                        🎯 {c}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1 text-[11px] text-gray-400">
                  更新于 {new Date(it.updated_at).toLocaleString()} · 创建 {new Date(it.created_at).toLocaleString()}
                </div>
              </div>

              <div className="col-span-2 flex items-center">
                <PriorityBadge n={it.priority} />
              </div>

              <div className="col-span-2 flex items-center">
                {it.feasibility_proved ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs border border-emerald-200">✅ 已论证</span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs border border-gray-200">🕵️ 未论证</span>
                )}
              </div>

              <div className="col-span-2 flex items-center">
                <span className="text-sm text-gray-800">{fmtMinutes(it.estimated_minutes)}</span>
              </div>

              <div className="col-span-1 flex items-center justify-end gap-2">
                <button
                  onClick={() => openEdit(it)}
                  className="px-2 py-1 rounded-md border border-gray-300 text-sm hover:bg-gray-50"
                  title="编辑"
                >编辑</button>
                <button
                  onClick={() => remove(it)}
                  className="px-2 py-1 rounded-md border border-rose-300 text-sm text-rose-700 hover:bg-rose-50"
                  title="删除"
                >删除</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 新建/编辑弹窗 */}
      <Modal
        open={open}
        title={editing ? "编辑想法" : "新建想法"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={submit}
              className="px-4 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 shadow"
            >
              保存
            </button>
          </>
        }
      >
        <IdeaForm value={form} onChange={setForm} />
      </Modal>
    </div>
  );
}
