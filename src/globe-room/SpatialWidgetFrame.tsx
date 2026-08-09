import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import "./SpatialWorkspace.css";

export type SpatialWidgetMode = "minimized" | "normal" | "expanded";

export type SpatialWidgetState = {
  id: string;
  mode: SpatialWidgetMode;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};

type Props = {
  state: SpatialWidgetState;
  icon: string;
  title: string;
  stat: string;
  status: "active" | "warning" | "inactive";
  fetchedAt?: string;
  loading?: boolean;
  onFocus: () => void;
  onUpdate: (patch: Partial<SpatialWidgetState>) => void;
  onClose: () => void;
  onRefresh: () => void;
  children: ReactNode;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function ageLabel(value?: string) {
  if (!value) return "not synced";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return "live now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function bindPointer(
  event: ReactPointerEvent,
  move: (dx: number, dy: number) => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const onMove = (next: PointerEvent) => move(next.clientX - startX, next.clientY - startY);
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
}

export function SpatialWidgetFrame({ state, icon, title, stat, status, fetchedAt, loading, onFocus, onUpdate, onClose, onRefresh, children }: Props) {
  const moveStart = { x: state.x, y: state.y };
  const sizeStart = { w: state.w, h: state.h };
  const setMode = (mode: SpatialWidgetMode) => {
    if (mode === "expanded") {
      onUpdate({ mode, x: Math.max(18, Math.round(window.innerWidth * .07)), y: 58, w: Math.min(1240, Math.round(window.innerWidth * .76)), h: Math.min(884, window.innerHeight - 130) });
    } else if (mode === "normal") {
      onUpdate({ mode, w: clamp(state.w, 460, 720), h: clamp(state.h, 390, 610), x: clamp(state.x, 12, Math.max(12, window.innerWidth - 480)), y: clamp(state.y, 64, Math.max(64, window.innerHeight - 520)) });
    } else onUpdate({ mode });
  };

  return (
    <section
      className={`spatial-widget spatial-widget--${state.mode}`}
      data-widget-id={state.id}
      data-status={status}
      style={{ left: state.x, top: state.y, width: state.w, height: state.h, zIndex: state.z }}
      aria-label={`${title} spatial widget`}
    >
      <header
        className="spatial-widget-header"
        onPointerDown={(event) => {
          onFocus();
          bindPointer(event, (dx, dy) => onUpdate({
            x: clamp(moveStart.x + dx, 8, Math.max(8, window.innerWidth - 180)),
            y: clamp(moveStart.y + dy, 54, Math.max(54, window.innerHeight - 150)),
          }));
        }}
      >
        <span className="spatial-widget-icon">{icon}</span>
        <span className="spatial-widget-heading"><strong>{title}</strong><small>{stat} · {ageLabel(fetchedAt)}</small></span>
        <span className={`spatial-live-dot spatial-live-dot--${status}`} />
        <button title="Refresh widget" onPointerDown={(event) => event.stopPropagation()} onClick={onRefresh} className={loading ? "is-loading" : ""}>↻</button>
        <button title="Minimize widget" onPointerDown={(event) => event.stopPropagation()} onClick={() => setMode("minimized")}>—</button>
        <button title="Normal widget" onPointerDown={(event) => event.stopPropagation()} onClick={() => setMode("normal")}>▣</button>
        <button title="Expand widget" onPointerDown={(event) => event.stopPropagation()} onClick={() => setMode("expanded")}>↗</button>
        <button title="Close widget" onPointerDown={(event) => event.stopPropagation()} onClick={onClose}>×</button>
      </header>
      <div className="spatial-widget-scanline" />
      <div className="spatial-widget-body">{children}</div>
      <div
        className="spatial-widget-resize"
        title="Resize widget"
        onPointerDown={(event) => bindPointer(event, (dx, dy) => onUpdate({
          w: clamp(sizeStart.w + dx, 390, Math.max(390, window.innerWidth - state.x - 8)),
          h: clamp(sizeStart.h + dy, 300, Math.max(300, window.innerHeight - state.y - 105)),
        }))}
      />
    </section>
  );
}
