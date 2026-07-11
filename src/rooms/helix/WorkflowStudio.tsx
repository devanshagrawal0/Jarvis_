import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import gsap from "gsap";
import {
  WFWorkflow,
  WFGraph,
  WFNode,
  WFEdge,
  WFNodeType,
  WFRun,
  WFNodeRun,
  HelixProject,
  HelixEntry,
} from "./helix-types";

const WF_NODE_META: Record<WFNodeType, { icon: string; color: string; desc: string }> = {
  query:     { icon: "⊕", color: "#ffe14a", desc: "Ask Gemini a question, creates a new finding" },
  filter:    { icon: "⊘", color: "#4a9eff", desc: "Filter existing entries by strand, confidence, or keyword" },
  verify:    { icon: "⊛", color: "#ff6b6b", desc: "Red-team verify findings from adversarial angles" },
  analyze:   { icon: "⊕", color: "#9e4aff", desc: "Extract assumptions, risks, or contradictions" },
  summarize: { icon: "◎", color: "#4aff9e", desc: "Synthesize multiple inputs into a coherent summary" },
  store:     { icon: "⊞", color: "#4afff0", desc: "Save result to the Vault" },
};

const NODE_W = 156;
const NODE_H = 58;

interface WorkflowStudioProps {
  workflows: WFWorkflow[];
  activeId: string | null;
  graph: WFGraph;
  selectedNodeId: string | null;
  run: WFRun | null;
  nodeRuns: WFNodeRun[];
  running: boolean;
  runHistory: WFRun[];
  rightPanel: "config" | "log";
  saving: boolean;
  edgeDraw: { fromId: string } | null;
  onOpenWorkflow: (wf: WFWorkflow) => void;
  onNewWorkflow: () => void;
  onDeleteWorkflow: (id: string) => void;
  onSaveGraph: () => void;
  onRunWorkflow: () => void;
  onAddNode: (type: WFNodeType) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onSelectNode: (id: string | null) => void;
  onAddEdge: (from: string, to: string) => void;
  onRemoveEdge: (id: string) => void;
  onDeleteNode: (id: string) => void;
  onUpdateNode: (id: string, patch: Partial<WFNode>) => void;
  onSetRightPanel: (p: "config" | "log") => void;
  onSetEdgeDraw: (d: { fromId: string } | null) => void;
  onClose: () => void;
}

function WorkflowStudio({
  workflows, activeId, graph, selectedNodeId, run, nodeRuns, running,
  runHistory, rightPanel, saving, edgeDraw,
  onOpenWorkflow, onNewWorkflow, onDeleteWorkflow, onSaveGraph, onRunWorkflow,
  onAddNode, onMoveNode, onSelectNode, onAddEdge, onRemoveEdge, onDeleteNode,
  onUpdateNode, onSetRightPanel, onSetEdgeDraw, onClose,
}: WorkflowStudioProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ nodeId: string; ox: number; oy: number; startX: number; startY: number } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (containerRef.current) gsap.fromTo(containerRef.current, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out" });
  }, []);

  const activeWorkflow = workflows.find(w => w.id === activeId) ?? null;
  const isBuiltin = activeWorkflow?.is_builtin === 1;
  const selectedNode = graph.nodes.find(n => n.id === selectedNodeId) ?? null;
  const nodeRunMap: Record<string, WFNodeRun> = {};
  for (const nr of nodeRuns) nodeRunMap[nr.node_id] = nr;

  function getOutputPort(n: WFNode) { return { x: n.x + NODE_W, y: n.y + NODE_H / 2 }; }
  function getInputPort(n: WFNode) { return { x: n.x, y: n.y + NODE_H / 2 }; }

  function bezier(ax: number, ay: number, bx: number, by: number) {
    const cp = Math.abs(bx - ax) * 0.5;
    return `M ${ax} ${ay} C ${ax + cp} ${ay} ${bx - cp} ${by} ${bx} ${by}`;
  }

  function onCanvasMouseMove(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setMousePos({ x: mx, y: my });
    if (drag) onMoveNode(drag.nodeId, drag.ox + (e.clientX - drag.startX), drag.oy + (e.clientY - drag.startY));
  }

  function onCanvasMouseUp() { setDrag(null); }

  function onCanvasClick() {
    if (!edgeDraw) onSelectNode(null);
    onSetEdgeDraw(null);
  }

  function onNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return;
    setDrag({ nodeId, ox: node.x, oy: node.y, startX: e.clientX, startY: e.clientY });
    onSelectNode(nodeId);
  }

  function onOutputPortClick(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation();
    if (edgeDraw) {
      if (edgeDraw.fromId !== nodeId) onAddEdge(edgeDraw.fromId, nodeId);
      onSetEdgeDraw(null);
    } else {
      onSetEdgeDraw({ fromId: nodeId });
    }
  }

  function onInputPortClick(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation();
    if (edgeDraw && edgeDraw.fromId !== nodeId) {
      onAddEdge(edgeDraw.fromId, nodeId);
    }
  }

  const builtin = workflows.filter(w => w.is_builtin === 1);
  const custom = workflows.filter(w => !w.is_builtin);

  return (
    <div ref={containerRef} className="wf-studio" onClick={onCanvasClick}>
      {/* ── Left sidebar: gallery + workflows ─── */}
      <div className="wf-sidebar" onClick={e => e.stopPropagation()}>
        <div className="wf-sidebar-head">
          <span className="wf-sidebar-title">⚡ Workflow Studio</span>
          <button className="wf-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="wf-section-label">Built-in Pipelines</div>
        {builtin.map(wf => (
          <div key={wf.id} className={`wf-gallery-card${activeId === wf.id ? " active" : ""}`} onClick={() => onOpenWorkflow(wf)}>
            <div className="wf-gallery-name">{wf.name}</div>
            <div className="wf-gallery-desc">{wf.description}</div>
            <div className="wf-gallery-meta">{(() => { try { return JSON.parse(wf.graph_json || "{}").nodes?.length ?? 0; } catch { return 0; } })()} nodes</div>
          </div>
        ))}

        <div className="wf-section-label" style={{ marginTop: 16 }}>
          My Workflows
          <button className="wf-new-btn" onClick={onNewWorkflow}>+ New</button>
        </div>
        {custom.length === 0 && <div className="wf-gallery-empty">No custom workflows yet</div>}
        {custom.map(wf => (
          <div key={wf.id} className={`wf-gallery-card custom${activeId === wf.id ? " active" : ""}`} onClick={() => onOpenWorkflow(wf)}>
            <div className="wf-gallery-name">{wf.name}</div>
            <div className="wf-gallery-meta">{(() => { try { return JSON.parse(wf.graph_json || "{}").nodes?.length ?? 0; } catch { return 0; } })()} nodes</div>
            <button className="wf-gallery-del" onClick={e => { e.stopPropagation(); onDeleteWorkflow(wf.id); }}>✕</button>
          </div>
        ))}

        {runHistory.length > 0 && (
          <>
            <div className="wf-section-label" style={{ marginTop: 16 }}>Recent Runs</div>
            {runHistory.slice(0, 5).map(r => (
              <div key={r.id} className={`wf-run-history-item wf-run-history--${r.status}`}>
                <span className="wf-run-history-status">{r.status === "complete" ? "✓" : r.status === "failed" ? "✕" : "⟳"}</span>
                <span className="wf-run-history-time">{new Date(r.started_at).toLocaleTimeString()}</span>
                <span className="wf-run-history-summary">{r.result_summary}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Center: canvas ────────────────────── */}
      <div className="wf-canvas-area" onClick={e => e.stopPropagation()}>
        {!activeWorkflow && (
          <div className="wf-canvas-empty">
            <div className="wf-canvas-empty-icon">⚡</div>
            <div className="wf-canvas-empty-title">Select a workflow to edit</div>
            <div className="wf-canvas-empty-sub">Choose a built-in pipeline or create your own</div>
          </div>
        )}
        {activeWorkflow && (
          <>
            <div className="wf-canvas-topbar">
              <div className="wf-canvas-name">{activeWorkflow.name}</div>
              <div className="wf-canvas-actions">
                {!isBuiltin && (
                  <>
                    <span className="wf-palette-label">Add node:</span>
                    {(Object.keys(WF_NODE_META) as WFNodeType[]).map(type => (
                      <button key={type} className="wf-palette-btn" style={{ "--node-color": WF_NODE_META[type].color } as React.CSSProperties}
                        onClick={() => onAddNode(type)} title={WF_NODE_META[type].desc}>
                        {WF_NODE_META[type].icon} {type}
                      </button>
                    ))}
                    <button className="wf-save-btn" onClick={onSaveGraph} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                  </>
                )}
                <button className={`wf-run-btn${running ? " running" : ""}`} onClick={onRunWorkflow} disabled={running}>
                  {running ? "⟳ Running…" : "▶ Run"}
                </button>
              </div>
            </div>

            {edgeDraw && (
              <div className="wf-edge-hint">Click a node's input port (left dot) to connect · Click canvas to cancel</div>
            )}

            <div
              className="wf-canvas"
              ref={canvasRef}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
            >
              <svg className="wf-canvas-svg">
                {graph.edges.map(e => {
                  const fn = graph.nodes.find(n => n.id === e.from);
                  const tn = graph.nodes.find(n => n.id === e.to);
                  if (!fn || !tn) return null;
                  const fp = getOutputPort(fn);
                  const tp = getInputPort(tn);
                  return (
                    <g key={e.id}>
                      <path d={bezier(fp.x, fp.y, tp.x, tp.y)} className="wf-edge-hit" onClick={ev => { ev.stopPropagation(); if (!isBuiltin) onRemoveEdge(e.id); }} />
                      <path d={bezier(fp.x, fp.y, tp.x, tp.y)} className="wf-edge" />
                      <polygon points={`${tp.x},${tp.y} ${tp.x - 10},${tp.y - 5} ${tp.x - 10},${tp.y + 5}`} className="wf-edge-arrow" />
                    </g>
                  );
                })}
                {edgeDraw && (() => {
                  const fn = graph.nodes.find(n => n.id === edgeDraw.fromId);
                  if (!fn) return null;
                  const fp = getOutputPort(fn);
                  return <path d={bezier(fp.x, fp.y, mousePos.x, mousePos.y)} className="wf-edge-drawing" />;
                })()}
              </svg>

              {graph.nodes.map(node => {
                const nr = nodeRunMap[node.id];
                const status = nr?.status ?? "idle";
                const meta = WF_NODE_META[node.type] ?? WF_NODE_META.query;
                return (
                  <div
                    key={node.id}
                    className={`wf-node wf-node--${node.type} wf-node--${status}${selectedNodeId === node.id ? " wf-node--selected" : ""}`}
                    style={{ left: node.x, top: node.y, "--node-color": meta.color } as React.CSSProperties}
                    onMouseDown={e => onNodeMouseDown(e, node.id)}
                  >
                    <div className="wf-node-input-port" onClick={e => onInputPortClick(e, node.id)} />
                    <div className="wf-node-body">
                      <span className="wf-node-icon">{meta.icon}</span>
                      <div className="wf-node-text">
                        <span className="wf-node-label">{node.label}</span>
                        <span className="wf-node-type">{node.type}</span>
                      </div>
                    </div>
                    <div className="wf-node-output-port" onClick={e => onOutputPortClick(e, node.id)} />
                    {nr && (
                      <div className={`wf-node-run-badge wf-node-run-badge--${nr.status}`}>
                        {nr.status === "running" ? "⟳" : nr.status === "complete" ? "✓" : nr.status === "failed" ? "✕" : "…"}
                      </div>
                    )}
                    {!isBuiltin && (
                      <button className="wf-node-del" onClick={e => { e.stopPropagation(); onDeleteNode(node.id); }}>✕</button>
                    )}
                  </div>
                );
              })}

              {graph.nodes.length === 0 && (
                <div className="wf-canvas-placeholder">
                  {isBuiltin ? "Built-in workflow — read-only" : "Add nodes from the palette above, then connect them by clicking output → input ports"}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Right panel: node config or run log ─ */}
      <div className="wf-right" onClick={e => e.stopPropagation()}>
        <div className="wf-right-tabs">
          <button className={`wf-right-tab${rightPanel === "config" ? " active" : ""}`} onClick={() => onSetRightPanel("config")}>Config</button>
          <button className={`wf-right-tab${rightPanel === "log" ? " active" : ""}`} onClick={() => onSetRightPanel("log")}>Run Log</button>
        </div>

        {rightPanel === "config" && (
          <div className="wf-config">
            {!selectedNode && (
              <div className="wf-config-empty">
                <div className="wf-config-empty-icon">⊕</div>
                <div>Select a node to configure it</div>
              </div>
            )}
            {selectedNode && (
              <WFNodeConfig node={selectedNode} isBuiltin={isBuiltin} onChange={patch => onUpdateNode(selectedNode.id, patch)} />
            )}
          </div>
        )}

        {rightPanel === "log" && (
          <div className="wf-log">
            {!run && !running && (
              <div className="wf-config-empty">
                <div className="wf-config-empty-icon">▶</div>
                <div>Run the workflow to see live output here</div>
              </div>
            )}
            {(run || running) && (
              <>
                <div className={`wf-log-status wf-log-status--${run?.status ?? "running"}`}>
                  {run?.status === "complete" ? "✓ Complete" : run?.status === "failed" ? "✕ Failed" : "⟳ Running…"}
                  {run?.result_summary && <span className="wf-log-summary">{run.result_summary}</span>}
                </div>
                {nodeRuns.map(nr => (
                  <div key={nr.id} className={`wf-log-node wf-log-node--${nr.status}`}>
                    <div className="wf-log-node-head">
                      <span className="wf-log-node-badge">{nr.status === "running" ? "⟳" : nr.status === "complete" ? "✓" : nr.status === "failed" ? "✕" : "…"}</span>
                      <span className="wf-log-node-label">{nr.node_label}</span>
                      <span className="wf-log-node-type">{nr.node_type}</span>
                      {nr.started_at && nr.completed_at && (
                        <span className="wf-log-node-time">{((new Date(nr.completed_at).getTime() - new Date(nr.started_at).getTime()) / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {nr.status === "complete" && nr.output_json && (() => {
                      try {
                        const out = JSON.parse(nr.output_json) as { text?: string; summary?: string; entryCount?: number };
                        return (
                          <div className="wf-log-node-out">
                            {out.entryCount !== undefined && <span className="wf-log-node-count">{out.entryCount} entries</span>}
                            {out.summary && <p className="wf-log-node-summary">{out.summary}</p>}
                          </div>
                        );
                      } catch { return null; }
                    })()}
                    {nr.status === "failed" && nr.error && (
                      <div className="wf-log-node-error">{nr.error}</div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WFNodeConfig({ node, isBuiltin, onChange }: { node: WFNode; isBuiltin: boolean; onChange: (patch: Partial<WFNode>) => void }) {
  const meta = WF_NODE_META[node.type];
  const cfg = node.config || {};
  const disabled = isBuiltin;

  return (
    <div className="wf-node-config">
      <div className="wf-node-config-head" style={{ "--node-color": meta.color } as React.CSSProperties}>
        <span className="wf-node-config-icon">{meta.icon}</span>
        <span className="wf-node-config-type">{node.type}</span>
      </div>
      <label className="wf-cfg-label">Label
        <input className="wf-cfg-input" value={node.label} disabled={disabled}
          onChange={e => onChange({ label: e.target.value })} />
      </label>
      <div className="wf-cfg-divider">{meta.desc}</div>

      {node.type === "query" && (
        <>
          <label className="wf-cfg-label">Prompt
            <textarea className="wf-cfg-textarea" value={String(cfg.prompt ?? "")} disabled={disabled} rows={4}
              onChange={e => onChange({ config: { ...cfg, prompt: e.target.value } })} />
          </label>
          <label className="wf-cfg-label">Strand
            <select className="wf-cfg-select" value={String(cfg.strand ?? "evidence")} disabled={disabled}
              onChange={e => onChange({ config: { ...cfg, strand: e.target.value } })}>
              {["evidence","strategy","construction","memory","signal","synthesis"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </>
      )}
      {node.type === "filter" && (
        <>
          <label className="wf-cfg-label">Strand (blank = all)
            <select className="wf-cfg-select" value={String(cfg.strand ?? "")} disabled={disabled}
              onChange={e => onChange({ config: { ...cfg, strand: e.target.value } })}>
              <option value="">all strands</option>
              {["evidence","strategy","construction","memory","signal","synthesis"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="wf-cfg-label">Min confidence (0–1)
            <input type="number" className="wf-cfg-input" value={Number(cfg.min_confidence ?? 0)} min={0} max={1} step={0.1} disabled={disabled}
              onChange={e => onChange({ config: { ...cfg, min_confidence: parseFloat(e.target.value) || 0 } })} />
          </label>
          <label className="wf-cfg-label">Keyword (optional)
            <input className="wf-cfg-input" value={String(cfg.keyword ?? "")} disabled={disabled}
              onChange={e => onChange({ config: { ...cfg, keyword: e.target.value } })} />
          </label>
          <label className="wf-cfg-label">Max entries
            <input type="number" className="wf-cfg-input" value={Number(cfg.limit ?? 15)} min={1} max={30} disabled={disabled}
              onChange={e => onChange({ config: { ...cfg, limit: parseInt(e.target.value) || 15 } })} />
          </label>
        </>
      )}
      {node.type === "verify" && (
        <label className="wf-cfg-label">Verification depth (1-3 angles)
          <input type="number" className="wf-cfg-input" value={Number(cfg.depth ?? 2)} min={1} max={3} disabled={disabled}
            onChange={e => onChange({ config: { ...cfg, depth: parseInt(e.target.value) || 2 } })} />
        </label>
      )}
      {node.type === "analyze" && (
        <label className="wf-cfg-label">Analysis type
          <select className="wf-cfg-select" value={String(cfg.analysis_type ?? "assumptions")} disabled={disabled}
            onChange={e => onChange({ config: { ...cfg, analysis_type: e.target.value } })}>
            <option value="assumptions">Assumptions</option>
            <option value="risks">Risks</option>
            <option value="contradictions">Contradictions</option>
          </select>
        </label>
      )}
      {node.type === "summarize" && (
        <label className="wf-cfg-label">Instructions
          <textarea className="wf-cfg-textarea" value={String(cfg.instructions ?? "")} disabled={disabled} rows={4}
            onChange={e => onChange({ config: { ...cfg, instructions: e.target.value } })} />
        </label>
      )}
      {node.type === "store" && (
        <label className="wf-cfg-label">Vault label
          <input className="wf-cfg-input" value={String(cfg.vault_label ?? "Workflow Result")} disabled={disabled}
            onChange={e => onChange({ config: { ...cfg, vault_label: e.target.value } })} />
        </label>
      )}
    </div>
  );
}

export { WorkflowStudio, WFNodeConfig };
