import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { JarvisMarkdown } from "./JarvisMarkdown";

// ── W0: The Stage ───────────────────────────────────────────────────────────
// Jarvis's own on-screen surface. The backend `stage_show` tool emits a
// `stage-show` uiAction; JarvisUI dispatches it as a `jarvis:ui` event; this
// component renders it as a floating glass panel that Jarvis "deploys" onto the
// screen — draggable by its title bar, resizable from the corner. Seed of the
// generative Stage; later waves add typed blocks, morphing, the router, voice.

type StageState = { title: string; content: string; key: number } | null;
type Rect = { x: number; y: number; w: number; h: number };

const MIN_W = 300, MIN_H = 180;

// A tasteful default placement: upper-right region, clear of the centre globe,
// the chat response panel, and the command bar — reads as "pinned to the side".
function defaultRect(): Rect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(460, Math.max(320, Math.round(vw * 0.3)));
  const h = Math.min(440, Math.max(240, Math.round(vh * 0.42)));
  const x = Math.max(20, vw - w - 32);
  const y = Math.max(20, Math.round(vh * 0.11));
  return { x, y, w, h };
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const STYLE = `
.jr-stage {
  position: fixed; z-index: 60; display: flex; flex-direction: column;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(14,20,32,.85), rgba(9,13,22,.92));
  border: 1px solid rgba(var(--jr-a, 120 200 255) / .30);
  box-shadow: 0 24px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.02) inset,
              0 0 44px rgba(var(--jr-a, 120 200 255) / .12);
  backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2);
  overflow: hidden; will-change: transform, width, height;
}
.jr-stage.deploy { animation: jr-stage-in .40s cubic-bezier(.16,1,.3,1) both; }
@keyframes jr-stage-in {
  from { opacity: 0; transform: translateY(-6px) scale(.955); filter: blur(4px); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0); }
}
.jr-stage-bar {
  display: flex; align-items: center; gap: 10px; flex: none;
  padding: 11px 12px 10px 14px; cursor: grab; user-select: none;
  border-bottom: 1px solid rgba(var(--jr-a, 120 200 255) / .16);
  background: rgba(var(--jr-a, 120 200 255) / .06);
}
.jr-stage-bar:active { cursor: grabbing; }
.jr-stage-dot { width: 8px; height: 8px; border-radius: 50%; flex: none;
  background: rgb(var(--jr-a, 120 200 255)); box-shadow: 0 0 10px rgb(var(--jr-a, 120 200 255)); }
.jr-stage-title { font-size: 12.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
  color: rgba(222,236,255,.94); flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jr-stage-tag { font-size: 9.5px; letter-spacing: .16em; color: rgba(var(--jr-a, 120 200 255) / .8); text-transform: uppercase; }
.jr-stage-x { appearance: none; border: 0; background: rgba(255,255,255,.05); color: rgba(220,235,255,.75);
  width: 22px; height: 22px; border-radius: 7px; cursor: pointer; font-size: 14px; line-height: 1; display: grid; place-items: center;
  transition: background .15s, color .15s; }
.jr-stage-x:hover { background: rgba(255,90,90,.18); color: #ffd9d9; }
.jr-stage-body { padding: 15px 17px 16px; overflow: auto; flex: 1 1 auto; color: rgba(224,236,252,.92); font-size: 14px; line-height: 1.55; }
.jr-stage-body::-webkit-scrollbar { width: 8px; }
.jr-stage-body::-webkit-scrollbar-thumb { background: rgba(var(--jr-a, 120 200 255) / .25); border-radius: 8px; }
.jr-stage-grip { position: absolute; right: 2px; bottom: 2px; width: 16px; height: 16px; cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, rgba(var(--jr-a, 120 200 255) / .5) 50%, rgba(var(--jr-a, 120 200 255) / .5) 62%, transparent 62%, transparent 74%, rgba(var(--jr-a, 120 200 255) / .5) 74%);
  border-bottom-right-radius: 14px; }
`;

export function StageSurface() {
  const [stage, setStage] = useState<StageState>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; r: Rect } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null); // the content itself — measures its NATURAL height
  const userSized = useRef(false); // once the owner drags the resize grip, stop auto-sizing this content

  useEffect(() => {
    if (!document.getElementById("jr-stage-style")) {
      const el = document.createElement("style");
      el.id = "jr-stage-style"; el.textContent = STYLE; document.head.appendChild(el);
    }
    const onUi = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; data?: { title?: string; content?: string } } | undefined;
      if (d?.type === "stage-show" && d.data?.content) {
        userSized.current = false; // new content → size it to fit again
        setStage({ title: d.data.title || "Jarvis", content: d.data.content, key: Date.now() });
        setRect((prev) => prev ?? defaultRect()); // keep position if already placed, else deploy to default
      }
    };
    const onClose = () => setStage(null);
    document.addEventListener("jarvis:ui", onUi);
    document.addEventListener("jarvis:stage-close", onClose);
    return () => { document.removeEventListener("jarvis:ui", onUi); document.removeEventListener("jarvis:stage-close", onClose); };
  }, []);

  useEffect(() => {
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setStage(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage]);

  // Drag / resize via pointer events on window while a gesture is active.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = drag.current; if (!g) return;
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (g.mode === "move") {
        setRect({ ...g.r, x: clamp(g.r.x + dx, 8, window.innerWidth - g.r.w - 8), y: clamp(g.r.y + dy, 8, window.innerHeight - 48) });
      } else {
        setRect({ ...g.r, w: clamp(g.r.w + dx, MIN_W, window.innerWidth - g.r.x - 8), h: clamp(g.r.h + dy, MIN_H, window.innerHeight - g.r.y - 8) });
      }
    };
    const onUp = () => { drag.current = null; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);

  // Fit the Stage height to its content: short notes stay compact, long briefings grow up to
  // ~90% of the screen, and scroll only kicks in past that. Runs whenever new content arrives,
  // unless the owner has manually resized this content.
  useLayoutEffect(() => {
    if (!stage || userSized.current) return;
    const content = contentRef.current;
    if (!content) return;
    const vh = window.innerHeight;
    // Measure the content's OWN height (not the scroll container, whose scrollHeight is floored at
    // its client height and so could never shrink). + header (48) + body padding (31) + borders.
    const fit = clamp(content.offsetHeight + 82, MIN_H, Math.round(vh * 0.9));
    setRect((r) => {
      const base = r ?? defaultRect();
      if (Math.abs(base.h - fit) < 2) return r; // already right — avoid a render loop
      const y = Math.min(base.y, Math.max(12, vh - fit - 12)); // keep it on screen
      return { ...base, h: fit, y };
    });
  }, [stage?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = useCallback((mode: "move" | "resize") => (e: React.PointerEvent) => {
    if (!rect) return;
    e.preventDefault();
    if (mode === "resize") userSized.current = true; // owner takes over sizing for this content
    drag.current = { mode, sx: e.clientX, sy: e.clientY, r: rect };
    document.body.style.userSelect = "none";
  }, [rect]);

  if (!stage || !rect) return null;

  return (
    <div className="jr-stage deploy" key={stage.key} role="dialog" aria-label={stage.title}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <div className="jr-stage-bar" onPointerDown={startDrag("move")}>
        <span className="jr-stage-dot" />
        <span className="jr-stage-title">{stage.title}</span>
        <span className="jr-stage-tag">Stage</span>
        <button className="jr-stage-x" onPointerDown={(e) => e.stopPropagation()} onClick={() => setStage(null)} title="Close (Esc)">×</button>
      </div>
      <div className="jr-stage-body">
        <div ref={contentRef}>
          <JarvisMarkdown text={stage.content} />
        </div>
      </div>
      <div className="jr-stage-grip" onPointerDown={startDrag("resize")} title="Resize" />
    </div>
  );
}
