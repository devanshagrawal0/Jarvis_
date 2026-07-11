import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type {
  ForgeDocument, WFWorkflow, AgentState, VaultEntry,
  HelixLayout, FloatingWidget, TokenUsage,
} from "./helix-types";

// ── Action definition ──────────────────────────────────────────────────────────
interface HubAction {
  id: string;
  label: string;
  icon: string;
  description: string;
  kbd?: string;
  category: string;
  active?: boolean;
  badge?: number | string;
  badgeActive?: boolean;
  onClick: () => void;
}

interface HelixActionHubProps {
  dockMode: boolean;
  setDockMode: (v: boolean | ((x: boolean) => boolean)) => void;
  heatMap: boolean;
  setHeatMap: (v: boolean | ((x: boolean) => boolean)) => void;
  oracleActive: boolean;
  setOracleActive: (v: boolean) => void;
  showBrief: boolean;
  briefHasNew: boolean;
  openBrief: () => void;
  forgeOpen: boolean;
  setForgeOpen: (v: boolean | ((x: boolean) => boolean)) => void;
  openForge: () => void;
  forgeDocs: ForgeDocument[];
  wfOpen: boolean;
  setWfOpen: (v: boolean | ((x: boolean) => boolean)) => void;
  wfWorkflows: WFWorkflow[];
  agentConstOpen: boolean;
  setAgentConstOpen: (v: boolean | ((x: boolean) => boolean)) => void;
  agents: AgentState[];
  showJarvis: boolean;
  setShowJarvis: (v: boolean | ((x: boolean) => boolean)) => void;
  tokenUsage: TokenUsage | null;
  probeEntryId: string | null;
  setProbeEntryId: (v: string | null) => void;
  probeConnected: Set<string>;
  setProbeConnected: (v: Set<string>) => void;
  showVault: boolean;
  setShowVault: (v: boolean | ((x: boolean) => boolean)) => void;
  vault: VaultEntry[];
  layouts: HelixLayout[];
  applyLayout: (l: HelixLayout) => void;
  applyPreset: (v: string) => void;
  setLayoutSaveOpen: (v: boolean | ((x: boolean) => boolean)) => void;
  widgetPickerOpen: boolean;
  setWidgetPickerOpen: (v: boolean | ((x: boolean) => boolean)) => void;
  widgets: FloatingWidget[];
}

const LAYOUT_PRESETS = [
  { value: "balanced",       label: "Balanced" },
  { value: "research-heavy", label: "Research Heavy" },
  { value: "strategy-heavy", label: "Strategy Heavy" },
  { value: "brief-mode",     label: "Brief Mode" },
  { value: "battle-mode",    label: "Battle Mode" },
];

export function HelixActionHub(p: HelixActionHubProps) {
  const [open, setOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeAgentCount = p.agents.filter(a => a.status === "active").length;
  const userWfCount      = p.wfWorkflows.filter(w => !w.is_builtin).length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const ACTIONS: HubAction[] = [
    // ── Intelligence ──────────────────────
    {
      id: "oracle", label: "Oracle", icon: "⊕", category: "Intelligence",
      description: "Ask the Oracle layer a precise question. Helix synthesizes answers cross-strand in real-time.",
      kbd: "⌘O", active: p.oracleActive,
      onClick: () => { p.setOracleActive(true); setOpen(false); },
    },
    {
      id: "brief", label: "Living Brief", icon: "◎", category: "Intelligence",
      description: "View the auto-updating research brief — a live synthesis of all evidence across every strand.",
      kbd: "⌘B", active: p.showBrief,
      badge: p.briefHasNew ? "●" : undefined,
      onClick: () => { p.openBrief(); setOpen(false); },
    },
    {
      id: "heatmap", label: "Heat Map", icon: "⬡", category: "Intelligence",
      description: "Overlay confidence heat map on all evidence cards. High-confidence entries glow; low-confidence fade.",
      kbd: "⌘H", active: p.heatMap,
      onClick: () => { p.setHeatMap(x => !x); },
    },
    {
      id: "probe", label: "Probe Mode", icon: "◈", category: "Intelligence",
      description: "Activate on any card to reveal connections to related evidence across the lattice.",
      active: !!p.probeEntryId,
      badge: p.probeConnected.size > 0 ? p.probeConnected.size : undefined,
      badgeActive: true,
      onClick: () => {
        if (p.probeEntryId) { p.setProbeEntryId(null); p.setProbeConnected(new Set()); }
        setOpen(false);
      },
    },
    // ── Documents & Workflows ─────────────
    {
      id: "forge", label: "The Forge", icon: "⚒", category: "Documents",
      description: "Forge structured documents from evidence — reports, memos, strategic briefs, spatial models.",
      kbd: "⌘F", active: p.forgeOpen,
      badge: p.forgeDocs.length > 0 ? p.forgeDocs.length : undefined,
      onClick: () => { p.forgeOpen ? p.setForgeOpen(false) : p.openForge(); setOpen(false); },
    },
    {
      id: "studio", label: "Workflow Studio", icon: "⚡", category: "Documents",
      description: "Design and run automated evidence-gathering and analysis pipelines with a visual node editor.",
      kbd: "⌘W", active: p.wfOpen,
      badge: userWfCount > 0 ? userWfCount : undefined,
      onClick: () => { p.setWfOpen(x => !x); setOpen(false); },
    },
    // ── Agents & Collaboration ─────────────
    {
      id: "agents", label: "Agent Constellation", icon: "◉", category: "Agents",
      description: "View and configure autonomous agents running across your evidence strands. Each agent monitors, queries, and alerts.",
      kbd: "⌘A", active: p.agentConstOpen,
      badge: activeAgentCount > 0 ? activeAgentCount : undefined,
      badgeActive: activeAgentCount > 0,
      onClick: () => { p.setAgentConstOpen(x => !x); setOpen(false); },
    },
    {
      id: "jarvis", label: "Jarvis Chat", icon: "J", category: "Agents",
      description: "Open the Jarvis AI overlay. Ask questions, run analysis, or command Helix features using natural language.",
      kbd: "⌘J", active: p.showJarvis,
      onClick: () => { p.setShowJarvis(x => !x); setOpen(false); },
    },
    // ── Storage ───────────────────────────
    {
      id: "vault", label: "Vault", icon: "◆", category: "Storage",
      description: "View locked evidence — permanently preserved intelligence that can never decay or be voided.",
      kbd: "⌘V", active: p.showVault,
      badge: p.vault.length > 0 ? p.vault.length : undefined,
      onClick: () => { p.setShowVault(v => !v); setOpen(false); },
    },
    {
      id: "widgets", label: "Widgets", icon: "⊞", category: "Storage",
      description: "Launch floating intelligence widgets: score meter, contradiction counter, strand radar, focus timer, and more.",
      kbd: "⌘⇧W", active: p.widgetPickerOpen,
      badge: p.widgets.length > 0 ? p.widgets.length : undefined,
      onClick: () => { p.setWidgetPickerOpen(x => !x); setOpen(false); },
    },
    // ── Layout ────────────────────────────
    {
      id: "dock", label: "Dock Mode", icon: "⊟", category: "Layout",
      description: "Switch to dockview layout — drag panels, split views, save custom layouts for different research modes.",
      kbd: "⌘D", active: p.dockMode,
      onClick: () => { p.setDockMode(x => !x); },
    },
  ];

  const categories = Array.from(new Set(ACTIONS.map(a => a.category)));
  const hovered = ACTIONS.find(a => a.id === hoveredId);

  // Count active actions
  const activeCount = ACTIONS.filter(a => a.active).length;

  const triggerEl = (
    <button
      className={`hub-trigger${open ? " hub-trigger--open" : ""}${activeCount > 0 ? " hub-trigger--has-active" : ""}`}
      onClick={() => setOpen(x => !x)}
      title="Command Hub (all tools & features)"
    >
      <span className="hub-trigger-icon">⊛</span>
      <span className="hub-trigger-label">Hub</span>
      {activeCount > 0 && <span className="hub-trigger-badge">{activeCount}</span>}
    </button>
  );

  if (!open) return triggerEl;

  const panel = (
    <div className="hub-backdrop">
      <div className="hub-panel" ref={panelRef}>
        {/* Panel header */}
        <div className="hub-panel-head">
          <span className="hub-panel-title">⊛ HELIX COMMAND HUB</span>
          <span className="hub-panel-sub">All tools, features, and intelligence layers</span>
          {p.tokenUsage && p.tokenUsage.total > 0 && (
            <span className="hub-cost-meter" title={`${p.tokenUsage.input.toLocaleString()} in / ${p.tokenUsage.output.toLocaleString()} out`}>
              ${p.tokenUsage.estimatedCostUsd.toFixed(3)}
            </span>
          )}
          <button className="hub-close" onClick={() => setOpen(false)}>✕</button>
        </div>

        {/* Panel body */}
        <div className="hub-body">
          {/* Left: action grid */}
          <div className="hub-grid-area">
            {categories.map(cat => (
              <div key={cat} className="hub-category">
                <div className="hub-category-label">{cat}</div>
                <div className="hub-category-actions">
                  {ACTIONS.filter(a => a.category === cat).map(action => (
                    <button
                      key={action.id}
                      className={`hub-action${action.active ? " hub-action--active" : ""}${hoveredId === action.id ? " hub-action--hovered" : ""}`}
                      onClick={action.onClick}
                      onMouseEnter={() => setHoveredId(action.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <span className="hub-action-icon">{action.icon}</span>
                      <span className="hub-action-label">{action.label}</span>
                      {action.badge !== undefined && (
                        <span className={`hub-action-badge${action.badgeActive ? " hub-action-badge--active" : ""}`}>
                          {action.badge}
                        </span>
                      )}
                      {action.kbd && <span className="hub-action-kbd">{action.kbd}</span>}
                      {action.active && <span className="hub-action-active-dot" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Layout presets */}
            <div className="hub-category">
              <div className="hub-category-label">Layout Presets</div>
              <div className="hub-layout-presets">
                {LAYOUT_PRESETS.map(preset => (
                  <button key={preset.value} className="hub-layout-preset"
                    onClick={() => { p.applyPreset(preset.value); setOpen(false); }}>
                    {preset.label}
                  </button>
                ))}
                {p.layouts.map(l => (
                  <button key={l.id} className="hub-layout-preset hub-layout-preset--saved"
                    onClick={() => { p.applyLayout(l); setOpen(false); }}>
                    ◆ {l.name}
                  </button>
                ))}
                <button className="hub-layout-preset hub-layout-preset--save"
                  onClick={() => { p.setLayoutSaveOpen(x => !x); setOpen(false); }}>
                  + Save current
                </button>
              </div>
            </div>
          </div>

          {/* Right: detail panel */}
          <div className="hub-detail">
            {hovered ? (
              <>
                <div className="hub-detail-icon">{hovered.icon}</div>
                <div className="hub-detail-name">{hovered.label}</div>
                {hovered.kbd && <div className="hub-detail-kbd">{hovered.kbd}</div>}
                <p className="hub-detail-desc">{hovered.description}</p>
                <div className={`hub-detail-status${hovered.active ? " active" : ""}`}>
                  <span className="hub-detail-status-dot" />
                  {hovered.active ? "Active" : "Inactive"}
                </div>
                <button className="hub-detail-launch" onClick={hovered.onClick}>
                  {hovered.active ? "Toggle off" : `Launch ${hovered.label}`} →
                </button>
              </>
            ) : (
              <div className="hub-detail-empty">
                <span className="hub-detail-empty-icon">⊛</span>
                <p>Hover any feature to see details and documentation</p>
              </div>
            )}
          </div>
        </div>

        {/* Probe status footer (if active) */}
        {p.probeEntryId && (
          <div className="hub-probe-bar">
            <span className="hub-probe-icon">◈</span>
            <span className="hub-probe-label">Probe mode active — {p.probeConnected.size} connections mapped</span>
            <button className="hub-probe-exit"
              onClick={() => { p.setProbeEntryId(null); p.setProbeConnected(new Set()); setOpen(false); }}>
              Exit Probe
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {triggerEl}
      {createPortal(panel, document.body)}
    </>
  );
}
