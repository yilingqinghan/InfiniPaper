import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/utils/api";

type Props = {
  value?: string[];
  onChange?: (tags: string[]) => void;
  placeholder?: string;
};

export default function TagSelector({ value = [], onChange, placeholder = "添加标签..." }: Props) {
  const [tags, setTags] = useState<string[]>(value);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setTags(value), [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  async function refreshSuggestions(text: string) {
    try {
      const res = await apiPost("/api/v1/tags/suggest", { text, top_k: 8 });
      setSuggestions(res.suggestions || []);
    } catch (e) { /* ignore */ }
  }

  function addTag(t: string) {
    if (!t) return;
    if (tags.includes(t)) return;
    const next = [...tags, t];
    setTags(next);
    onChange?.(next);
    setInput("");
    setOpen(false);
  }

  function removeTag(t: string) {
    const next = tags.filter(x => x !== t);
    setTags(next);
    onChange?.(next);
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex flex-wrap gap-2 items-center rounded-2xl border bg-white px-3 py-2 shadow-sm focus-within:ring-2 ring-gray-200">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded-full px-2 py-1">
            #{t}
            <button className="opacity-60 hover:opacity-100" onClick={() => removeTag(t)}>×</button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[160px] outline-none text-sm placeholder:text-gray-400"
          placeholder={placeholder}
          value={input}
          onChange={(e) => { setInput(e.target.value); refreshSuggestions(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addTag(input.trim()); }
            if (e.key === "Backspace" && !input && tags.length) removeTag(tags[tags.length-1]);
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-10 mt-2 w-full rounded-xl border bg-white shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => addTag(s)}
            >
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
