import React from "react";

type Theme = "light"|"dark"|"contrast"|"spring"|"summer"|"autumn"|"winter";
const ThemeCtx = React.createContext<{theme:Theme; set:(t:Theme)=>void}>({theme:"light", set:()=>{}});
export const useTheme = () => React.useContext(ThemeCtx);

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>(() => (typeof window !== "undefined"
    ? (localStorage.getItem("theme") as Theme) || "light" : "light"));

  React.useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  return <ThemeCtx.Provider value={{ theme, set: setTheme }}>{children}</ThemeCtx.Provider>;
}

export function ThemeToggle() {
  const { theme, set } = useTheme();
  const next: Record<Theme, Theme> = { light:"dark", dark:"contrast", contrast:"spring", spring:"summer", summer:"autumn", autumn:"winter", winter:"light" };
  const label: Record<Theme,string> = { light:"亮", dark:"暗", contrast:"高对比", spring:"春", summer:"夏", autumn:"秋", winter:"冬" };

  return (
    <button
      onClick={() => set(next[theme])}
      className="relative overflow-hidden rounded-xl px-3 py-2 text-sm border bg-white/70 hover:bg-white/90 backdrop-blur"
      title={`主题：${label[theme]}（点击切换）`}
    >
      主题 · {label[theme]}
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_circle_at_var(--x)_var(--y),rgba(99,102,241,.08),transparent_40%)]" />
      {/* spotlight 跟随鼠标的小装饰 */}
      <script dangerouslySetInnerHTML={{__html:`
        (function(btn){
          if(!btn) return;
          btn.onmousemove = e => {
            btn.style.setProperty('--x', e.offsetX + 'px');
            btn.style.setProperty('--y', e.offsetY + 'px');
          };
        })(document.currentScript.parentElement);
      `}}/>
    </button>
  );
}