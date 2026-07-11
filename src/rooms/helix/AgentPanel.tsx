import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { AgentState } from "./helix-types";

export function AgentBuilderPanel({ agents, name, prompt, trigger, output, runNow, input, saving, runResult,
  onChangeName, onChangePrompt, onChangeTrigger, onChangeOutput, onChangeRunNow, onChangeInput,
  onSpawn, onDelete, onOpenConstellation }: {
  agents: AgentState[];
  name: string;
  prompt: string;
  trigger: string;
  output: string;
  runNow: boolean;
  input: string;
  saving: boolean;
  runResult: string | null;
  onChangeName: (v: string) => void;
  onChangePrompt: (v: string) => void;
  onChangeTrigger: (v: string) => void;
  onChangeOutput: (v: string) => void;
  onChangeRunNow: (v: boolean) => void;
  onChangeInput: (v: string) => void;
  onSpawn: () => void;
  onDelete: (id: string) => void;
  onOpenConstellation: () => void;
}) {
  const customAgents = agents.filter(a => a.category === "custom");
  const activeCount = agents.filter(a => a.status === "active").length;

  return (
    <div className="ab-panel">
      <div className="ab-header">
        <span className="ab-title">◉ Agent Builder</span>
        <button className="ab-const-btn" onClick={onOpenConstellation} title="Open Constellation ⌘A">◉ View All ⌘A</button>
      </div>

      <div className="ab-status-row">
        <span className="ab-status-dot active" />
        <span className="ab-status-label">{activeCount} agents active · {agents.length} total</span>
      </div>

      <div className="ab-form">
        <label className="ab-label">Agent Name
          <input className="ab-input" value={name} onChange={e => onChangeName(e.target.value)} placeholder="e.g., Market Analyzer" />
        </label>
        <label className="ab-label">System Prompt
          <textarea className="ab-textarea" rows={4} value={prompt} onChange={e => onChangePrompt(e.target.value)}
            placeholder="You are a specialized research agent. Your role is to..." />
        </label>
        <div className="ab-row">
          <label className="ab-label ab-label-half">Trigger
            <select className="ab-select" value={trigger} onChange={e => onChangeTrigger(e.target.value)}>
              <option value="manual">Manual</option>
              <option value="on_inquiry">On Inquiry</option>
              <option value="on_entry">On New Entry</option>
              <option value="on_contradiction">On Contradiction</option>
            </select>
          </label>
          <label className="ab-label ab-label-half">Output
            <select className="ab-select" value={output} onChange={e => onChangeOutput(e.target.value)}>
              <option value="text">Text</option>
              <option value="json">JSON</option>
              <option value="analysis">Analysis</option>
            </select>
          </label>
        </div>
        <label className="ab-label ab-checkbox-label">
          <input type="checkbox" checked={runNow} onChange={e => onChangeRunNow(e.target.checked)} />
          Run immediately after creating
        </label>
        {runNow && (
          <label className="ab-label">Input for first run
            <textarea className="ab-textarea" rows={2} value={input} onChange={e => onChangeInput(e.target.value)}
              placeholder="Paste context or question to run the agent against…" />
          </label>
        )}
        <button className="ab-spawn-btn" onClick={onSpawn} disabled={saving || !name.trim() || !prompt.trim()}>
          {saving ? <><span className="helix-spinner-xs" /> Creating…</> : "Create Agent"}
        </button>
        {runResult && (
          <div className="ab-run-result">
            <div className="ab-run-result-label">Last Run Result:</div>
            <div className="ab-run-result-text">{runResult.slice(0, 500)}{runResult.length > 500 ? "…" : ""}</div>
          </div>
        )}
      </div>

      {customAgents.length > 0 && (
        <div className="ab-custom-list">
          <div className="ab-custom-title">Custom Agents ({customAgents.length})</div>
          {customAgents.map(a => (
            <div key={a.id} className="ab-custom-card">
              <div className="ab-custom-name">{a.name}</div>
              <div className="ab-custom-meta">{a.trigger_type} · {a.output_format} · {a.run_count ?? 0} runs</div>
              {a.last_result && <div className="ab-custom-result">{a.last_result.length > 80 ? a.last_result.slice(0, 80) + "…" : a.last_result}</div>}
              <button className="ab-custom-del" onClick={() => onDelete(a.id!)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Wave 10: Agent Constellation Overlay ────────────────────────────────────
const AGENT_CATEGORY_COLORS: Record<string, string> = {
  core: "#4afff0", evidence: "#4a9eff", strategy: "#4aff9e",
  construction: "#ff9e4a", memory: "#9e4aff", synthesis: "#ffe14a", custom: "#ff6bb5",
};

export function AgentConstellationOverlay({ agents, onClose }: {
  agents: AgentState[];
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("all");
  const [selectedAgent, setSelectedAgent] = useState<AgentState | null>(null);
  const categories = ["all", "core", "evidence", "strategy", "construction", "memory", "synthesis", "custom"];
  const filtered = filter === "all" ? agents : agents.filter(a => a.category === filter);
  const byCategory = categories.slice(1).reduce((acc, cat) => {
    acc[cat] = agents.filter(a => a.category === cat);
    return acc;
  }, {} as Record<string, AgentState[]>);

  useEffect(() => {
    if (containerRef.current) gsap.fromTo(containerRef.current, { opacity: 0, y: 14, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "power3.out" });
  }, []);

  return (
    <div ref={containerRef} className="ac-overlay" onClick={onClose}>
      <div className="ac-panel" onClick={e => e.stopPropagation()}>
        <div className="ac-header">
          <span className="ac-wordmark">AGENT CONSTELLATION</span>
          <div className="ac-stats">
            <span className="ac-stat active">{agents.filter(a => a.status === "active").length} active</span>
            <span className="ac-stat total">{agents.length} total</span>
          </div>
          <button className="ac-close" onClick={onClose}>✕</button>
        </div>

        {/* Category filter pills */}
        <div className="ac-filters">
          {categories.map(cat => (
            <button key={cat} className={`ac-filter-pill${filter === cat ? " active" : ""}`}
              style={filter === cat && cat !== "all" ? { borderColor: AGENT_CATEGORY_COLORS[cat], color: AGENT_CATEGORY_COLORS[cat] } : {}}
              onClick={() => setFilter(cat)}>
              {cat}
              <span className="ac-filter-count">
                {cat === "all" ? agents.length : (byCategory[cat]?.length ?? 0)}
              </span>
            </button>
          ))}
        </div>

        <div className="ac-body">
          {/* Constellation visual — radial layout */}
          <div className="ac-constellation">
            {categories.slice(1).map((cat, ci) => {
              const catAgents = byCategory[cat] ?? [];
              if (catAgents.length === 0) return null;
              const angle = (ci / categories.slice(1).length) * Math.PI * 2;
              const cx = 50 + 38 * Math.cos(angle);
              const cy = 50 + 38 * Math.sin(angle);
              return (
                <div key={cat} className="ac-cluster"
                  style={{ left: `${cx}%`, top: `${cy}%`, transform: "translate(-50%,-50%)" }}>
                  <div className="ac-cluster-label" style={{ color: AGENT_CATEGORY_COLORS[cat] }}>{cat}</div>
                  <div className="ac-cluster-dots">
                    {catAgents.slice(0, 5).map(a => (
                      <div key={a.id} className={`ac-dot ac-dot--${a.status}`}
                        style={{ background: AGENT_CATEGORY_COLORS[cat] }}
                        onClick={() => setSelectedAgent(a)}
                        title={a.name} />
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="ac-core-orb">HELIX</div>
          </div>

          {/* Agent list */}
          <div className="ac-agent-list">
            {filtered.map(agent => (
              <div key={agent.id} className={`ac-agent-card${selectedAgent?.id === agent.id ? " selected" : ""}`}
                onClick={() => setSelectedAgent(prev => prev?.id === agent.id ? null : agent)}>
                <div className="ac-agent-head">
                  <span className="ac-agent-dot" style={{ background: AGENT_CATEGORY_COLORS[agent.category] ?? "#4a9eff" }}
                    data-status={agent.status} />
                  <span className="ac-agent-name">{agent.name}</span>
                  <span className={`ac-agent-status ac-agent-status--${agent.status}`}>{agent.status}</span>
                </div>
                <div className="ac-agent-role">{agent.role}</div>
                {selectedAgent?.id === agent.id && agent.last_result && (
                  <div className="ac-agent-result">{agent.last_result.slice(0, 200)}</div>
                )}
                {selectedAgent?.id === agent.id && agent.last_run_at && (
                  <div className="ac-agent-meta">Last run: {new Date(agent.last_run_at).toLocaleString()}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
