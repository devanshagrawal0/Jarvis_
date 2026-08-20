import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { JarvisMarkdown } from "./JarvisMarkdown";
import { SurfaceRenderer, blocksToSurface } from "./StageRegistry";

// ── The Stage ────────────────────────────────────────────────────────────────
// Jarvis's own on-screen surface, styled as a JARVIS HUD panel: cyan glow border,
// corner brackets, letter-spaced header, a left accent rail, an ID/created meta
// row, an ONLINE pill, and an EDIT / EXPAND / PIN action bar. Draggable by its
// title bar, resizable from the corner, and it sizes its height to its content.

// W3: typed blocks the brain can emit for a structured surface (vs plain markdown).
type Block =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "stat"; label?: string; value?: string; delta?: string }
  | { type: "list"; items: string[] }
  | { type: "calendar"; events?: unknown[]; upcoming?: unknown[]; dateLabel?: string }
  | { type: "chart"; points?: { t: string; v: number }[]; kind?: string; label?: string }
  | { type: "divider" };
type StageState = { title: string; content?: string; blocks?: Block[]; loading?: string; key: number } | null;
type Rect = { x: number; y: number; w: number; h: number };

const MIN_W = 380, MIN_H = 240;
// Fixed, non-content height: header + dividers + action bar + borders + body padding (no meta row).
const CHROME = 106;

let stageSeq = 0;

// What KIND of box a surface needs. Height fits itself to content afterwards; width cannot, so it
// has to be right from the start — a chart squeezed into the 414px note column had 292px of drawing
// room, and a month of daily closes is unreadable in that.
type SurfaceKind = "note" | "wide" | "calendar";

function defaultRect(kind: SurfaceKind = "note"): Rect {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (kind === "calendar") {
    // The calendar room is a large, centered surface (its own HUD frame, no panel chrome). It must
    // sit ABOVE the command bar at the bottom, not behind it.
    const w = Math.min(1260, Math.round(vw * 0.9));
    const topY = Math.max(10, Math.round(vh * 0.02));
    const h = Math.min(930, vh - topY - 178);
    return { x: Math.round((vw - w) / 2), y: topY, w, h };
  }
  // A charted surface gets a landscape box — still docked right, still out of the way, but wide
  // enough that a time series reads as a series rather than a squiggle.
  const w = kind === "wide"
    ? Math.min(720, Math.max(460, Math.round(vw * 0.44)))
    : Math.min(414, Math.max(300, Math.round(vw * 0.27)));
  const h = Math.min(kind === "wide" ? 520 : 400, Math.max(230, Math.round(vh * 0.4)));
  const x = Math.max(20, vw - w - 32);
  const y = Math.max(20, Math.round(vh * 0.11));
  return { x, y, w, h };
}
const isCalendar = (blocks?: Block[]) => Array.isArray(blocks) && blocks.some((b) => b.type === "calendar");
const surfaceKind = (blocks?: Block[]): SurfaceKind =>
  isCalendar(blocks) ? "calendar"
    : Array.isArray(blocks) && blocks.some((b) => b.type === "chart") ? "wide"
      : "note";
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
/* bare mode — the calendar room provides its own HUD frame, so strip the panel chrome */
.jr-stage-bare { background: transparent; border: none; box-shadow: none; border-radius: 14px; overflow: hidden; }
.jr-stage-body-bare { padding: 0 !important; overflow: hidden !important; box-shadow: none !important; height: 100%; }
.jr-stage-drag { position: absolute; top: 0; left: 0; right: 54px; height: 30px; z-index: 10; cursor: move; }
.jr-stage-x-float { position: absolute; top: 20px; right: 22px; z-index: 12; }
/* W3 — generative blocks */
.jr-blocks { display: flex; flex-direction: column; gap: 12px; }
.jr-blk-heading { font-size: 14px; font-weight: 600; color: #dbe8f6; margin: 2px 0 -3px; }
.jr-blk-text { margin: 0; font-size: 13.5px; line-height: 1.5; color: #c2d0e0; }
.jr-blk-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
.jr-blk-list li { position: relative; padding-left: 16px; font-size: 13px; line-height: 1.45; color: #c6d4e4; }
.jr-blk-list li::before { content: ""; position: absolute; left: 3px; top: 7px; width: 4px; height: 4px; border-radius: 50%;
  background: #4a9fc4; box-shadow: 0 0 6px rgba(74,159,196,.55); }
.jr-blk-stats { display: flex; flex-wrap: wrap; gap: 9px; }
.jr-blk-stat { flex: 1 1 120px; min-width: 108px; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(96,170,214,.16); background: linear-gradient(180deg, rgba(30,54,86,.26), rgba(16,28,46,.16)); }
/* A LONE stat must not stretch. The flex-grow above is right for a row of cards and wrong for one:
   a single card grew to the full panel width and turned one number into a slab, which is the
   oversized-tile look — chrome winning over content. Alone it sizes to its own content. */
.jr-blk-stat:only-child { flex: 0 1 auto; min-width: 0; }
.jr-blk-stat-val { font-size: 18px; font-weight: 650; color: #e6f0fb; letter-spacing: .01em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.jr-blk-stat-lbl { font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: rgba(150,180,205,.7); }
.jr-blk-stat-delta { font-size: 11px; font-weight: 600; margin-top: 1px; font-variant-numeric: tabular-nums; }
.jr-blk-stat-delta.up { color: #5fd3a0; }
.jr-blk-stat-delta.down { color: #e88a8a; }
.jr-blk-stat-delta.flat { color: #9fb4c8; }
.jr-blk-div { height: 1px; background: linear-gradient(90deg, transparent, rgba(110,185,235,.16), transparent); margin: 3px 0; }
/* chart block (W3c) — a near-black instrument in a lit cyan bezel, per the owner's reference.
   The bezel is two rings: a hairline edge plus an outer bloom, with a brighter highlight bled in
   from top and bottom centre so the frame reads as lit glass rather than a drawn rectangle. */
.jr-blk-chart { position: relative; border-radius: 20px; padding: 16px 18px 10px;
  border: 1.5px solid rgba(126,214,246,.42);
  background:
    radial-gradient(120% 60% at 50% -14%, rgba(64,150,200,.12), transparent 60%),
    linear-gradient(180deg, #050b10, #03080c);
  box-shadow:
    0 0 0 1px rgba(126,214,246,.08),
    0 0 26px rgba(70,180,240,.16),
    inset 0 1px 0 rgba(170,225,250,.14),
    inset 0 0 40px rgba(20,70,110,.14);
}
/* the lit top and bottom edges */
.jr-blk-chart::before, .jr-blk-chart::after { content: ""; position: absolute; left: 26%; right: 26%; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(168,236,255,.7), transparent);
  box-shadow: 0 0 6px rgba(120,220,255,.45); pointer-events: none; }
.jr-blk-chart::before { top: 0; }
.jr-blk-chart::after { bottom: 0; }
.jr-blk-chart-label { font-size: 17px; font-weight: 700; letter-spacing: .01em; color: #3FE8A8;
  margin: 0 0 10px 2px; text-shadow: 0 0 14px rgba(63,232,168,.45); }
/* calendar day view (W3b) — HUD time-grid: hour rail + events positioned by time + now-line */
.jr-cal-empty { font-size: 13px; color: rgba(160,190,215,.72); padding: 6px 2px; }
.jr-cal-day { display: flex; flex-direction: column; gap: 10px; }
.jr-cal-day-head { font-size: 12.5px; letter-spacing: .14em; text-transform: uppercase; color: #cfe6f7; font-weight: 600; text-align: center; padding: 2px 0 2px; }
.jr-cal-allday { display: flex; align-items: center; gap: 10px; }
.jr-cal-allday-lbl { flex: none; font-size: 9px; letter-spacing: .18em; color: rgba(140,180,210,.7); }
.jr-cal-allday-items { display: flex; flex-wrap: wrap; gap: 6px; }
.jr-cal-allday-chip { font-size: 11.5px; color: #dbeafe; padding: 3px 10px; border-radius: 8px; border: 1px solid rgba(110,185,235,.28); background: rgba(60,110,170,.14); }
.jr-cal-grid { position: relative; margin-top: 2px; }
.jr-cal-hour { position: absolute; left: 0; right: 0; height: 0; }
.jr-cal-hour-lbl { position: absolute; left: 0; top: -7px; width: 46px; text-align: right; font-size: 10.5px; color: rgba(140,175,205,.68); font-variant-numeric: tabular-nums; }
.jr-cal-hour-line { position: absolute; left: 56px; right: 2px; top: 0; height: 1px; background: rgba(110,150,190,.12); }
.jr-cal-now { position: absolute; left: 0; right: 0; height: 0; z-index: 3; }
.jr-cal-now-lbl { position: absolute; left: 0; top: -8px; width: 46px; text-align: right; font-size: 10.5px; color: #57d6f0; font-weight: 600; }
.jr-cal-now-dot { position: absolute; left: 53px; top: -3px; width: 6px; height: 6px; border-radius: 50%; background: #57d6f0; box-shadow: 0 0 8px rgba(87,214,240,.85); }
.jr-cal-now-line { position: absolute; left: 59px; right: 2px; top: 0; height: 1px; background: rgba(87,214,240,.5); }
.jr-cal-ev { position: absolute; left: 60px; right: 2px; display: flex; gap: 9px; overflow: hidden;
  border: 1px solid rgba(110,185,235,.14); border-radius: 9px; padding: 4px 10px 4px 0;
  background: linear-gradient(180deg, rgba(28,50,80,.42), rgba(16,28,46,.34)); box-shadow: inset 0 0 14px -10px rgba(0,0,0,.7); }
.jr-cal-ev-rail { flex: 0 0 3px; align-self: stretch; border-radius: 3px; margin: 2px 0; }
.jr-cal-ev-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.jr-cal-ev-time { font-size: 10px; line-height: 1.25; color: rgba(150,190,220,.85); font-variant-numeric: tabular-nums; }
.jr-cal-ev-title { font-size: 12.5px; line-height: 1.25; color: #e6f0fb; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jr-cal-ev-loc { font-size: 10.5px; line-height: 1.2; color: rgba(150,175,200,.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jr-cal-ev-icon { flex: none; align-self: center; opacity: .92; display: flex; }
.jr-stage-loading { display: flex; align-items: center; gap: 10px; padding: 8px 2px; color: rgba(170,200,225,.85); font-size: 13px; }
.jr-stage-spin { width: 14px; height: 14px; flex: none; border-radius: 50%; border: 2px solid rgba(120,190,235,.25);
  border-top-color: rgba(140,210,245,.95); animation: jr-stage-spin 0.7s linear infinite; }
@keyframes jr-stage-spin { to { transform: rotate(360deg); } }
`;

const IconEdit = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>);
const IconExpand = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>);
const IconPin = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5" /><path d="M9 10.8V4h6v6.8l2 3.2H7Z" /></svg>);

// W3a — typed blocks now render through the block registry (SurfaceRenderer + blocksToSurface in
// ./StageRegistry). The old inline renderer was replaced so calendar/chart blocks can be added to
// the catalog without touching StageSurface.

export function StageSurface() {
  const [stage, setStage] = useState<StageState>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pinned, setPinned] = useState(false);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; r: Rect } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const userSized = useRef(false);
  const rectKind = useRef<SurfaceKind | null>(null);   // which kind of surface the current rect was sized for
  const [meta, setMeta] = useState<{ id: string; date: string; time: string }>({ id: "STAGE.0001", date: "", time: "" });

  useEffect(() => {
    if (!document.getElementById("jr-stage-style")) {
      const el = document.createElement("style");
      el.id = "jr-stage-style"; el.textContent = STYLE; document.head.appendChild(el);
    }
    const onUi = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; data?: { title?: string; content?: string; blocks?: Block[]; loading?: string } } | undefined;
      const stamp = (title: string) => {
        const now = new Date();
        stageSeq += 1;
        const slug = (title.trim().split(/\s+/)[0] || "").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8) || "STAGE";
        setMeta({
          id: `${slug}.${String(stageSeq).padStart(4, "0")}`,
          date: `${two(now.getMonth() + 1)}.${two(now.getDate())}.${String(now.getFullYear()).slice(2)}`,
          time: `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`,
        });
      };
      if (d?.type === "stage-show" && d.data?.content) {
        userSized.current = false;
        const title = d.data.title || "Jarvis";
        stamp(title);
        setStage({ title, content: d.data.content, key: Date.now() });
        setRect((prev) => (prev && rectKind.current === "note" ? prev : defaultRect("note")));
        rectKind.current = "note";
      }
      if (d?.type === "stage-render") {
        const blocks = Array.isArray(d.data?.blocks) ? d.data.blocks : [];
        const loading = typeof d.data?.loading === "string" ? d.data.loading : "";
        if (!blocks.length && !loading) return; // nothing to show
        userSized.current = false;
        const title = d.data.title || "Jarvis";
        stamp(title);
        // Keep the SAME key from the loading skeleton through to the final blocks, so the panel
        // morphs in place instead of remounting/flickering between phases.
        setStage((prev) => {
          const key = prev && prev.loading ? prev.key : Date.now();
          return blocks.length ? { title, blocks, key } : { title, loading, key };
        });
        // A calendar surface and a stat surface want completely different boxes. `prev ?? …` kept
        // whichever box the FIRST surface of the session happened to need and handed it to every
        // surface after it, so a calendar could land in a note-sized panel and never fit. Keep the
        // box only while the kind of surface is unchanged; when it changes, take the right default.
        const kind = surfaceKind(blocks);
        setRect((prev) => (prev && rectKind.current === kind ? prev : defaultRect(kind)));
        rectKind.current = kind;
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

  // Fit height to content: short notes stay compact, long briefings grow up to the command bar and
  // scroll only past that. Owner's manual resize wins.
  //
  // This used to fire on `[stage.key]` alone, which made it miss the case that mattered most. A
  // surface that morphs in place — the loading skeleton becoming real blocks — deliberately KEEPS
  // its key so the panel doesn't flicker, so the height was measured once against an empty skeleton
  // and never again. The panel then sat at the wrong size no matter what was put in it, which is
  // exactly "the length doesn't adjust to the content". Measuring the content element directly means
  // the fit is driven by the thing it is fitting to, and it cannot be out of step with it.
  useLayoutEffect(() => {
    if (!stage || isCalendar(stage.blocks)) return; // calendar fills its fixed rect
    const content = contentRef.current;
    if (!content) return;
    const fit = () => {
      if (userSized.current) return;
      // Never grow past the command bar at the bottom — cap the panel's bottom just above it.
      const cb = document.querySelector(".jcb-root");
      const cbTop = cb ? cb.getBoundingClientRect().top : Math.round(window.innerHeight * 0.86);
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
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(content);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
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

  // The calendar renders bare — no panel chrome, since the room provides its own HUD frame + header.
  if (isCalendar(stage.blocks)) {
    return (
      <div className="jr-stage deploy jr-stage-bare" key={stage.key} role="dialog" aria-label={stage.title}
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
        <div className="jr-stage-drag" onPointerDown={startDrag("move")} title="Drag" />
        <button className="jr-stage-x jr-stage-x-float" onPointerDown={stop} onClick={() => setStage(null)} title="Close (Esc)">✕</button>
        <div className="jr-stage-body jr-stage-body-bare">
          <div ref={contentRef} style={{ height: "100%" }}>
            <SurfaceRenderer surface={blocksToSurface(stage.blocks!)} />
          </div>
        </div>
        <div className="jr-stage-grip" onPointerDown={startDrag("resize")} title="Resize" />
      </div>
    );
  }

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
          {stage.loading
            ? <div className="jr-stage-loading"><span className="jr-stage-spin" aria-hidden /><span>{stage.loading}</span></div>
            : stage.blocks ? <SurfaceRenderer surface={blocksToSurface(stage.blocks)} /> : <JarvisMarkdown text={stage.content || ""} />}
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
