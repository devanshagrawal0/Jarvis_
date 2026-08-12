import { useEffect, useState } from "react";
import { JarvisMarkdown } from "./JarvisMarkdown";

// ── W0: The Stage ───────────────────────────────────────────────────────────
// Jarvis's own on-screen surface. The backend `stage_show` tool emits a
// `stage-show` uiAction; JarvisUI dispatches it as a `jarvis:ui` DOM event; this
// component renders it as a floating glass panel. This is the seed of the
// generative Stage — later waves add typed blocks, morphing, drag/resize, etc.

type StageState = { title: string; content: string; key: number } | null;

const STYLE = `
.jr-stage-wrap { position: fixed; inset: 0; pointer-events: none; z-index: 60; display: grid; place-items: center; }
.jr-stage {
  pointer-events: auto;
  width: min(560px, calc(100vw - 48px));
  max-height: min(72vh, 720px);
  display: flex; flex-direction: column;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(14,20,32,.82), rgba(9,13,22,.9));
  border: 1px solid rgba(var(--jr-a, 120 200 255) / .28);
  box-shadow: 0 24px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.02) inset,
              0 0 40px rgba(var(--jr-a, 120 200 255) / .10);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  overflow: hidden;
  transform-origin: center;
  animation: jr-stage-in .34s cubic-bezier(.16,1,.3,1) both;
}
@keyframes jr-stage-in {
  from { opacity: 0; transform: translateY(10px) scale(.965); filter: blur(3px); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0); }
}
.jr-stage-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px 11px;
  border-bottom: 1px solid rgba(var(--jr-a, 120 200 255) / .16);
  background: rgba(var(--jr-a, 120 200 255) / .05);
}
.jr-stage-dot { width: 8px; height: 8px; border-radius: 50%;
  background: rgb(var(--jr-a, 120 200 255)); box-shadow: 0 0 10px rgb(var(--jr-a, 120 200 255)); flex: none; }
.jr-stage-title { font-size: 12.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: rgba(220,235,255,.92); flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jr-stage-tag { font-size: 10px; letter-spacing: .12em; color: rgba(var(--jr-a, 120 200 255) / .8); text-transform: uppercase; }
.jr-stage-x { pointer-events: auto; appearance: none; border: 0; background: rgba(255,255,255,.05);
  color: rgba(220,235,255,.75); width: 24px; height: 24px; border-radius: 8px; cursor: pointer; font-size: 15px; line-height: 1;
  display: grid; place-items: center; transition: background .15s, color .15s; }
.jr-stage-x:hover { background: rgba(255,90,90,.18); color: #ffd9d9; }
.jr-stage-body { padding: 16px 18px 18px; overflow: auto; color: rgba(224,236,252,.92); font-size: 14px; line-height: 1.55; }
.jr-stage-body::-webkit-scrollbar { width: 8px; }
.jr-stage-body::-webkit-scrollbar-thumb { background: rgba(var(--jr-a, 120 200 255) / .25); border-radius: 8px; }
`;

export function StageSurface() {
  const [stage, setStage] = useState<StageState>(null);

  useEffect(() => {
    // inject stylesheet once
    if (!document.getElementById("jr-stage-style")) {
      const el = document.createElement("style");
      el.id = "jr-stage-style";
      el.textContent = STYLE;
      document.head.appendChild(el);
    }
    const onUi = (e: Event) => {
      const detail = (e as CustomEvent).detail as { type?: string; data?: { title?: string; content?: string } } | undefined;
      if (detail?.type === "stage-show" && detail.data?.content) {
        setStage({ title: detail.data.title || "Jarvis", content: detail.data.content, key: Date.now() });
      }
    };
    const onClose = () => setStage(null);
    document.addEventListener("jarvis:ui", onUi);
    document.addEventListener("jarvis:stage-close", onClose);
    return () => {
      document.removeEventListener("jarvis:ui", onUi);
      document.removeEventListener("jarvis:stage-close", onClose);
    };
  }, []);

  // Esc closes the Stage.
  useEffect(() => {
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setStage(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage]);

  if (!stage) return null;

  return (
    <div className="jr-stage-wrap" aria-live="polite">
      <div className="jr-stage" key={stage.key} role="dialog" aria-label={stage.title}>
        <div className="jr-stage-bar">
          <span className="jr-stage-dot" />
          <span className="jr-stage-title">{stage.title}</span>
          <span className="jr-stage-tag">Stage</span>
          <button className="jr-stage-x" onClick={() => setStage(null)} title="Close (Esc)">×</button>
        </div>
        <div className="jr-stage-body">
          <JarvisMarkdown text={stage.content} />
        </div>
      </div>
    </div>
  );
}
