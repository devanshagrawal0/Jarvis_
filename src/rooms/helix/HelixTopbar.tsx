import React from "react";
import {
  Strand, HelixProject, ForgeDocument, WFWorkflow, AgentState, TokenUsage,
  VaultEntry, HelixLayout, FloatingWidget, STRAND_META, ALL_STRANDS, StrandHealth,
} from "./helix-types";
import { HelixActionHub } from "./HelixActionHub";

interface HelixTopbarProps {
  dockMode: boolean;
  setDockMode: (v: boolean | ((x: boolean) => boolean)) => void;
  onExit: () => void;
  project: HelixProject | null;
  scoreColor: string;
  activeStrand: Strand;
  strandCounts: Record<Strand, number>;
  setStrand: (s: Strand) => void;

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

  topbarCollapsed: boolean;
  setTopbarCollapsed: (v: boolean | ((x: boolean) => boolean)) => void;
}

export function HelixTopbar(p: HelixTopbarProps) {
  const {
    onExit, project, scoreColor, activeStrand, strandCounts, setStrand,
    heatMap, setHeatMap, oracleActive, setOracleActive,
    showBrief, briefHasNew, openBrief,
    forgeOpen, setForgeOpen, openForge, forgeDocs,
    wfOpen, setWfOpen, wfWorkflows,
    agentConstOpen, setAgentConstOpen, agents,
    showJarvis, setShowJarvis, tokenUsage,
    probeEntryId, setProbeEntryId, probeConnected, setProbeConnected,
    showVault, setShowVault, vault,
    layouts, applyLayout, applyPreset, setLayoutSaveOpen,
    widgetPickerOpen, setWidgetPickerOpen, widgets,
    topbarCollapsed, setTopbarCollapsed,
    dockMode, setDockMode,
  } = p;

  const activeAgentCount  = agents.filter(a => a.status === "active").length;
  const userWfCount       = wfWorkflows.filter(w => !w.is_builtin).length;

  if (topbarCollapsed) {
    return (
      <header className="helix-topbar helix-topbar--collapsed">
        <button className="helix-back" onClick={onExit} title="Back to Jarvis">←</button>
        <button className="helix-topbar-expand-btn" onClick={() => setTopbarCollapsed(false)} title="Expand topbar">▽</button>
        <div className="helix-topbar-icon-strip">
          <button className={`htb-icon-btn${heatMap ? " active" : ""}`} onClick={() => setHeatMap(x => !x)} title="Heat Map">H</button>
          <button className={`htb-icon-btn${oracleActive ? " active" : ""}`} onClick={() => setOracleActive(true)} title="Oracle">⊕</button>
          <button className={`htb-icon-btn${showBrief ? " active" : ""}`} onClick={openBrief} title="Brief">◎</button>
          <button className={`htb-icon-btn${forgeOpen ? " active" : ""}`} onClick={() => forgeOpen ? setForgeOpen(false) : openForge()} title="Forge">⚒</button>
          <button className={`htb-icon-btn${wfOpen ? " active" : ""}`} onClick={() => setWfOpen(x => !x)} title="Studio">⚡</button>
          <button className={`htb-icon-btn${agentConstOpen ? " active" : ""}`} onClick={() => setAgentConstOpen(x => !x)} title="Agents">◉</button>
          <button className={`htb-icon-btn${showJarvis ? " active" : ""}`} onClick={() => setShowJarvis(x => !x)} title="Jarvis">J</button>
        </div>
        <div className="helix-score-badge" style={{ "--score-color": scoreColor } as React.CSSProperties}>
          {project?.helix_score ?? 0}
        </div>
      </header>
    );
  }

  return (
    <header className="helix-topbar helix-topbar--two-row">
      {/* Row 1: identity + actions */}
      <div className="htb-row htb-row--main">
        <button className="helix-back" onClick={onExit} title="Back to Jarvis">← Jarvis</button>
        <span className="helix-wordmark">HELIX</span>
        <span className="htb-sep">·</span>
        <span className="htb-project-name">{project?.name ?? "…"}</span>
        <button className="helix-topbar-collapse-btn" onClick={() => setTopbarCollapsed(true)} title="Collapse topbar">△</button>

        <div className="htb-hub-area">
          <HelixActionHub
            dockMode={dockMode} setDockMode={setDockMode}
            heatMap={heatMap} setHeatMap={setHeatMap}
            oracleActive={oracleActive} setOracleActive={setOracleActive}
            showBrief={showBrief} briefHasNew={briefHasNew} openBrief={openBrief}
            forgeOpen={forgeOpen} setForgeOpen={setForgeOpen} openForge={openForge} forgeDocs={forgeDocs}
            wfOpen={wfOpen} setWfOpen={setWfOpen} wfWorkflows={wfWorkflows}
            agentConstOpen={agentConstOpen} setAgentConstOpen={setAgentConstOpen} agents={agents}
            showJarvis={showJarvis} setShowJarvis={setShowJarvis}
            tokenUsage={tokenUsage}
            probeEntryId={probeEntryId} setProbeEntryId={setProbeEntryId}
            probeConnected={probeConnected} setProbeConnected={setProbeConnected}
            showVault={showVault} setShowVault={setShowVault} vault={vault}
            layouts={layouts} applyLayout={applyLayout} applyPreset={applyPreset}
            setLayoutSaveOpen={setLayoutSaveOpen}
            widgetPickerOpen={widgetPickerOpen} setWidgetPickerOpen={setWidgetPickerOpen}
            widgets={widgets}
          />
        </div>

        <div className="helix-score-badge" style={{ "--score-color": scoreColor } as React.CSSProperties} title="Helix Score">
          {project?.helix_score ?? 0}
        </div>
      </div>

      {/* Row 2: strand pills */}
      <div className="htb-row htb-row--strands">
        {ALL_STRANDS.map(s => (
          <button
            key={s}
            className={`helix-pill strand-${s}${activeStrand === s ? " active" : ""}`}
            style={{ "--strand-color": STRAND_META[s].color } as React.CSSProperties}
            onClick={() => setStrand(s)}
          >
            {STRAND_META[s].label}
            {strandCounts[s] > 0 && <span className="helix-pill-count">{strandCounts[s]}</span>}
          </button>
        ))}
      </div>
    </header>
  );
}
