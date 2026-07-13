import { useEffect, useRef } from "react";

// Same WIDGETS list as WidgetStrip — no import needed, just the labels/icons
const WIDGETS = [
  { id: "profile",     label: "Profile",     icon: "◐" },
  { id: "weather",     label: "Weather",     icon: "☀" },
  { id: "vitals",      label: "Vitals",      icon: "◍" },
  { id: "modules",     label: "Modules",     icon: "⬡" },
  { id: "projects",    label: "Projects",    icon: "◫" },
  { id: "agents",      label: "Agents",      icon: "◉" },
  { id: "connections", label: "Connections", icon: "⚡" },
  { id: "trust",       label: "Trust",       icon: "◇" },
  { id: "kalshi",      label: "Kalshi",      icon: "▲" },
  { id: "vision",      label: "Vision",      icon: "◎" },
  { id: "memory",      label: "Memory",      icon: "◈" },
  { id: "devices",     label: "Devices",     icon: "◫" },
  { id: "receipts",    label: "Receipts",    icon: "◻" },
  { id: "graph",       label: "Graph",       icon: "❖" },
  { id: "helix",       label: "Helix",       icon: "⬡" },
];

export function WidgetLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  if (!open) return null;

  function open_widget(id: string) {
    document.dispatchEvent(new CustomEvent("jarvis:open-widget", { detail: { id } }));
    onClose();
  }

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        bottom: "calc(4.5vh + 107px)",
        right: "calc(50% - min(445px, 29.5vw))",
        width: "220px",
        background: "rgba(4, 16, 28, 0.97)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(0, 229, 255, 0.28)",
        borderRadius: "12px",
        zIndex: 1200,
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,229,255,0.06)",
        color: "rgba(230, 251, 255, 0.92)",
        fontFamily: 'Inter, "Segoe UI", sans-serif',
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "10px 12px 8px",
        borderBottom: "1px solid rgba(0,229,255,0.12)",
        fontSize: "11px", fontWeight: 700,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: "rgba(0,229,255,0.7)",
      }}>
        <span style={{ fontSize: "14px" }}>⬡</span>
        Widgets
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto", background: "none", border: "none",
            color: "rgba(230,251,255,0.45)", cursor: "pointer",
            padding: "2px 5px", fontSize: "14px", lineHeight: 1,
            borderRadius: "4px", minHeight: "auto",
          }}
        >×</button>
      </div>

      {/* Widget grid */}
      <div style={{ padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {WIDGETS.map(w => (
          <div
            key={w.id}
            role="button"
            tabIndex={0}
            onClick={() => open_widget(w.id)}
            onKeyDown={e => e.key === "Enter" && open_widget(w.id)}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "7px 9px", borderRadius: "8px", cursor: "pointer",
              background: "rgba(0,229,255,0.04)",
              border: "1px solid rgba(0,229,255,0.1)",
              transition: "background 0.12s, border-color 0.12s",
              outline: "none",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(0,229,255,0.1)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,229,255,0.3)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(0,229,255,0.04)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,229,255,0.1)";
            }}
          >
            <span style={{ fontSize: "14px", flexShrink: 0 }}>{w.icon}</span>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "rgba(230,251,255,0.85)" }}>
              {w.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
