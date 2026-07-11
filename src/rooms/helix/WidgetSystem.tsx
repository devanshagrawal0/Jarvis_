import React, { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { FloatingWidget, WidgetType, HelixProject, VaultEntry, HelixEntry, AgentState, StrandHealth, Strand } from "./helix-types";

// ── Wave 11: Floating Widget Window (@dnd-kit drag) ──────────────────────────
function WidgetWindow({ widget, onClose, onUpdate, onResizeStart, children }: {
  widget: FloatingWidget;
  onClose: () => void;
  onUpdate: (patch: Partial<FloatingWidget>) => void;
  onResizeStart: (sx: number, sy: number) => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: widget.id });

  const x = widget.x + (transform?.x ?? 0);
  const y = widget.y + (transform?.y ?? 0);

  return (
    <div
      ref={setNodeRef}
      className={`hw-window${widget.minimized ? " hw-window--min" : ""}${widget.pinned ? " hw-window--pinned" : ""}${isDragging ? " hw-window--dragging" : ""}`}
      style={{
        left: x, top: y, width: widget.width, opacity: widget.opacity,
        height: widget.minimized ? undefined : widget.height,
        zIndex: widget.pinned ? 9999 : isDragging ? 9998 : 9000,
      }}
    >
      <div className="hw-titlebar" {...(widget.pinned ? {} : { ...listeners, ...attributes })}
        style={{ cursor: widget.pinned ? "default" : isDragging ? "grabbing" : "grab" }}>
        <span className="hw-title">{widget.title}</span>
        <div className="hw-controls">
          <button className="hw-btn" title="Toggle opacity" onClick={() => onUpdate({ opacity: widget.opacity < 0.5 ? 1 : 0.4 })}>◑</button>
          <button className={`hw-btn${widget.pinned ? " active" : ""}`} title="Pin (disables drag)" onClick={() => onUpdate({ pinned: !widget.pinned })}>⊕</button>
          <button className="hw-btn" title="Minimize" onClick={() => onUpdate({ minimized: !widget.minimized })}>{widget.minimized ? "□" : "—"}</button>
          <button className="hw-btn hw-close" onClick={onClose}>✕</button>
        </div>
      </div>
      {/* hw-body always rendered (not unmounted) so WidgetContent local state (notes, timer) survives minimize */}
      <div className="hw-body" style={widget.minimized ? { display: "none" } : undefined}>{children}</div>
      {!widget.minimized && (
        <div className="hw-resize-handle"
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onResizeStart(e.clientX, e.clientY); }} />
      )}
    </div>
  );
}

// ── Wave 11: Widget Content ──────────────────────────────────────────────────
function WidgetContent({ widget, project, entries, vault, wireItems, health, openContradictionCount, agents }: {
  widget: FloatingWidget;
  project: { id: string; name: string; helix_score: number } | null;
  entries: { confidence: number; strand: string }[];
  vault: { id: string; summary?: string; query?: string }[];
  wireItems: { text: string; t: number }[];
  health: StrandHealth;
  openContradictionCount: number;
  agents: { id: string; name: string; status: string; category: string }[];
}) {
  const STRAND_COLORS: Record<string, string> = { evidence: "#4a9eff", strategy: "#4aff9e", construction: "#ff9e4a", memory: "#9e4aff", signal: "#ffe14a", synthesis: "#4afff0" };
  const [notes, setNotes] = React.useState("");
  const [timerSecs, setTimerSecs] = React.useState(25 * 60);
  const [timerRunning, setTimerRunning] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setTimerSecs(s => Math.max(0, s - 1)), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  const score = project?.helix_score ?? 0;
  const scoreColor = score >= 80 ? "#4aff9e" : score >= 60 ? "#ffe14a" : score >= 40 ? "#ff9e4a" : "#ff6b6b";

  if (widget.type === "score-meter") {
    return (
      <div className="wc-score">
        <div className="wc-score-num" style={{ color: scoreColor }}>{score}</div>
        <div className="wc-score-bar"><div className="wc-score-fill" style={{ width: `${score}%`, background: scoreColor }} /></div>
        <div className="wc-score-label">Helix Score</div>
      </div>
    );
  }

  if (widget.type === "contradiction-counter") {
    return (
      <div className="wc-contradiction">
        <div className={`wc-contradiction-num${openContradictionCount > 0 ? " wc-contradiction-num--warn" : ""}`}>{openContradictionCount}</div>
        <div className="wc-contradiction-label">{openContradictionCount === 1 ? "open conflict" : "open conflicts"}</div>
        {openContradictionCount > 0 && <div className="wc-contradiction-sub">Review in Contradiction Arena</div>}
      </div>
    );
  }

  if (widget.type === "agent-hud") {
    const active = agents.filter(a => a.status === "active" || a.status === "running");
    return (
      <div className="wc-agents">
        {active.length === 0 && <div className="wc-agents-empty">All agents idle</div>}
        {active.map(a => (
          <div key={a.id} className="wc-agent-row">
            <span className={`wc-agent-dot wc-agent-dot--${a.status}`} />
            <span className="wc-agent-name">{a.name}</span>
            <span className="wc-agent-cat">{a.category}</span>
          </div>
        ))}
        <div className="wc-agents-footer">{agents.length} total agents</div>
      </div>
    );
  }

  if (widget.type === "strand-radar") {
    const strands: Strand[] = ["evidence", "strategy", "construction", "memory", "signal", "synthesis"];
    const cx = 80, cy = 80, r = 60;
    const pts = strands.map((s, i) => {
      const angle = (i / strands.length) * Math.PI * 2 - Math.PI / 2;
      const val = health[s] ?? 0;
      return { s, x: cx + r * val * Math.cos(angle), y: cy + r * val * Math.sin(angle), lx: cx + (r + 14) * Math.cos(angle), ly: cy + (r + 14) * Math.sin(angle), color: STRAND_COLORS[s] ?? "#4a9eff" };
    });
    const gridPts = strands.map((_, i) => { const a = (i / strands.length) * Math.PI * 2 - Math.PI / 2; return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`; });
    const polyPts = pts.map(p => `${p.x},${p.y}`).join(" ");
    return (
      <svg viewBox="0 0 160 160" className="wc-radar">
        <polygon points={gridPts.join(" ")} fill="none" stroke="rgba(74,158,255,0.1)" strokeWidth="1" />
        <polygon points={polyPts} fill="rgba(74,158,255,0.12)" stroke="#4a9eff" strokeWidth="1.5" />
        {pts.map(p => <text key={p.s} x={p.lx} y={p.ly + 4} textAnchor="middle" fontSize="9" fill={p.color}>{p.s.slice(0, 3).toUpperCase()}</text>)}
      </svg>
    );
  }

  if (widget.type === "wire-feed") {
    return (
      <div className="wc-wire">
        {wireItems.slice(0, 8).map(item => (
          <div key={item.t} className="wc-wire-item">◈ {item.text}</div>
        ))}
      </div>
    );
  }

  if (widget.type === "quick-notes") {
    return (
      <div className="wc-notes">
        <textarea className="wc-notes-area" placeholder="Scratch pad…" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    );
  }

  if (widget.type === "vault-preview") {
    return (
      <div className="wc-vault">
        {vault.length === 0 && <div className="wc-vault-empty">No locked decisions yet</div>}
        {vault.slice(0, 3).map(v => (
          <div key={v.id} className="wc-vault-item">
            <div className="wc-vault-summary">{(v.summary || v.query || "").slice(0, 80)}</div>
          </div>
        ))}
        {vault.length > 3 && <div className="wc-vault-more">+{vault.length - 3} more</div>}
      </div>
    );
  }

  if (widget.type === "focus-timer") {
    const m = Math.floor(timerSecs / 60).toString().padStart(2, "0");
    const s = (timerSecs % 60).toString().padStart(2, "0");
    return (
      <div className="wc-timer">
        <div className={`wc-timer-display${timerRunning ? " wc-timer-display--running" : ""}`}>{m}:{s}</div>
        <div className="wc-timer-controls">
          <button className="wc-timer-btn" onClick={() => setTimerRunning(r => !r)}>{timerRunning ? "⏸" : "▶"}</button>
          <button className="wc-timer-btn" onClick={() => { setTimerRunning(false); setTimerSecs(25 * 60); }}>↺</button>
        </div>
      </div>
    );
  }

  return null;
}

// ── Wave 11: Widget Picker Overlay ───────────────────────────────────────────
const WIDGET_CATALOG: { type: WidgetType; label: string; desc: string; icon: string }[] = [
  { type: "score-meter", label: "Helix Score", desc: "Live 0-100 score gauge", icon: "◎" },
  { type: "contradiction-counter", label: "Contradictions", desc: "Open conflict count", icon: "⚠" },
  { type: "agent-hud", label: "Agent HUD", desc: "Active agent status list", icon: "◉" },
  { type: "strand-radar", label: "Strand Radar", desc: "Hexagonal strand health", icon: "◈" },
  { type: "wire-feed", label: "The Wire", desc: "Detached activity feed", icon: "~" },
  { type: "quick-notes", label: "Quick Notes", desc: "Floating scratch pad", icon: "✏" },
  { type: "vault-preview", label: "Vault Preview", desc: "Last 3 locked decisions", icon: "⊡" },
  { type: "focus-timer", label: "Focus Timer", desc: "25-min countdown timer", icon: "⏱" },
];

function WidgetPickerOverlay({ onAdd, onClose, activeCount }: {
  onAdd: (type: WidgetType) => void;
  onClose: () => void;
  activeCount: number;
}) {
  return (
    <div className="wp-overlay" onClick={onClose}>
      <div className="wp-panel" onClick={e => e.stopPropagation()}>
        <div className="wp-header">
          <span className="wp-title">Widget Picker</span>
          <span className="wp-sub">{activeCount} active · ⌘⇧W</span>
          <button className="wp-close" onClick={onClose}>✕</button>
        </div>
        <div className="wp-grid">
          {WIDGET_CATALOG.map(w => (
            <button key={w.type} className="wp-card" onClick={() => onAdd(w.type)}>
              <span className="wp-icon">{w.icon}</span>
              <span className="wp-label">{w.label}</span>
              <span className="wp-desc">{w.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export { WidgetWindow, WidgetContent, WidgetPickerOverlay };
