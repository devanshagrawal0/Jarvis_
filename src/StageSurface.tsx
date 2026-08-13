import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { JarvisMarkdown } from "./JarvisMarkdown";

// ── The Stage ────────────────────────────────────────────────────────────────
// Jarvis's own on-screen surface, styled as a JARVIS HUD panel: cyan glow border,
// corner brackets, letter-spaced header, a left accent rail, an ID/created meta
// row, an ONLINE pill, and an EDIT / EXPAND / PIN action bar. Draggable by its
// title bar, resizable from the corner, and it sizes its height to its content.

type StageState = { title: string; content: string; key: number } | null;
type Rect = { x: number; y: number; w: number; h: number };

const MIN_W = 380, MIN_H = 240;
// Fixed, non-content height: header + dividers + action bar + borders + body padding (no meta row).
const CHROME = 106;

let stageSeq = 0;

function defaultRect(): Rect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(414, Math.max(300, Math.round(vw * 0.27)));
  const h = Math.min(400, Math.max(230, Math.round(vh * 0.4)));
  const x = Math.max(20, vw - w - 32);
  const y = Math.max(20, Math.round(vh * 0.11));
  return { x, y, w, h };
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const two = (n: number) => String(n).padStart(2, "0");

const STYLE = `
.jr-stage {
  position: fixed; z-index: 60; display: flex; flex-direction: column;
  border-radius: 22px; color: #dbeeff;
  font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
  /* layered glass: top sheen -> body -> bottom depth, plus a cool inner glow near the border */
  background:
    linear-gradient(180deg, rgba(30,52,84,.28), rgba(10,18,32,0) 34%),
    radial-gradient(140% 90% at 50% -12%, rgba(40,90,148,.16), transparent 56%),
    linear-gradient(180deg, rgba(10,17,30,.97), rgba(5,10,18,.98));
  border: 1.25px solid rgba(104,190,236,.42);
  box-shadow:
    0 0 0 1px rgba(104,190,236,.07),
    0 30px 90px rgba(0,0,0,.62),
    0 0 42px rgba(64,168,228,.18),
    inset 0 1px 0 rgba(150,205,240,.13),
    inset 0 -44px 84px rgba(2,8,18,.5),
    inset 0 0 60px rgba(22,60,108,.10);
  backdrop-filter: blur(24px) saturate(1.2); -webkit-backdrop-filter: blur(24px) saturate(1.2);
  overflow: hidden; will-change: transform, width, height;
}
.jr-stage.deploy { animation: jr-stage-in .42s cubic-bezier(.16,1,.3,1) both; }
@keyframes jr-stage-in {
  from { opacity: 0; transform: translateY(-8px) scale(.955); filter: blur(5px); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0); }
}
/* corner brackets — small, soft, hugging the very corner so they never touch content */
.jr-stage-cnr { position: absolute; width: 13px; height: 13px; pointer-events: none;
  border: 1.5px solid rgba(126,220,255,.55); }
.jr-stage-cnr.tl { top: 7px; left: 7px; border-right: 0; border-bottom: 0; border-top-left-radius: 12px; }
.jr-stage-cnr.tr { top: 7px; right: 7px; border-left: 0; border-bottom: 0; border-top-right-radius: 12px; }
.jr-stage-cnr.bl { bottom: 7px; left: 7px; border-right: 0; border-top: 0; border-bottom-left-radius: 12px; }
.jr-stage-cnr.br { bottom: 7px; right: 7px; border-left: 0; border-top: 0; border-bottom-right-radius: 12px; }
/* left accent rail */
.jr-stage-rail { position: absolute; left: 13px; top: 62px; width: 3px; height: 88px; border-radius: 4px;
  background: linear-gradient(180deg, #7ce4ff, rgba(96,204,255,.10)); box-shadow: 0 0 14px rgba(96,204,255,.75); }
.jr-stage-rail::after { content: ""; position: absolute; left: 0; top: 98px; width: 3px; height: 110px;
  background-image: radial-gradient(rgba(120,200,255,.4) 42%, transparent 44%); background-size: 3px 8px; opacity: .5; }
/* header — extra side padding so the dot and buttons clear the corner brackets */
.jr-stage-bar { display: flex; align-items: center; gap: 10px; flex: none; height: 42px; padding: 0 13px 0 24px;
  cursor: grab; user-select: none;
  background: linear-gradient(180deg, rgba(34,58,92,.12), rgba(34,58,92,0)); }
.jr-stage-bar:active { cursor: grabbing; }
.jr-stage-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: #52b6e0;
  box-shadow: 0 0 7px rgba(82,182,224,.7); }
.jr-stage-vsep { width: 1px; height: 15px; background: rgba(110,185,235,.22); flex: none; }
.jr-stage-title { font-size: 12.5px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #cadcec;
  flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jr-stage-tag { font-size: 9.5px; letter-spacing: .22em; color: rgba(102,180,220,.7); text-transform: uppercase; flex: none; }
.jr-stage-x { appearance: none; width: 28px; height: 28px; border-radius: 8px; flex: none;
  border: 1px solid rgba(110,185,235,.2); background: rgba(110,185,235,.05); color: #a9c8e0; cursor: pointer;
  font-size: 12px; line-height: 1; display: grid; place-items: center; transition: background .15s, border-color .15s; }
.jr-stage-x:hover { background: rgba(255,96,96,.14); border-color: rgba(255,120,120,.42); color: #ffcaca; }
/* dividers */
.jr-stage-div { height: 1px; margin: 0 20px; flex: none;
  background: linear-gradient(90deg, transparent, rgba(110,185,235,.18) 8%, rgba(110,185,235,.18) 92%, transparent); }
/* body — a faint recess under the header for depth */
.jr-stage-body { flex: 1 1 auto; overflow: auto; padding: 13px 22px 14px 22px; color: #cdd9e8; font-size: 13.5px; line-height: 1.5;
  box-shadow: inset 0 10px 18px -18px rgba(0,0,0,.6); }
.jr-stage-body::-webkit-scrollbar { width: 8px; }
.jr-stage-body::-webkit-scrollbar-thumb { background: rgba(96,204,255,.28); border-radius: 8px; }
/* footer meta */
.jr-stage-foot { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 5px 20px 6px 22px; gap: 12px; }
.jr-stage-meta { font-size: 9px; letter-spacing: .06em; color: rgba(96,182,218,.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; }
.jr-stage-meta b { color: #a6dcf2; font-weight: 600; }
.jr-stage-meta .sp { opacity: .45; margin: 0 5px; }
.jr-stage-online { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 3px 10px; border-radius: 14px;
  border: 1px solid rgba(120,200,255,.28); background: rgba(120,200,255,.05);
  font-size: 8.5px; letter-spacing: .16em; text-transform: uppercase; color: #cdebff; }
.jr-stage-online i { width: 6px; height: 6px; border-radius: 50%; background: #63d6ff; box-shadow: 0 0 8px #63d6ff; }
/* action bar — inset content so nothing meets the bottom corner brackets */
.jr-stage-acts { flex: none; display: flex; align-items: center; height: 33px; padding: 0 12px 2px 22px;
  background: linear-gradient(0deg, rgba(28,50,82,.1), rgba(28,50,82,0)); }
.jr-stage-act { display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; height: 21px; border-radius: 6px; background: none; border: 0;
  color: #b7c8da; cursor: pointer; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; transition: color .15s, background .15s; }
.jr-stage-act svg { color: #4a9fc4; width: 11px; height: 11px; }
.jr-stage-act:hover { color: #eef6ff; background: rgba(110,185,235,.07); }
.jr-stage-act[data-on="true"] svg, .jr-stage-act[data-on="true"] { color: #62c4e6; }
.jr-stage-asep { width: 1px; height: 12px; background: rgba(110,185,235,.16); flex: none; }
.jr-stage-more { margin-left: auto; width: 24px; height: 24px; border-radius: 7px; flex: none;
  border: 1px solid rgba(110,185,235,.16); background: rgba(110,185,235,.04); color: #a7c4dc; cursor: pointer;
  font-size: 11px; display: grid; place-items: center; }
.jr-stage-grip { position: absolute; right: 4px; bottom: 4px; width: 14px; height: 14px; cursor: nwse-resize; z-index: 3; opacity: .8;
  background: linear-gradient(135deg, transparent 52%, rgba(120,200,255,.5) 52%, rgba(120,200,255,.5) 64%, transparent 64%, transparent 76%, rgba(120,200,255,.5) 76%);
  border-bottom-right-radius: 16px; }
`;

const IconEdit = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>);
const IconExpand = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>);
const IconPin = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5" /><path d="M9 10.8V4h6v6.8l2 3.2H7Z" /></svg>);

export function StageSurface() {
  const [stage, setStage] = useState<StageState>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pinned, setPinned] = useState(false);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; r: Rect } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const userSized = useRef(false);
  const [meta, setMeta] = useState<{ id: string; date: string; time: string }>({ id: "STAGE.0001", date: "", time: "" });

  useEffect(() => {
    if (!document.getElementById("jr-stage-style")) {
      const el = document.createElement("style");
      el.id = "jr-stage-style"; el.textContent = STYLE; document.head.appendChild(el);
    }
    const onUi = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; data?: { title?: string; content?: string } } | undefined;
      if (d?.type === "stage-show" && d.data?.content) {
        userSized.current = false;
        const title = d.data.title || "Jarvis";
        const now = new Date();
        stageSeq += 1;
        const slug = (title.trim().split(/\s+/)[0] || "").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8) || "STAGE";
        setMeta({
          id: `${slug}.${String(stageSeq).padStart(4, "0")}`,
          date: `${two(now.getMonth() + 1)}.${two(now.getDate())}.${String(now.getFullYear()).slice(2)}`,
          time: `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`,
        });
        setStage({ title, content: d.data.content, key: Date.now() });
        setRect((prev) => prev ?? defaultRect());
      }
    };
    const onClose = () => setStage(null);
    document.addEventListener("jarvis:ui", onUi);
    document.addEventListener("jarvis:stage-close", onClose);
    return () => { document.removeEventListener("jarvis:ui", onUi); document.removeEventListener("jarvis:stage-close", onClose); };
  }, []);

  useEffect(() => {
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pinned) setStage(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, pinned]);

  // Drag / resize via pointer events while a gesture is active.
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

  // Fit height to content: short notes stay compact, long briefings grow up to ~92% of
  // the screen and scroll only past that. Owner's manual resize wins.
  useLayoutEffect(() => {
    if (!stage || userSized.current) return;
    const content = contentRef.current;
    if (!content) return;
    const vh = window.innerHeight;
    // Never grow past the command bar at the bottom — cap the panel's bottom just above it.
    const cb = document.querySelector(".jcb-root");
    const cbTop = cb ? cb.getBoundingClientRect().top : Math.round(vh * 0.86);
    const maxBottom = Math.max(220, cbTop - 14);
    setRect((r) => {
      const base = r ?? defaultRect();
      const wanted = content.offsetHeight + CHROME;
      const maxH = maxBottom - base.y;               // room from the panel's top down to the bar
      const h = clamp(wanted, MIN_H, Math.max(MIN_H, maxH));
      let y = base.y;
      if (y + h > maxBottom) y = Math.max(12, maxBottom - h); // pull up if it would clip the bar
      if (Math.abs(base.h - h) < 2 && base.y === y) return r;
      return { ...base, h, y };
    });
  }, [stage?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = useCallback((mode: "move" | "resize") => (e: React.PointerEvent) => {
    if (!rect) return;
    e.preventDefault();
    if (mode === "resize") userSized.current = true;
    drag.current = { mode, sx: e.clientX, sy: e.clientY, r: rect };
    document.body.style.userSelect = "none";
  }, [rect]);

  const expand = useCallback(() => {
    userSized.current = true;
    const vw = window.innerWidth, vh = window.innerHeight;
    setRect({ x: Math.round(vw * 0.08), y: Math.round(vh * 0.06), w: Math.round(vw * 0.84), h: Math.round(vh * 0.86) });
  }, []);

  if (!stage || !rect) return null;

  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div className="jr-stage deploy" key={stage.key} role="dialog" aria-label={stage.title}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <div className="jr-stage-bar" onPointerDown={startDrag("move")}>
        <span className="jr-stage-dot" />
        <span className="jr-stage-vsep" />
        <span className="jr-stage-title">{stage.title}</span>
        <span className="jr-stage-tag">Stage</span>
        <button className="jr-stage-x" onPointerDown={stop} onClick={() => setStage(null)} title="Close (Esc)">✕</button>
      </div>

      <div className="jr-stage-div" />

      <div className="jr-stage-body">
        <div ref={contentRef}>
          <JarvisMarkdown text={stage.content} />
        </div>
      </div>

      <div className="jr-stage-div" />

      <div className="jr-stage-acts">
        <button className="jr-stage-act" onPointerDown={stop} onClick={() => document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text: `Edit this: ${stage.title}`, files: [] } }))}><IconEdit /> Edit</button>
        <span className="jr-stage-asep" />
        <button className="jr-stage-act" onPointerDown={stop} onClick={expand}><IconExpand /> Expand</button>
        <span className="jr-stage-asep" />
        <button className="jr-stage-act" data-on={pinned} onPointerDown={stop} onClick={() => setPinned((p) => !p)}><IconPin /> {pinned ? "Pinned" : "Pin"}</button>
        <button className="jr-stage-more" onPointerDown={stop} title="More" aria-label="More">⋯</button>
      </div>

      <div className="jr-stage-grip" onPointerDown={startDrag("resize")} title="Resize" />
    </div>
  );
}
