import React from "react";
import ReactDOM from "react-dom";
import { ChevronDown } from "lucide-react";
/** venue 缩写映射 */
const VENUE_ABBR: [RegExp, string][] = [
    // 编译与体系结构领域（CCF A/B 类）
    [/(parallel architectures and compilation techniques|(^|\W)pact(\W|$))/i, "PACT"],
    [/(supercomputing|(^|\W)ics(\W|$))/i, "ICS"],
    [/(code generation and optimization|(^|\W)cgo(\W|$))/i, "CGO"],
    [/(hardware\/software co-design and system synthesis|(^|\W)codes\+isss(\W|$))/i, "CODES+ISSS"],
    [/(Architectural Support for Programming Languages and Operating Systems|(^|\W)ASPLOS(\W|$))/i, "ASPLOS"],
    [/(virtual execution environments|(^|\W)vee(\W|$))/i, "VEE"],
    [/(computer design|(^|\W)iccd(\W|$))/i, "ICCD"],
    [/(computer-aided design|(^|\W)iccad(\W|$))/i, "ICCAD"],
    [/(parallel processing|(^|\W)icpp(\W|$))/i, "ICPP"],
    [/(low power electronics and design|(^|\W)islped(\W|$))/i, "ISLPED"],
    [/(physical design|(^|\W)ispd(\W|$))/i, "ISPD"],
    [/(application-specific systems, architectures and processors|(^|\W)asap(\W|$))/i, "ASAP"],
    [/(high performance embedded architectures and compilers|(^|\W)hipeac(\W|$))/i, "HiPEAC"],
    [/(embedded software|(^|\W)emsoft(\W|$))/i, "EMSOFT"],
    [/(design automation|(^|\W)iccad(\W|$))/i, "ICCAD"],
    [/(computer-aided design|(^|\W)iccad(\W|$))/i, "ICCAD"],

    // 顶级期刊（编译与体系结构领域）
    [/(acm transactions on computer systems|(^|\W)tocs(\W|$))/i, "TOCS"],
    [/(ieee transactions on parallel and distributed systems|(^|\W)tpds(\W|$))/i, "TPDS"],
    [/(ieee transactions on computers|(^|\W)tc(\W|$))/i, "TC"],
    [/(ieee transactions on computer-aided design of integrated circuits and systems|(^|\W)tcad(\W|$))/i, "TCAD"],
    [/(acm transactions on architecture and code optimization|(^|\W)taco(\W|$))/i, "TACO"],
    [/(journal of parallel and distributed computing|(^|\W)jpdc(\W|$))/i, "JPDC"],
    [/(ieee transactions on very large scale integration systems|(^|\W)tvlsi(\W|$))/i, "TVLSI"],
    [/(parallel computing|(^|\W)parco(\W|$))/i, "PARCO"],
    [/(ieee transactions on cloud computing|(^|\W)tcc(\W|$))/i, "TCC"],
    [/(acm journal on emerging technologies in computing systems|(^|\W)jetc(\W|$))/i, "JETC"],
    [/(cluster computing|(^|\W)cluster(\W|$))/i, "Cluster Computing"],
    [/(ACM Transactions on Information Systems|(^|\W)TOIS(\W|$))/i, "TOIS"],
    

    // 其他相关会议
    [/(design, automation & test in europe|(^|\W)date(\W|$))/i, "DATE"],
    [/(hot chips|(^|\W)hot chips(\W|$))/i, "HOT CHIPS"],
    [/(cluster computing|(^|\W)cluster(\W|$))/i, "CLUSTER"],
    [/(parallel and distributed systems|(^|\W)icpads(\W|$))/i, "ICPADS"],
    [/(european conference on parallel and distributed computing|(^|\W)euro-par(\W|$))/i, "Euro-Par"],
    [/(computing frontiers|(^|\W)cf(\W|$))/i, "CF"],
    [/(high performance computing and communications|(^|\W)hpcc(\W|$))/i, "HPCC"],
    [/(high performance computing, data and analytics|(^|\W)hipc(\W|$))/i, "HiPC"],
    [/(modeling, analysis, and simulation of computer and telecommunication systems|(^|\W)mascots(\W|$))/i, "MASCOTS"],
    [/(parallel and distributed processing with applications|(^|\W)ispa(\W|$))/i, "ISPA"],
    [/(ieee cluster, cloud and grid computing|(^|\W)ccgrid(\W|$))/i, "CCGRID"],
    [/(international test conference|(^|\W)itc(\W|$))/i, "ITC"],
    [/(large installation system administration conference|(^|\W)lisa(\W|$))/i, "LISA"],
    [/(mass storage systems and technologies|(^|\W)msst(\W|$))/i, "MSST"],
    [/(ieee real-time and embedded technology and applications symposium|(^|\W)rtas(\W|$))/i, "RTAS"],

    // 人工智能领域（参考）
    [/(conference on neural information processing systems|(^|\W)neurips(\W|$))/i, "NeurIPS"],
    [/(machine learning|(^|\W)icml(\W|$))/i, "ICML"],
    [/(conference on computer vision and pattern recognition|(^|\W)cvpr(\W|$))/i, "CVPR"],
    [/(computer vision|(^|\W)iccv(\W|$))/i, "ICCV"],
    [/(european conference on computer vision|(^|\W)eccv(\W|$))/i, "ECCV"],
    [/(association for the advancement of artificial intelligence|(^|\W)aaai(\W|$))/i, "AAAI"],
    [/(international joint conference on artificial intelligence|(^|\W)ijcai(\W|$))/i, "IJCAI"],
    [/(conference on learning representations|(^|\W)iclr(\W|$))/i, "ICLR"],
    [/(conference on empirical methods in natural language processing|(^|\W)emnlp(\W|$))/i, "EMNLP"],
    [/(conference on neural information processing systems|(^|\W)neurips(\W|$))/i, "NeurIPS"],

    // 编程语言与软件工程领域（参考）
    [/(principles of programming languages|(^|\W)popl(\W|$))/i, "POPL"],
    [/(symposium on principles of programming languages|(^|\W)splash(\W|$))/i, "SPLASH"],
    [/(programming language design and implementation|(^|\W)pldi(\W|$))/i, "PLDI"],
    [/(functional programming|(^|\W)icfp(\W|$))/i, "ICFP"],
    [/(software engineering|(^|\W)icse(\W|$))/i, "ICSE"],
    [/(automated software engineering|(^|\W)ase(\W|$))/i, "ASE"],
    [/(software and systems engineering|(^|\W)fse(\W|$))/i, "FSE"],
    [/(programming languages and systems|(^|\W)popl(\W|$))/i, "POPL"],

    // 其他参考会议
    [/(design automation conference|(^|\W)dac(\W|$))/i, "DAC"],
    [/(very large data bases|(^|\W)vldb(\W|$))/i, "VLDB"],
    [/(sigmod|(^|\W)sigmod(\W|$))/i, "SIGMOD"],
    [/(the web conference|(^|\W)www(\W|$))/i, "WWW"],
    [/(supercomputing|(^|\W)sc(\W|$))/i, "SC"],
    [/(siggraph|(^|\W)siggraph(\W|$))/i, "SIGGRAPH"],
    [/(proceedings of the acm on programming languages|(^|\W)pacmpl(\W|$))/i, "PACMPL"],
    [/(object-oriented programming, systems, languages, and applications|(^|\W)oopsla(\W|$))/i, "OOPSLA"],
    [/(Research and Development inInformation Retrieval|(^|\W)sigir(\W|$))/i, "SIGIR"],
];

const VENUE_ABBR_LIST = Array.from(new Set(VENUE_ABBR.map(([, ab]) => ab)));
/* --------------------------- venue/abbr filter dropdown --------------------------- */
function VenueAbbrDropdown({ value, onChange }: { value: string[]; onChange: (abbrs: string[]) => void }) {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState("");
    const btnRef = React.useRef<HTMLButtonElement | null>(null);
    const popRef = React.useRef<HTMLDivElement | null>(null);
    const [mounted, setMounted] = React.useState(false);
    const [pos, setPos] = React.useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 360 });
  
    React.useEffect(() => setMounted(true), []);
  
    // 点击外部关闭（考虑 portal 后）
    React.useEffect(() => {
      const onClick = (e: MouseEvent) => {
        const t = e.target as Node;
        if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
        setOpen(false);
      };
      window.addEventListener("click", onClick, true);
      return () => window.removeEventListener("click", onClick, true);
    }, []);
  
    // 贴按钮右对齐 + 防越界
    const place = React.useCallback(() => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 360;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
      const top  = Math.min(window.innerHeight - 8, r.bottom + 8);
      setPos({ left, top, width });
    }, []);
  
    React.useEffect(() => {
      if (!open) return;
      place();
      const on = () => place();
      window.addEventListener("resize", on);
      window.addEventListener("scroll", on, true);
      return () => { window.removeEventListener("resize", on); window.removeEventListener("scroll", on, true); };
    }, [open, place]);
  
    const all = React.useMemo(() => Array.from(new Set(VENUE_ABBR_LIST)).sort(), []);
    const filtered = React.useMemo(() => all.filter(n => !q || n.toLowerCase().includes(q.toLowerCase())), [all, q]);
  
    const toggle   = (abbr: string) => value.includes(abbr) ? onChange(value.filter(v => v !== abbr)) : onChange([...value, abbr]);
    const selectAll = () => onChange(filtered);
    const clearAll  = () => onChange([]);
  
    const summary = React.useMemo(() => {
      if (!value.length) return <span className="text-gray-500">全部会议/期刊</span>;
      const head = value.slice(0, 2);
      const rest = value.length - head.length;
      return (
        <span className="flex items-center gap-1 flex-wrap">
          {head.map(n => <span key={n} className="text-[11px] px-2 py-[2px] rounded-md border bg-white">{n}</span>)}
          {rest > 0 && <span className="text-xs text-gray-500">+{rest}</span>}
        </span>
      );
    }, [value]);
  
    const popover = (
      <div
        ref={popRef}
        className="fixed z-[1000] rounded-xl border bg-white shadow-xl"
        style={{ left: pos.left, top: pos.top, width: pos.width }}
      >
        <div className="p-2 border-b bg-gray-50 flex items-center gap-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索缩写…"
            className="flex-1 text-sm px-2 py-1 rounded-md border bg-white"
          />
          <button className="text-xs px-2 py-1 rounded border" onClick={selectAll}>全选</button>
          <button className="text-xs px-2 py-1 rounded border" onClick={clearAll}>清空</button>
        </div>
        <div className="max-h-64 overflow-auto p-1 grid grid-cols-2 gap-1">
          {filtered.map(n => {
            const checked = value.includes(n);
            return (
              <label key={n}
                className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer ${checked ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(n)} />
                <span className="text-sm">{n}</span>
              </label>
            );
          })}
          {!filtered.length && <div className="col-span-2 p-3 text-center text-sm text-gray-400">没有匹配的缩写</div>}
        </div>
        <div className="p-2 border-t text-right">
          <button className="text-xs px-2 py-1 rounded border hover:bg-gray-50" onClick={() => setOpen(false)}>完成</button>
        </div>
      </div>
    );
  
    return (
      <div className="relative">
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className="flex items-center gap-2 px-2 py-1 rounded-md border bg-white hover:bg-gray-50"
          title={value.length ? `已选 ${value.length} 个缩写` : "全部会议/期刊"}
        >
          <span className="text-xs text-gray-500">按会议/期刊：</span>
          {summary}
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </button>
  
        {open && typeof document !== "undefined" ? ReactDOM.createPortal(popover, document.body) : null}
      </div>
    );
  }
  export default VenueAbbrDropdown;