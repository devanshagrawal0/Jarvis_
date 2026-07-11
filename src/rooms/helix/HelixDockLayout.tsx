import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DockviewReact, DockviewReadyEvent, IDockviewPanelProps, DockviewApi } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";

const STORAGE_KEY = "helix-dock-layout";

// Context carries stable setter functions by panel ID — survives fromJSON restores
// because SlotPanel reads from context (not params), so callbacks are always available
type SlotSetters = Record<string, (el: HTMLElement) => void>;
const SlotContext = createContext<SlotSetters>({});

// Slot panel — reads setter from context by its own panel ID
// Defined OUTSIDE HelixDockLayout so it's a stable component reference (no remounts)
function SlotPanel({ api }: IDockviewPanelProps<Record<string, never>>) {
  const ctx = useContext(SlotContext);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ctx[api.id]?.(ref.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} style={{ width: "100%", height: "100%", overflow: "auto" }} />;
}

const DOCK_COMPONENTS = { slot: SlotPanel };

interface Props {
  leftContent: React.ReactNode;
  rightContent: React.ReactNode;
  coreContent: React.ReactNode;
}

export function HelixDockLayout({ leftContent, rightContent, coreContent }: Props) {
  const [leftEl, setLeftEl] = useState<HTMLElement | null>(null);
  const [rightEl, setRightEl] = useState<HTMLElement | null>(null);
  const [coreEl, setCoreEl] = useState<HTMLElement | null>(null);
  const apiRef = useRef<DockviewApi | null>(null);

  // Stable setter map — useState setters never change identity, so this memo is safe
  const ctxValue = useMemo<SlotSetters>(() => ({
    left:  (el) => setLeftEl(el),
    right: (el) => setRightEl(el),
    core:  (el) => setCoreEl(el),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function onReady(event: DockviewReadyEvent) {
    apiRef.current = event.api;

    // Register layout persistence listener here — no separate useEffect needed
    event.api.onDidLayoutChange(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(event.api.toJSON())); } catch { /* quota */ }
    });

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        event.api.fromJSON(JSON.parse(saved));
        // SlotPanel components are re-created by dockview and will call ctx[panelId]
        // via the SlotContext — no params needed, so fromJSON restore works correctly
        return;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    // Default 3-column layout
    event.api.addPanel({ id: "left", component: "slot", title: "Evidence" });
    event.api.addPanel({ id: "core", component: "slot", title: "Core",
      position: { direction: "right", referencePanel: "left" } });
    event.api.addPanel({ id: "right", component: "slot", title: "Strategy",
      position: { direction: "right", referencePanel: "core" } });
  }

  return (
    <SlotContext.Provider value={ctxValue}>
      <div className="helix-dock-wrapper">
        <DockviewReact
          className="helix-dockview"
          components={DOCK_COMPONENTS}
          onReady={onReady}
        />
        {leftEl  && createPortal(<div className="helix-dock-panel-content">{leftContent}</div>,  leftEl)}
        {coreEl  && createPortal(<div className="helix-dock-panel-content">{coreContent}</div>,  coreEl)}
        {rightEl && createPortal(<div className="helix-dock-panel-content">{rightContent}</div>, rightEl)}
      </div>
    </SlotContext.Provider>
  );
}
