// Feature #19 — right-click context menus. A provider renders a single floating menu;
// any element calls show(x, y, items) from onContextMenu to surface in-place verbs.
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

// `label` is optional because a separator (`{ sep: true }`) carries no text; the renderer
// branches on `sep` before ever reading `label`.
export interface CtxItem { label?: string; icon?: React.ReactNode; run?: () => void; danger?: boolean; sep?: boolean }
interface CtxV { show: (x: number, y: number, items: CtxItem[]) => void }
const Ctx = createContext<CtxV>({ show: () => {} });
export const useContextMenu = () => useContext(Ctx);

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  const show = useCallback((x: number, y: number, items: CtxItem[]) => setMenu({ x, y, items }), []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", esc);
    window.addEventListener("contextmenu", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", esc); window.removeEventListener("contextmenu", close); };
  }, [menu]);
  const H = menu ? (menu.items.length * 30 + 12) : 0;
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {menu && (
        <div className="hxv-ctxmenu" style={{ left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 1280) - 196), top: Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - H - 8) }}
          onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
          {menu.items.map((it, i) => it.sep
            ? <div key={i} className="hxv-ctxsep" />
            : <div key={i} className={"hxv-ctxitem" + (it.danger ? " danger" : "")} onClick={() => { setMenu(null); it.run?.(); }}>
                {it.icon && <span className="hxv-ctxico">{it.icon}</span>}<span>{it.label}</span>
              </div>)}
        </div>
      )}
    </Ctx.Provider>
  );
}
