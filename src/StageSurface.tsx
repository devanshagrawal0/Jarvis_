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
// Fixed, non-content height: header + dividers + meta row + action bar + borders + body padding.
const CHROME = 224;

let stageSeq = 0;

function defaultRect(): Rect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(680, Math.max(460, Math.round(vw * 0.42)));
  const h = Math.min(440, Math.max(300, Math.round(vh * 0.42)));
  const x = Math.max(20, vw - w - 36);
  const y = Math.max(20, Math.round(vh * 0.12));
  return { x, y, w, h };
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const two = (n: number) => String(n).padStart(2, "0");

const STYLE = `
.jr-stage {
  position: fixed; z-index: 60; display: flex; flex-direction: column;
  border-radius: 20px; color: #dbeeff;
  font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
  background: radial-gradient(130% 110% at 50% -10%, rgba(13,26,44,.94), rgba(5,10,18,.96));
  border: 1.5px solid rgba(96,204,255,.5);
  box-shadow: 0 0 0 1px rgba(96,204,255,.10), 0 26px 90px rgba(0,0,0,.62),
              0 0 48px rgba(64,184,255,.20), inset 0 0 70px rgba(22,64,116,.14);
  backdrop-filter: blur(22px) saturate(1.15); -webkit-backdrop-filter: blur(22px) saturate(1.15);
  overflow: hidden; will-change: transform, width, height;
}
.jr-stage.deploy { animation: jr-stage-in .42s cubic-bezier(.16,1,.3,1) both; }
@keyframes jr-stage-in {
  from { opacity: 0; transform: translateY(-8px) scale(.955); filter: blur(5px); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0); }
}
/* corner brackets */
.jr-stage-cnr { position: absolute; width: 20px; height: 20px; pointer-events: none;
  border: 2px solid rgba(120,216,255,.85); box-shadow: 0 0 8px rgba(96,204,255,.4); }
.jr-stage-cnr.tl { top: 9px; left: 9px; border-right: 0; border-bottom: 0; border-top-left-radius: 11px; }
.jr-stage-cnr.tr { top: 9px; right: 9px; border-left: 0; border-bottom: 0; border-top-right-radius: 11px; }
.jr-stage-cnr.bl { bottom: 9px; left: 9px; border-right: 0; border-top: 0; border-bottom-left-radius: 11px; }
.jr-stage-cnr.br { bottom: 9px; right: 9px; border-left: 0; border-top: 0; border-bottom-right-radius: 11px; }
/* left accent rail */
.jr-stage-rail { position: absolute; left: 12px; top: 82px; width: 4px; height: 118px; border-radius: 4px;
  background: linear-gradient(180deg, #74e2ff, rgba(96,204,255,.12)); box-shadow: 0 0 14px rgba(96,204,255,.75); }
.jr-stage-rail::after { content: ""; position: absolute; left: 1px; top: 130px; width: 2px; height: 150px;
  background-image: radial-gradient(rgba(120,200,255,.5) 40%, transparent 42%); background-size: 2px 8px; opacity: .6; }
/* header */
.jr-stage-bar { display: flex; align-items: center; gap: 14px; flex: none; height: 62px; padding: 0 14px 0 28px;
  cursor: grab; user-select: none; }
.jr-stage-bar:active { cursor: grabbing; }
.jr-stage-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: #64d6ff; box-shadow: 0 0 12px #64d6ff; }
.jr-stage-vsep { width: 1px; height: 22px; background: rgba(120,200,255,.32); flex: none; }
.jr-stage-title { font-size: 21px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: #eaf6ff;
  flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jr-stage-tag { font-size: 11px; letter-spacing: .3em; color: rgba(110,205,250,.9); text-transform: uppercase; flex: none; }
.jr-stage-x { appearance: none; width: 40px; height: 40px; border-radius: 11px; flex: none;
  border: 1px solid rgba(120,200,255,.28); background: rgba(120,200,255,.05); color: #cdeaff; cursor: pointer;
  font-size: 17px; line-height: 1; display: grid; place-items: center; transition: background .15s, border-color .15s; }
.jr-stage-x:hover { background: rgba(255,96,96,.16); border-color: rgba(255,120,120,.5); color: #ffdada; }
/* dividers */
.jr-stage-div { height: 1px; margin: 0 18px; flex: none;
  background: linear-gradient(90deg, transparent, rgba(120,200,255,.24) 10%, rgba(120,200,255,.24) 90%, transparent); }
/* body */
.jr-stage-body { flex: 1 1 auto; overflow: auto; padding: 24px 30px; color: #e7f3ff; font-size: 19px; line-height: 1.55; }
.jr-stage-body::-webkit-scrollbar { width: 8px; }
.jr-stage-body::-webkit-scrollbar-thumb { background: rgba(96,204,255,.28); border-radius: 8px; }
/* footer meta */
.jr-stage-foot { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 8px 28px 12px; gap: 12px; }
.jr-stage-meta { font-size: 11px; letter-spacing: .1em; color: rgba(96,182,218,.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; }
.jr-stage-meta b { color: #a6dcf2; font-weight: 600; }
.jr-stage-meta .sp { opacity: .45; margin: 0 8px; }
.jr-stage-online { display: inline-flex; align-items: center; gap: 8px; flex: none; padding: 5px 13px; border-radius: 20px;
  border: 1px solid rgba(120,200,255,.32); font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: #cdebff; }
.jr-stage-online i { width: 8px; height: 8px; border-radius: 50%; background: #63d6ff; box-shadow: 0 0 10px #63d6ff; }
/* action bar */
.jr-stage-acts { flex: none; display: flex; align-items: center; height: 58px; padding: 0 12px 0 20px; }
.jr-stage-act { display: inline-flex; align-items: center; gap: 9px; padding: 0 18px; height: 100%; background: none; border: 0;
  color: #e2f2ff; cursor: pointer; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; transition: color .15s; }
.jr-stage-act svg { color: #64d6ff; width: 16px; height: 16px; }
.jr-stage-act:hover { color: #ffffff; }
.jr-stage-act[data-on="true"] svg, .jr-stage-act[data-on="true"] { color: #74e2ff; }
.jr-stage-asep { width: 1px; height: 20px; background: rgba(120,200,255,.24); flex: none; }
.jr-stage-more { margin-left: auto; width: 40px; height: 40px; border-radius: 11px; flex: none;
  border: 1px solid rgba(120,200,255,.24); background: rgba(120,200,255,.04); color: #bfe6ff; cursor: pointer;
  display: grid; place-items: center; }
.jr-stage-grip { position: absolute; right: 3px; bottom: 3px; width: 16px; height: 16px; cursor: nwse-resize; z-index: 3;
  background: linear-gradient(135deg, transparent 50%, rgba(120,200,255,.5) 50%, rgba(120,200,255,.5) 62%, transparent 62%, transparent 74%, rgba(120,200,255,.5) 74%);
  border-bottom-right-radius: 15px; }
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
        setMeta({
          id: `${title.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8) || "STAGE"}.${String(stageSeq).padStart(4, "0")}`,
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
    const fit = clamp(content.offsetHeight + CHROME, MIN_H, Math.round(vh * 0.92));
    setRect((r) => {
      const base = r ?? defaultRect();
      if (Math.abs(base.h - fit) < 2) return r;
      const y = Math.min(base.y, Math.max(12, vh - fit - 12));
      return { ...base, h: fit, y };
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
      <span className="jr-stage-cnr tl" /><span className="jr-stage-cnr tr" />
      <span className="jr-stage-cnr bl" /><span className="jr-stage-cnr br" />
      <span className="jr-stage-rail" />

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

      <div className="jr-stage-foot">
        <span className="jr-stage-meta">
          ID: <b>{meta.id}</b><span className="sp">·</span>CREATED: <b>{meta.date}</b><span className="sp">·</span><b>{meta.time}</b>
        </span>
        <span className="jr-stage-online"><i />Online</span>
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
