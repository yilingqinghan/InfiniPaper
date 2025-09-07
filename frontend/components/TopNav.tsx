import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, BookOpen, UploadCloud, Tags, TrendingUp, Sparkles, CalendarClock, CreditCard
} from "lucide-react";

type Item = { href: string; label: string; icon: React.ComponentType<any>; grad: string; key: string };

const NAV_ITEMS: Item[] = [
  { key: "search",  label: "搜索",     href: "/search",  icon: Search,     grad: "from-sky-500 to-cyan-400" },
  { key: "ccf",     label: "CCF 截止", href: "/ccf",     icon: CalendarClock, grad: "from-sky-500 to-violet-500" },
  { key: "library", label: "论文列表", href: "/library", icon: BookOpen,   grad: "from-indigo-500 to-fuchsia-500" },
  { key: "import",  label: "导入",     href: "/library?import=1", icon: UploadCloud, grad: "from-emerald-500 to-lime-400" },
  { key: "tags",    label: "标签",     href: "/tags",    icon: Tags,       grad: "from-rose-500 to-orange-500" },
  { key: "quality", label: "质量面板", href: "/quality", icon: TrendingUp, grad: "from-violet-500 to-indigo-400" },
  { key: "cards", label: "想法", href: "/ideas", icon: CreditCard, grad: "from-sky-500 to-cyan-400" },
];

export default function TopNav() {
  const router = useRouter();
  const [hoverKey, setHoverKey] = React.useState<string | null>(null);

  const isActive = (href: string) => router.asPath === href || router.asPath.startsWith(href + "/");

  return (
    <div className="sticky top-0 z-40">
      {/* 渐变发光发丝边 + 玻璃拟态背景 */}
      <div className="relative border-b border-white/40 bg-white/65 backdrop-blur-md supports-[backdrop-filter]:bg-white/55">
        <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="flex h-14 items-center justify-between gap-3">
            {/* 左侧 Logo */}
            <Link href="/" className="group relative inline-flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-sm">
                <Sparkles className="h-4 w-4" />
              </div>
              <span className="bg-gradient-to-r from-indigo-700 via-fuchsia-700 to-sky-700 bg-clip-text text-base font-semibold text-transparent tracking-tight">
                InfiniPaper
              </span>
            </Link>

            {/* 中部导航 */}
            <nav className="relative hidden items-center gap-2 md:flex">
              {NAV_ITEMS.map((it) => {
                const Icon = it.icon as any;
                const active = isActive(it.href) || hoverKey === it.key;
                return (
                  <Link
                    key={it.key}
                    href={it.href}
                    onMouseEnter={() => setHoverKey(it.key)}
                    onMouseLeave={() => setHoverKey(null)}
                    className="relative"
                  >
                    <AnimatePresence>
                      {active && (
                        <motion.span
                          layoutId="nav-pill"
                          className={`absolute inset-0 rounded-xl bg-gradient-to-r ${it.grad}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ type: "spring", stiffness: 400, damping: 28 }}
                        />
                      )}
                    </AnimatePresence>
                    <span
                      className={`relative z-10 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors
                        ${active ? "text-white" : "text-gray-700 hover:text-gray-900"}
                      `}
                    >
                      <Icon className="h-4 w-4" />
                      {it.label}
                    </span>
                  </Link>
                );
              })}
            </nav>

            {/* 右侧 CTA */}
            <Link
              href="/library?import=1"
              className="group relative inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium text-gray-800 hover:text-gray-900"
            >
              <span className="pointer-events-none absolute -inset-[1px] rounded-xl bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-sky-400 opacity-60 blur-sm transition group-hover:opacity-80" />
              <span className="relative z-10 inline-flex items-center gap-2">
                <UploadCloud className="h-4 w-4 text-indigo-600" />
                导入 PDF
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}