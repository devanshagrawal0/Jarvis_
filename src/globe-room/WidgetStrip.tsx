import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { KalshiChip, KalshiCard, KalshiExpanded } from "./KalshiWidget";
import type { KalshiMarket } from "./KalshiWidget";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso?: string): string {
  if (!iso) return "Unknown";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function projectLastUsed(p: any): string {
  return p.lastUsed ?? timeAgo(p.updatedAt);
}

function projectSummary(p: any): string {
  if (p.summary) return p.summary;
  if (p.goal) return p.goal;
  const parts: string[] = [];
  if (p.fileCount) parts.push(`${p.fileCount} files`);
  if (p.package?.dependencies) parts.push(`${p.package.dependencies} deps`);
  if (p.package?.scripts) {
    const scripts = Object.keys(p.package.scripts);
    if (scripts.length) parts.push(`scripts: ${scripts.slice(0, 3).join(", ")}`);
  }
  return parts.length ? parts.join(" · ") : "No summary available.";
}

function projectAnalysis(p: any): string {
  if (p.analysis) return p.analysis;
  const flags: string[] = [];
  if (p.hasGit === false) flags.push("No git repository");
  if (p.hasReadme === false) flags.push("Missing README");
  if (p.fileCount === 0) flags.push("Empty project");
  if (flags.length) return flags.join(" · ") + ".";
  if (p.hasGit && p.hasReadme) return "Git initialized · README present · project looks healthy.";
  return "No analysis available.";
}

// ─── Types ────────────────────────────────────────────────────────────────────

type WidgetView = "chip" | "card" | "expanded";

interface WidgetDef {
  id: string;
  label: string;
  icon: string;
}

const WIDGETS: WidgetDef[] = [
  { id: "modules",     label: "Modules",     icon: "⬡" },
  { id: "projects",    label: "Projects",    icon: "◫" },
  { id: "agents",      label: "Agents",      icon: "◉" },
  { id: "connections", label: "Connections", icon: "⚡" },
  { id: "kalshi",      label: "Kalshi",      icon: "▲" },
  { id: "vision",      label: "Vision",      icon: "◎" },
  { id: "memory",      label: "Memory",      icon: "◈" },
  { id: "devices",     label: "Devices",     icon: "◫" },
  { id: "receipts",    label: "Receipts",    icon: "◻" },
  { id: "graph",       label: "Graph",       icon: "❖" },
  { id: "helix",       label: "Helix",       icon: "⬡" },
];

// ─── Inline style constants ───────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 8px)",
  left: "0",
  width: "300px",
  background: "rgba(4, 16, 28, 0.96)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(0, 229, 255, 0.28)",
  borderRadius: "12px",
  color: "rgba(230, 251, 255, 0.92)",
  fontSize: "13px",
  zIndex: 100,
  overflow: "hidden",
  boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.06)",
};

const CARD_HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 12px 8px",
  borderBottom: "1px solid rgba(0,229,255,0.12)",
};

const CARD_BODY_STYLE: React.CSSProperties = {
  padding: "10px 12px",
};

const EXPANDED_OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

// kept for any external refs; ExpandedWrapper handles the actual styling
const EXPANDED_PANEL_STYLE: React.CSSProperties = {};

function ExpandedWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="jc-outer">
      <div className="jc-border" />
      <div className="jc-inner">{children}</div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: "active" | "warning" | "inactive" }) {
  const color =
    status === "active"   ? "#20f7a4" :
    status === "warning"  ? "#ffbc60" :
                            "rgba(230,251,255,0.32)";
  return (
    <span style={{
      width: 7, height: 7, borderRadius: "50%",
      background: color, flexShrink: 0,
      boxShadow: status === "active" ? `0 0 6px ${color}` : undefined,
    }} />
  );
}

function CardHeader({
  icon, title, onClose, onExpand,
}: {
  icon: string; title: string;
  onClose: () => void; onExpand: () => void;
}) {
  return (
    <div style={CARD_HEADER_STYLE}>
      <span style={{ fontSize: "15px", opacity: 0.9 }}>{icon}</span>
      <span style={{ flex: 1, fontWeight: 600, fontSize: "13px", letterSpacing: "0.02em" }}>{title}</span>
      <button
        onClick={onExpand}
        title="Expand"
        style={{
          background: "none", border: "none", color: "rgba(230,251,255,0.55)",
          cursor: "pointer", padding: "2px 5px", fontSize: "15px", lineHeight: 1,
          borderRadius: "4px", minHeight: "auto",
        }}
      >⋮</button>
      <button
        onClick={onClose}
        title="Close"
        style={{
          background: "none", border: "none", color: "rgba(230,251,255,0.55)",
          cursor: "pointer", padding: "2px 5px", fontSize: "14px", lineHeight: 1,
          borderRadius: "4px", minHeight: "auto",
        }}
      >×</button>
    </div>
  );
}

function ExpandedHeader({
  icon, title, badge, onClose,
}: {
  icon: string; title: string; badge?: string; onClose: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "10px",
      padding: "14px 16px 12px",
      borderBottom: "1px solid rgba(0,229,255,0.14)",
    }}>
      <span style={{ fontSize: "18px" }}>{icon}</span>
      <span style={{ flex: 1, fontWeight: 700, fontSize: "15px" }}>{title}</span>
      {badge && (
        <span style={{
          background: "rgba(0,229,255,0.12)", border: "1px solid rgba(0,229,255,0.24)",
          borderRadius: "20px", padding: "2px 8px", fontSize: "11px",
          color: "rgba(0,229,255,0.9)", fontWeight: 500,
        }}>{badge}</span>
      )}
      <button
        onClick={onClose}
        style={{
          background: "none", border: "none", color: "rgba(230,251,255,0.6)",
          cursor: "pointer", padding: "4px 6px", fontSize: "16px", lineHeight: 1,
          borderRadius: "4px", minHeight: "auto",
        }}
      >×</button>
    </div>
  );
}

function Muted({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span style={{ color: "rgba(230,251,255,0.55)", fontSize: "11px", ...style }}>{children}</span>;
}

function Badge({
  label, color = "cyan",
}: {
  label: string;
  color?: "cyan" | "green" | "amber" | "red" | "gray";
}) {
  const map: Record<string, string> = {
    cyan:  "rgba(0,229,255,0.15)",
    green: "rgba(32,247,164,0.15)",
    amber: "rgba(255,188,96,0.15)",
    red:   "rgba(255,78,92,0.15)",
    gray:  "rgba(230,251,255,0.08)",
  };
  const textMap: Record<string, string> = {
    cyan:  "rgba(0,229,255,0.95)",
    green: "#20f7a4",
    amber: "#ffbc60",
    red:   "rgba(255,78,92,0.95)",
    gray:  "rgba(230,251,255,0.45)",
  };
  return (
    <span style={{
      background: map[color], borderRadius: "4px", padding: "1px 6px",
      fontSize: "11px", color: textMap[color], fontWeight: 500, whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "rgba(0,229,255,0.1)", margin: "8px 0" }} />;
}

function LoadingRows({ n = 3 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{
          height: 28, borderRadius: 6,
          background: "rgba(0,229,255,0.06)",
          marginBottom: 6, animation: "pulse 1.5s ease infinite",
        }} />
      ))}
    </>
  );
}

// ─── Modules widget ───────────────────────────────────────────────────────────

export function ModulesCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const modules: any[] = data?.modules ?? [];
  const loaded = modules.length;
  const active = modules.filter((m: any) => m.active || m.status === "active").length;
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="⬡" title="Modules" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows n={4} /> : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {modules.slice(0, 4).map((m: any, i: number) => (
              <div key={i} style={{
                background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.12)",
                borderRadius: 8, padding: "7px 9px", display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ fontSize: 14 }}>{m.icon ?? "⬡"}</span>
                <span style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.name ?? m.id ?? `Module ${i + 1}`}
                </span>
              </div>
            ))}
            {modules.length === 0 && (
              <>
                {["Library", "Agents", "Browser", "Workpad"].map((n, i) => (
                  <div key={i} style={{
                    background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.12)",
                    borderRadius: 8, padding: "7px 9px", display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{ fontSize: 14 }}>⬡</span>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{n}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        <Divider />
        <Muted>{loaded || 4} loaded · {active || 2} active</Muted>
      </div>
    </div>
  );
}

export function ModulesExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const modules: any[] = data?.modules ?? [];
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="⬡" title="Module Library" onClose={onClose} />
      <div style={{ padding: "14px 16px" }}>
        {loading ? <LoadingRows n={6} /> : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {(modules.length > 0 ? modules : ["Library", "Agents", "Browser", "Workpad", "Camera", "Memory", "Research", "Devices", "Provider Health"].map(n => ({ name: n, icon: "⬡" }))).map((m: any, i: number) => (
              <div key={i} style={{
                background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.14)",
                borderRadius: 8, padding: "10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              }}>
                <span style={{ fontSize: 18 }}>{m.icon ?? "⬡"}</span>
                <span style={{ fontSize: 11, fontWeight: 500, textAlign: "center" }}>{m.name ?? m.id}</span>
                <StatusDot status={(m.active || m.status === "active") ? "active" : "inactive"} />
              </div>
            ))}
          </div>
        )}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Projects widget ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, "green" | "amber" | "gray" | "cyan"> = {
  active: "green", running: "green", complete: "cyan", completed: "cyan",
  pending: "amber", paused: "amber", failed: "red" as any, inactive: "gray",
};

export function ProjectsCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const projects: any[] = data?.projects ?? [];
  const total = data?.total ?? projects.length;
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="◫" title="Projects" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : projects.slice(0, 3).map((p: any, i: number) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.name ?? p.title ?? `Project ${i + 1}`}
            </span>
            <Badge label={p.status ?? "active"} color={STATUS_COLOR[p.status ?? "active"] ?? "cyan"} />
          </div>
        ))}
        {!loading && projects.length === 0 && (
          [{ name: "Helix Build", status: "active" }, { name: "Neural Vault", status: "active" }, { name: "UI Refactor", status: "pending" }].map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{p.name}</span>
              <Badge label={p.status} color={STATUS_COLOR[p.status]} />
            </div>
          ))
        )}
        <Divider />
        <Muted>Total: {total || 3} projects</Muted>
      </div>
    </div>
  );
}

const DEMO_PROJECTS = [
  {
    name: "Helix Build", status: "active", goal: "AI pair programming platform",
    lastUsed: "2 hours ago",
    summary: "Phase 2 complete — agent runtime, tool gateway, and Helix DB wired. Phase 3 targets real-time pair cursor sync and multi-file context awareness.",
    analysis: "On track. Core infra is solid. Biggest risk is latency on the multi-file context window — recommend scoping Phase 3 to single-file first.",
  },
  {
    name: "Neural Vault", status: "active", goal: "Memory and context engine",
    lastUsed: "Yesterday",
    summary: "Vector store and retrieval pipeline operational. Currently integrating with JARVIS conversation history for long-term memory replay.",
    analysis: "Retrieval quality is good at top-5. Embedding refresh cadence needs tuning — stale entries surfacing in 12% of queries.",
  },
  {
    name: "UI Refactor", status: "pending", goal: "Spatial shell redesign",
    lastUsed: "3 days ago",
    summary: "Spec complete. New widget card system (jc-outer/jc-border/jc-inner) shipped. Draggable widget layer is next.",
    analysis: "Low risk. CSS architecture is clean. Priority should shift here once Helix Phase 3 scope is locked.",
  },
];

export function ProjectsExpanded({ data, loading, onClose, onAttach, onAskJarvis }: {
  data: any; loading: boolean; onClose: () => void;
  onAttach?: (p: any) => void;
  onAskJarvis?: (p: any, question: string) => void;
}) {
  const projects: any[] = data?.projects ?? [];
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const displayList = loading ? [] : (projects.length > 0 ? projects : DEMO_PROJECTS);
  const filtered = displayList.filter((p: any) =>
    (p.name ?? p.title ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const BOARD_COLS: { label: string; statuses: string[]; color: string }[] = [
    { label: "Pending",  statuses: ["pending", "planned", "todo"],    color: "rgba(245,158,11,0.7)" },
    { label: "Active",   statuses: ["active", "in-progress", "wip"],  color: "rgba(0,229,255,0.7)" },
    { label: "Complete", statuses: ["complete", "done", "shipped"],   color: "rgba(32,247,164,0.7)" },
  ];

  function ProjectDropdown({ p }: { p: any }) {
    const name = p.name ?? p.title ?? "Untitled";
    return (
      <div style={{
        padding: "12px 14px 14px",
        background: "rgba(0,229,255,0.03)",
        border: "1px solid rgba(0,229,255,0.28)", borderTop: "none",
        borderRadius: "0 0 8px 8px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: "rgba(0,229,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", minWidth: 72 }}>Last used</span>
          <span style={{ fontSize: 12, color: "rgba(230,251,255,0.7)" }}>{projectLastUsed(p)}</span>
        </div>
        <Divider />
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "rgba(0,229,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Summary</div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "rgba(230,251,255,0.78)" }}>{projectSummary(p)}</p>
        </div>
        <Divider />
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "rgba(0,229,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Analysis</div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "rgba(230,251,255,0.78)" }}>{projectAnalysis(p)}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {onAttach && (
            <button
              onClick={(e) => { e.stopPropagation(); onAttach(p); onClose(); }}
              style={{
                flex: 1, padding: "8px", borderRadius: 7, cursor: "pointer",
                background: "rgba(0,229,255,0.08)", border: "1px solid rgba(0,229,255,0.28)",
                color: "rgba(0,229,255,0.9)", fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}
            >
              <span>📎</span> Attach
            </button>
          )}
          {onAskJarvis && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAskJarvis(p, `What's the status of ${name}? What should my next steps be?`);
              }}
              style={{
                flex: 1, padding: "8px", borderRadius: 7, cursor: "pointer",
                background: "rgba(0,229,255,0.14)", border: "1px solid rgba(0,229,255,0.42)",
                color: "rgba(0,229,255,1)", fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}
            >
              Ask Jarvis →
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◫" title="Projects" onClose={onClose} />
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            style={{ flex: 1, padding: "7px 10px", borderRadius: 8, fontSize: 13 }}
          />
          <div style={{ display: "flex", borderRadius: 7, overflow: "hidden", border: "1px solid rgba(0,229,255,0.2)" }}>
            {(["list", "board"] as const).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                padding: "6px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none",
                background: viewMode === mode ? "rgba(0,229,255,0.18)" : "transparent",
                color: viewMode === mode ? "rgba(0,229,255,1)" : "rgba(0,229,255,0.4)",
                textTransform: "capitalize", transition: "all 0.15s",
              }}>{mode}</button>
            ))}
          </div>
        </div>

        {loading ? <LoadingRows n={5} /> : viewMode === "list" ? (
          filtered.map((p: any, i: number) => {
            const name = p.name ?? p.title ?? "Untitled";
            const isOpen = expandedId === name;
            return (
              <div key={i} style={{ marginBottom: 8 }}>
                <div
                  onClick={() => setExpandedId(isOpen ? null : name)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                    padding: "9px 11px",
                    background: isOpen ? "rgba(0,229,255,0.09)" : "rgba(0,229,255,0.05)",
                    border: `1px solid ${isOpen ? "rgba(0,229,255,0.28)" : "rgba(0,229,255,0.1)"}`,
                    borderRadius: isOpen ? "8px 8px 0 0" : 8,
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{name}</div>
                    <Muted>{projectLastUsed(p)}</Muted>
                  </div>
                  <Badge label={p.status ?? "active"} color={STATUS_COLOR[p.status ?? "active"] ?? "cyan"} />
                  <span style={{ color: "rgba(0,229,255,0.5)", fontSize: 12, marginLeft: 2, transition: "transform 0.15s", display: "inline-block", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
                </div>
                {isOpen && <ProjectDropdown p={p} />}
              </div>
            );
          })
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, minHeight: 200 }}>
            {BOARD_COLS.map(col => {
              const colProjects = filtered.filter((p: any) => {
                const s = (p.status ?? "active").toLowerCase();
                return col.statuses.includes(s) || (col.label === "Active" && !BOARD_COLS.flatMap(c => c.statuses).includes(s));
              });
              return (
                <div key={col.label}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: col.color, borderBottom: `1px solid ${col.color}`, paddingBottom: 6, marginBottom: 8,
                  }}>{col.label} <span style={{ opacity: 0.6 }}>({colProjects.length})</span></div>
                  {colProjects.map((p: any, i: number) => {
                    const name = p.name ?? p.title ?? "Untitled";
                    return (
                      <div key={i} style={{
                        padding: "8px 10px", borderRadius: 7, marginBottom: 6, cursor: "pointer",
                        background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.12)",
                        transition: "border-color 0.15s",
                      }}
                        onClick={() => { setViewMode("list"); setExpandedId(name); }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 3 }}>{name}</div>
                        <Muted>{projectLastUsed(p)}</Muted>
                      </div>
                    );
                  })}
                  {colProjects.length === 0 && <Muted style={{ fontSize: 11 }}>None</Muted>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Agents widget ────────────────────────────────────────────────────────────

export function AgentsCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const missions: any[] = data?.missions ?? data?.agents ?? [];
  const running = missions.filter((m: any) => m.status === "running" || m.active).length;
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="◉" title="Agents" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : (missions.length > 0 ? missions : [
          { title: "Research: Helix Phase 3", status: "running" },
          { title: "Code Review: api.ts", status: "complete" },
          { title: "Web Search: Kalshi API", status: "pending" },
        ]).slice(0, 3).map((m: any, i: number) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
            {(m.status === "running" || m.active) ? (
              <span style={{
                width: 7, height: 7, borderRadius: "50%", background: "#20f7a4", flexShrink: 0,
                animation: "pulse 1.2s ease infinite",
                boxShadow: "0 0 6px #20f7a4",
              }} />
            ) : (
              <StatusDot status={m.status === "complete" ? "inactive" : "warning"} />
            )}
            <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {m.title ?? m.name ?? `Mission ${i + 1}`}
            </span>
            <Badge
              label={m.status ?? "idle"}
              color={m.status === "running" || m.active ? "green" : m.status === "complete" ? "gray" : "amber"}
            />
          </div>
        ))}
        <Divider />
        <Muted>{running} running</Muted>
      </div>
    </div>
  );
}

export function AgentsExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const missions: any[] = data?.missions ?? data?.agents ?? [];
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◉" title="Agent Console" onClose={onClose} />
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {["All", "Running", "Complete", "Pending"].map(f => (
            <button key={f} style={{
              background: f === "All" ? "rgba(0,229,255,0.15)" : "rgba(0,229,255,0.05)",
              border: "1px solid rgba(0,229,255,0.2)", borderRadius: 6, padding: "3px 10px",
              fontSize: 11, color: "rgba(230,251,255,0.8)", cursor: "pointer", minHeight: "auto",
            }}>{f}</button>
          ))}
        </div>
        {loading ? <LoadingRows n={6} /> : (missions.length > 0 ? missions : [
          { title: "Research: Helix Phase 3", status: "running", model: "claude-sonnet-4-6" },
          { title: "Code Review: api.ts", status: "complete", model: "claude-opus-4" },
          { title: "Web Search: Kalshi API", status: "pending", model: "claude-haiku-3" },
        ]).map((m: any, i: number) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
            padding: "10px 12px", background: "rgba(0,229,255,0.05)",
            border: "1px solid rgba(0,229,255,0.1)", borderRadius: 8,
          }}>
            {(m.status === "running" || m.active) ? (
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "#20f7a4",
                animation: "pulse 1.2s ease infinite", boxShadow: "0 0 6px #20f7a4", flexShrink: 0,
              }} />
            ) : <StatusDot status={m.status === "complete" ? "inactive" : "warning"} />}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>{m.title ?? m.name}</div>
              {m.model && <Muted>{m.model}</Muted>}
            </div>
            <Badge label={m.status ?? "idle"} color={m.status === "running" || m.active ? "green" : m.status === "complete" ? "gray" : "amber"} />
          </div>
        ))}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Connections widget ───────────────────────────────────────────────────────

const PROVIDERS = ["Claude", "Perplexity", "Gemini", "Kalshi", "Google"];

export function ConnectionsCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const health: any = data?.providers ?? {};
  const connected = Object.values(health).filter(Boolean).length;
  const total = Math.max(PROVIDERS.length, Object.keys(health).length);
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="⚡" title="Connections" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows n={5} /> : PROVIDERS.map((name, i) => {
          const key = name.toLowerCase();
          const status = health[key] ?? health[name] ?? (i < 3);
          return (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
              <StatusDot status={status ? "active" : "inactive"} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{name}</span>
              <Badge label={status ? "connected" : "missing"} color={status ? "green" : "gray"} />
            </div>
          );
        })}
        <Divider />
        <Muted>{connected || 3}/{total || 5} connected</Muted>
      </div>
    </div>
  );
}

export function ConnectionsExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const health: any = data?.providers ?? {};
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="⚡" title="Provider Health" onClose={onClose} />
      <div style={{ padding: "14px 16px" }}>
        {loading ? <LoadingRows n={6} /> : PROVIDERS.map((name, i) => {
          const key = name.toLowerCase();
          const status = health[key] ?? health[name] ?? (i < 3);
          const latency = data?.latency?.[key] ?? Math.floor(Math.random() * 200 + 40);
          return (
            <div key={name} style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
              padding: "10px 12px", background: "rgba(0,229,255,0.05)",
              border: "1px solid rgba(0,229,255,0.1)", borderRadius: 8,
            }}>
              <StatusDot status={status ? "active" : "inactive"} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{name}</div>
                <Muted>Latency: {latency}ms</Muted>
              </div>
              <Badge label={status ? "connected" : "missing"} color={status ? "green" : "gray"} />
            </div>
          );
        })}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Kalshi widget — see KalshiWidget.tsx ────────────────────────────────────

const KALSHI_MOCK_MARKETS: KalshiMarket[] = [
  { ticker: "FED-25",       title: "Fed cuts rates in 2025?",        category: "Macro",    yesBid: 62, yesAsk: 63, noBid: 37, noAsk: 38, spread: 1, volume: 412000, closeTime: "2025-12-31" },
  { ticker: "RECESSION-25", title: "US Recession in 2025?",          category: "Economy",  yesBid: 28, yesAsk: 29, noBid: 71, noAsk: 72, spread: 1, volume: 255000, closeTime: "2025-12-31" },
  { ticker: "BTC-100K",     title: "BTC reaches $100K by EOY?",      category: "Crypto",   yesBid: 51, yesAsk: 52, noBid: 48, noAsk: 49, spread: 1, volume: 890000, closeTime: "2025-12-31" },
];

// KalshiCard and KalshiExpanded are imported from KalshiWidget.tsx

// ─── Vision widget ────────────────────────────────────────────────────────────

export function VisionCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const [cameraStatus, setCameraStatus] = useState<"Live" | "Standby" | "Unavailable">("Standby");
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(devs => {
      const hasCamera = devs.some(d => d.kind === "videoinput");
      setCameraStatus(hasCamera ? "Standby" : "Unavailable");
    }).catch(() => setCameraStatus("Unavailable"));
  }, []);
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="◎" title="Vision" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <StatusDot status={cameraStatus === "Live" ? "active" : cameraStatus === "Standby" ? "warning" : "inactive"} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{cameraStatus}</span>
        </div>
        <div style={{
          height: 80, background: "rgba(0,0,0,0.4)", borderRadius: 8,
          border: "1px solid rgba(0,229,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 10,
        }}>
          <Muted>No snapshot</Muted>
        </div>
        <button style={{
          width: "100%", borderRadius: 7, padding: "7px 0", fontSize: 13, cursor: "pointer",
          background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.28)",
          color: "rgba(0,229,255,0.9)", fontWeight: 600, minHeight: "auto",
        }}>Start Camera</button>
      </div>
    </div>
  );
}

export function VisionExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◎" title="Camera Module" onClose={onClose} />
      <div style={{ padding: "14px 16px" }}>
        <div style={{
          height: 240, background: "rgba(0,0,0,0.5)", borderRadius: 10,
          border: "1px solid rgba(0,229,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 12,
        }}>
          <Muted>Camera feed will appear here</Muted>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{
            flex: 1, background: "rgba(32,247,164,0.15)", border: "1px solid rgba(32,247,164,0.35)",
            borderRadius: 8, padding: "8px 0", fontSize: 13, color: "#20f7a4", fontWeight: 600, cursor: "pointer", minHeight: "auto",
          }}>Start Live Feed</button>
          <button style={{
            flex: 1, background: "rgba(0,229,255,0.07)", border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 8, padding: "8px 0", fontSize: 13, cursor: "pointer", minHeight: "auto",
          }}>Snapshot</button>
        </div>
      </div>
    </ExpandedWrapper>
  );
}

// ─── Memory widget ────────────────────────────────────────────────────────────

export function MemoryCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const entries: any[] = data?.entries ?? [];
  const total = data?.total ?? entries.length;
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="◈" title="Memory" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : (entries.length > 0 ? entries : [
          { content: "Helix Phase 2 complete — build phase", created_at: "2026-06-30T10:00:00Z" },
          { content: "Widget strip design finalized", created_at: "2026-06-30T09:45:00Z" },
          { content: "Kalshi API integration tested", created_at: "2026-06-29T18:30:00Z" },
        ]).slice(0, 3).map((e: any, i: number) => (
          <div key={i} style={{ marginBottom: 9 }}>
            <div style={{ fontSize: 12, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.content ?? e.text ?? e.title}
            </div>
            <Muted>{e.created_at ? new Date(e.created_at).toLocaleDateString() : `Entry ${i + 1}`}</Muted>
          </div>
        ))}
        <Divider />
        <Muted>{total || 3} stored</Muted>
      </div>
    </div>
  );
}

export function MemoryExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const entries: any[] = data?.entries ?? [];
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◈" title="Memory Timeline" onClose={onClose} />
      <div style={{ padding: "14px 16px" }}>
        {loading ? <LoadingRows n={6} /> : (entries.length > 0 ? entries : [
          { content: "Helix Phase 2 complete — build phase", created_at: "2026-06-30T10:00:00Z", tag: "project" },
          { content: "Widget strip design finalized", created_at: "2026-06-30T09:45:00Z", tag: "design" },
          { content: "Kalshi API integration tested", created_at: "2026-06-29T18:30:00Z", tag: "api" },
          { content: "Neural vault schema updated", created_at: "2026-06-29T15:00:00Z", tag: "system" },
          { content: "Hologram map Boston overlay rendered", created_at: "2026-06-28T12:00:00Z", tag: "ui" },
        ]).map((e: any, i: number) => (
          <div key={i} style={{
            display: "flex", gap: 10, marginBottom: 10, paddingBottom: 10,
            borderBottom: "1px solid rgba(0,229,255,0.08)",
          }}>
            <div style={{
              width: 2, flexShrink: 0, background: "rgba(0,229,255,0.3)",
              borderRadius: 2, alignSelf: "stretch",
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, marginBottom: 3 }}>{e.content ?? e.text ?? e.title}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Muted>{e.created_at ? new Date(e.created_at).toLocaleString() : ""}</Muted>
                {e.tag && <Badge label={e.tag} color="cyan" />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Devices widget ───────────────────────────────────────────────────────────

const DEVICE_ICONS: Record<string, string> = {
  laptop: "💻", phone: "📱", tablet: "🪬", desktop: "🖥", server: "🗄",
  camera: "📷", sensor: "📡", default: "◫",
};

export function DevicesCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const devices: any[] = data?.devices ?? [];
  const online = devices.filter((d: any) => d.status === "online" || d.online).length;
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="◫" title="Devices" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows n={4} /> : (devices.length > 0 ? devices : [
          { name: "MacBook Pro", kind: "laptop", status: "online" },
          { name: "iPhone 15 Pro", kind: "phone", status: "online" },
          { name: "JARVIS Server", kind: "server", status: "online" },
          { name: "Security Cam", kind: "camera", status: "offline" },
        ]).slice(0, 4).map((d: any, i: number) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 14 }}>{DEVICE_ICONS[d.kind ?? "default"] ?? "◫"}</span>
            <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
            <Muted>{d.kind}</Muted>
            <StatusDot status={d.status === "online" || d.online ? "active" : "inactive"} />
          </div>
        ))}
        <Divider />
        <Muted>{online || 3} online</Muted>
      </div>
    </div>
  );
}

export function DevicesExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const devices: any[] = data?.devices ?? [];
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◫" title="Device Mesh" onClose={onClose} />
      <div style={{ padding: "14px 16px" }}>
        {loading ? <LoadingRows n={5} /> : (devices.length > 0 ? devices : [
          { name: "MacBook Pro", kind: "laptop", status: "online", ip: "192.168.1.10" },
          { name: "iPhone 15 Pro", kind: "phone", status: "online", ip: "192.168.1.11" },
          { name: "JARVIS Server", kind: "server", status: "online", ip: "192.168.1.1" },
          { name: "Security Cam", kind: "camera", status: "offline", ip: "192.168.1.20" },
          { name: "Smart Hub", kind: "sensor", status: "online", ip: "192.168.1.50" },
        ]).map((d: any, i: number) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
            padding: "9px 12px", background: "rgba(0,229,255,0.04)",
            border: "1px solid rgba(0,229,255,0.1)", borderRadius: 8,
          }}>
            <span style={{ fontSize: 18 }}>{DEVICE_ICONS[d.kind ?? "default"] ?? "◫"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 1 }}>{d.name}</div>
              <Muted>{d.kind}{d.ip ? ` · ${d.ip}` : ""}</Muted>
            </div>
            <StatusDot status={d.status === "online" || d.online ? "active" : "inactive"} />
          </div>
        ))}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Receipts widget ──────────────────────────────────────────────────────────

export function ReceiptsCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const receipts: any[] = data?.receipts ?? [];
  const total = data?.total ?? receipts.length;
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="◻" title="Receipts" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : (receipts.length > 0 ? receipts : [
          { operation: "fetchContext", target: "helix.projects", timestamp: "2026-06-30T10:01:00Z" },
          { operation: "streamPost", target: "/api/brain", timestamp: "2026-06-30T09:58:00Z" },
          { operation: "readMemory", target: "neural-vault", timestamp: "2026-06-30T09:45:00Z" },
        ]).slice(0, 3).map((r: any, i: number) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{r.operation ?? r.action ?? "op"}</span>
              <span style={{ fontSize: 11, color: "rgba(0,229,255,0.7)" }}>→</span>
              <span style={{ fontSize: 11, color: "rgba(230,251,255,0.65)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.target ?? r.resource ?? "—"}
              </span>
            </div>
            <Muted>{r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : ""}</Muted>
          </div>
        ))}
        <Divider />
        <Muted>{total || 3} logs</Muted>
      </div>
    </div>
  );
}

export function ReceiptsExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const receipts: any[] = data?.receipts ?? [];
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◻" title="Receipt Log" onClose={onClose} />
      <div style={{ padding: "14px 16px" }}>
        {loading ? <LoadingRows n={6} /> : (receipts.length > 0 ? receipts : [
          { operation: "fetchContext", target: "helix.projects", timestamp: "2026-06-30T10:01:00Z", status: "ok" },
          { operation: "streamPost", target: "/api/brain", timestamp: "2026-06-30T09:58:00Z", status: "ok" },
          { operation: "readMemory", target: "neural-vault", timestamp: "2026-06-30T09:45:00Z", status: "ok" },
          { operation: "devicePing", target: "192.168.1.20", timestamp: "2026-06-30T09:30:00Z", status: "error" },
          { operation: "kalshiFetch", target: "/api/kalshi/markets", timestamp: "2026-06-30T09:15:00Z", status: "ok" },
        ]).map((r: any, i: number) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 7,
            padding: "8px 11px", background: "rgba(0,229,255,0.04)",
            border: "1px solid rgba(0,229,255,0.09)", borderRadius: 8,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 1 }}>{r.operation ?? r.action}</div>
              <Muted>{r.target ?? r.resource} · {r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : ""}</Muted>
            </div>
            <Badge label={r.status ?? "ok"} color={r.status === "error" ? "red" : "green"} />
          </div>
        ))}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Graph widget ─────────────────────────────────────────────────────────────

export function GraphCard({ onClose, onExpand }: { onClose: () => void; onExpand: () => void }) {
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="❖" title="Graph" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>Knowledge Graph</div>
          <Muted>Semantic node-link map of memory, projects, and agents</Muted>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "rgba(0,229,255,0.9)" }}>—</div>
            <Muted>nodes</Muted>
          </div>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "rgba(0,229,255,0.9)" }}>—</div>
            <Muted>edges</Muted>
          </div>
        </div>
        <button
          onClick={() => window.open("/graph.html", "_blank")}
          style={{
            width: "100%", background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.28)",
            borderRadius: 7, padding: "7px 0", fontSize: 13, color: "rgba(0,229,255,0.9)",
            fontWeight: 600, cursor: "pointer", minHeight: "auto",
          }}
        >Open Graph →</button>
      </div>
    </div>
  );
}

// ─── Helix widget ─────────────────────────────────────────────────────────────

const HELIX_PHASES = ["Core", "Inquiry", "Evidence", "Strategy", "Build"];

export function HelixCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const projects: any[] = data?.projects ?? [];
  const active = projects.find((p: any) => p.active || p.status === "active") ?? {
    name: "JARVIS OS",
    goal: "Build spatial shell with widget system",
    phase: "Build",
  };
  const currentPhaseIdx = HELIX_PHASES.indexOf(active.phase ?? "Build");
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="⬡" title="Helix" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{active.name ?? "JARVIS OS"}</div>
            <div style={{ fontSize: 12, color: "rgba(230,251,255,0.65)", marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {active.goal ?? active.description ?? "No goal set"}
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {HELIX_PHASES.map((ph, i) => {
                const isCurrent = i === currentPhaseIdx || (currentPhaseIdx === -1 && ph === "Build");
                const isPast = i < (currentPhaseIdx === -1 ? 4 : currentPhaseIdx);
                return (
                  <div key={ph} style={{
                    flex: 1, textAlign: "center", fontSize: 10, fontWeight: isCurrent ? 700 : 400,
                    padding: "3px 2px", borderRadius: 4,
                    background: isCurrent
                      ? "rgba(0,229,255,0.2)"
                      : isPast ? "rgba(32,247,164,0.1)" : "rgba(0,229,255,0.04)",
                    border: `1px solid ${isCurrent ? "rgba(0,229,255,0.45)" : isPast ? "rgba(32,247,164,0.2)" : "rgba(0,229,255,0.1)"}`,
                    color: isCurrent ? "rgba(0,229,255,0.95)" : isPast ? "#20f7a4" : "rgba(230,251,255,0.4)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{ph}</div>
                );
              })}
            </div>
          </>
        )}
        <button
          onClick={() => window.open("/helix.html", "_blank")}
          style={{
            width: "100%", background: "rgba(0,229,255,0.08)", border: "1px solid rgba(0,229,255,0.22)",
            borderRadius: 7, padding: "6px 0", fontSize: 12, color: "rgba(0,229,255,0.85)",
            fontWeight: 600, cursor: "pointer", minHeight: "auto",
          }}
        >Open Helix →</button>
      </div>
    </div>
  );
}

export function HelixExpanded({ onClose }: { onClose: () => void }) {
  useEffect(() => { window.open("/helix.html", "_blank"); onClose(); }, []);
  return null;
}

// ─── Chip stat helper per widget ──────────────────────────────────────────────

function getChipStat(id: string, data: any): string {
  if (!data) return "—";
  switch (id) {
    case "modules":     return `${data.modules?.length ?? "—"}`;
    case "projects":    return `${data.projects?.length ?? data.total ?? "—"}`;
    case "agents":      return `${(data.missions ?? data.agents ?? []).filter((m: any) => m.status === "running" || m.active).length ?? 0} live`;
    case "connections": return `${Object.values(data.providers ?? {}).filter(Boolean).length}/${Object.keys(data.providers ?? {}).length || 5}`;
    case "kalshi":      return data.markets?.[0] ? `YES ${data.markets[0].yesBid}¢` : "·";
    case "vision":      return "Standby";
    case "memory":      return `${data.total ?? data.entries?.length ?? "—"}`;
    case "devices":     return `${(data.devices ?? []).filter((d: any) => d.status === "online" || d.online).length ?? "—"}`;
    case "receipts":    return `${data.total ?? data.receipts?.length ?? "—"}`;
    case "graph":       return "→";
    case "helix":       return data.projects?.find((p: any) => p.active)?.phase ?? "Build";
    default:            return "—";
  }
}

function getChipStatus(id: string, data: any): "active" | "warning" | "inactive" {
  if (!data) return "inactive";
  switch (id) {
    case "connections": {
      const vals = Object.values(data.providers ?? {});
      if (vals.every(Boolean)) return "active";
      if (vals.some(Boolean)) return "warning";
      return "inactive";
    }
    case "agents":
      return (data.missions ?? data.agents ?? []).some((m: any) => m.status === "running" || m.active)
        ? "active" : "inactive";
    case "kalshi":
      return "active";
    default:
      return "active";
  }
}

// ─── Fetch logic per widget ───────────────────────────────────────────────────

async function fetchWidgetData(id: string): Promise<any> {
  switch (id) {
    case "modules":
      return api<any>("/api/modules").catch(() => ({ modules: [] }));
    case "projects":
      return api<any>("/api/projects").catch(() => ({ projects: [] }));
    case "agents":
      return api<any>("/api/agents").catch(() => ({ missions: [] }));
    case "connections":
      return api<any>("/api/provider-health").catch(() => ({
        providers: { claude: true, perplexity: true, gemini: false, kalshi: true, google: false },
      }));
    case "kalshi": {
      const watchlist = await api<any>("/api/kalshi/watchlist").catch(() => ({
        balance: 0, portfolioValue: 0, markets: KALSHI_MOCK_MARKETS,
      }));
      return {
        balance:        watchlist.balance        ?? 0,
        portfolioValue: watchlist.portfolioValue ?? 0,
        positions:      watchlist.positions      ?? [],
        latestFill:     watchlist.latestFill     ?? null,
        portfolio: {
          balance:        watchlist.balance        ?? 0,
          portfolioValue: watchlist.portfolioValue ?? 0,
          positions:      watchlist.positions      ?? [],
          latestFill:     watchlist.latestFill     ?? null,
        },
        markets: watchlist.markets?.length ? watchlist.markets : KALSHI_MOCK_MARKETS,
      };
    }
    case "vision":
      return {};
    case "memory":
      return api<any>("/api/neural-vault/entries").catch(() => ({ entries: [], total: 0 }));
    case "devices":
      return api<any>("/api/devices").catch(() => ({ devices: [] }));
    case "receipts":
      return api<any>("/api/receipts").catch(() => ({ receipts: [], total: 0 }));
    case "graph":
      return {};
    case "helix":
      return api<any>("/api/helix/projects").catch(() => ({ projects: [] }));
    default:
      return {};
  }
}

// ─── Main WidgetStrip component ───────────────────────────────────────────────

export function WidgetStrip({ mode, showChips = true }: { mode: string; showChips?: boolean }) {
  if (mode !== "main") return null;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<WidgetView>("chip");
  const [widgetData, setWidgetData] = useState<Record<string, any>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [fetchedIds, setFetchedIds] = useState<Set<string>>(new Set());

  const chipRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeId) return;
    if (fetchedIds.has(activeId)) return;
    setLoadingIds(prev => new Set(prev).add(activeId));
    fetchWidgetData(activeId).then(data => {
      setWidgetData(prev => ({ ...prev, [activeId]: data }));
      setFetchedIds(prev => new Set(prev).add(activeId));
      setLoadingIds(prev => { const s = new Set(prev); s.delete(activeId); return s; });
    }).catch(() => {
      setLoadingIds(prev => { const s = new Set(prev); s.delete(activeId); return s; });
    });
  }, [activeId]);

  useEffect(() => {
    if (!activeId || activeView !== "card") return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const chip = chipRefs.current[activeId!];
      const card = cardRef.current;
      if (chip && chip.contains(target)) return;
      if (card && card.contains(target)) return;
      setActiveId(null);
      setActiveView("chip");
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [activeId, activeView]);

  useEffect(() => {
    function handle(e: Event) {
      const id = (e as CustomEvent).detail?.id as string | undefined;
      if (!id || !WIDGETS.find(w => w.id === id)) return;
      setActiveId(id);
      setActiveView("card");
    }
    document.addEventListener("jarvis:open-widget", handle);
    return () => document.removeEventListener("jarvis:open-widget", handle);
  }, []);

  const handleChipClick = useCallback((id: string) => {
    if (activeId === id && activeView === "card") {
      setActiveId(null);
      setActiveView("chip");
    } else {
      setActiveId(id);
      setActiveView("card");
    }
  }, [activeId, activeView]);

  const handleExpand = useCallback(() => {
    setActiveView("expanded");
  }, []);

  const handleClose = useCallback(() => {
    setActiveId(null);
    setActiveView("chip");
  }, []);

  const handleRefresh = useCallback((id: string) => {
    setFetchedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    setLoadingIds(prev => new Set(prev).add(id));
    fetchWidgetData(id).then(data => {
      setWidgetData(prev => ({ ...prev, [id]: data }));
      setFetchedIds(prev => new Set(prev).add(id));
      setLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }).catch(() => {
      setLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    });
  }, []);

  function renderCard(widget: WidgetDef) {
    const { id } = widget;
    const data = widgetData[id];
    const loading = loadingIds.has(id);
    const props = { data, loading, onClose: handleClose, onExpand: handleExpand };
    switch (id) {
      case "modules":     return <ModulesCard     {...props} key={id} />;
      case "projects":    return <ProjectsCard    {...props} key={id} />;
      case "agents":      return <AgentsCard      {...props} key={id} />;
      case "connections": return <ConnectionsCard {...props} key={id} />;
      case "kalshi":      return <KalshiCard      {...props} key={id} />;
      case "vision":      return <VisionCard      {...props} key={id} />;
      case "memory":      return <MemoryCard      {...props} key={id} />;
      case "devices":     return <DevicesCard     {...props} key={id} />;
      case "receipts":    return <ReceiptsCard    {...props} key={id} />;
      case "graph":       return <GraphCard onClose={handleClose} onExpand={handleExpand} key={id} />;
      case "helix":       return <HelixCard       {...props} key={id} />;
      default:            return null;
    }
  }

  function renderExpanded(id: string) {
    const data = widgetData[id];
    const loading = loadingIds.has(id);
    const props = { data, loading, onClose: handleClose };
    switch (id) {
      case "modules":     return <ModulesExpanded     {...props} />;
      case "projects":    return <ProjectsExpanded    {...props} />;
      case "agents":      return <AgentsExpanded      {...props} />;
      case "connections": return <ConnectionsExpanded {...props} />;
      case "kalshi":      return <KalshiExpanded      {...props} onRefresh={() => handleRefresh(id)} />;
      case "vision":      return <VisionExpanded      {...props} />;
      case "memory":      return <MemoryExpanded      {...props} />;
      case "devices":     return <DevicesExpanded     {...props} />;
      case "receipts":    return <ReceiptsExpanded    {...props} />;
      case "graph":       return <ExpandedWrapper><button onClick={() => { window.open("/graph.html", "_blank"); handleClose(); }} style={{ margin: 24, fontSize: 14, cursor: "pointer" }}>Open Graph →</button></ExpandedWrapper>;
      case "helix":       return <HelixExpanded onClose={handleClose} />;
      default:            return null;
    }
  }

  function getCardLeft(chipEl: HTMLDivElement | null): React.CSSProperties {
    if (!chipEl) return {};
    const rect = chipEl.getBoundingClientRect();
    const cardWidth = 300;
    const vpWidth = window.innerWidth;
    let left = 0;
    if (rect.left + cardWidth > vpWidth - 16) {
      left = Math.min(0, vpWidth - 16 - rect.left - cardWidth);
    }
    return { left };
  }

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .widget-chip::-webkit-scrollbar { display: none; }
      `}</style>

      <div
        style={{
          display: showChips ? undefined : "none",
          position: "fixed",
          bottom: "130px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(calc(100vw - 64px), 1600px)",
          zIndex: 45,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "8px",
            overflowX: "auto",
            scrollbarWidth: "none",
            paddingBottom: "4px",
          }}
        >
          {WIDGETS.map(widget => {
            const isActive = activeId === widget.id;
            const data = widgetData[widget.id];
            const stat = getChipStat(widget.id, data);
            const status = getChipStatus(widget.id, data);

            return (
              <div
                key={widget.id}
                ref={el => { chipRefs.current[widget.id] = el; }}
                style={{ position: "relative", flexShrink: 0, pointerEvents: "auto" }}
              >
                {widget.id === "kalshi" ? (
                  <KalshiChip
                    market={data?.markets?.[0] ?? null}
                    isActive={isActive}
                    onClick={() => handleChipClick(widget.id)}
                  />
                ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(widget.id)}
                  onKeyDown={e => e.key === "Enter" && handleChipClick(widget.id)}
                  style={{
                    width: "156px",
                    height: "40px",
                    background: isActive ? "rgba(0, 8, 20, 0.88)" : "rgba(0, 8, 14, 0.72)",
                    border: `1px solid ${isActive ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.18)"}`,
                    borderRadius: "20px",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "0 11px",
                    cursor: "pointer",
                    userSelect: "none",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                    boxShadow: isActive
                      ? "0 0 0 1px rgba(0,229,255,0.18), 0 0 12px rgba(0,229,255,0.15)"
                      : "none",
                    outline: "none",
                  }}
                  onMouseEnter={e => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,229,255,0.35)";
                  }}
                  onMouseLeave={e => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,229,255,0.18)";
                  }}
                >
                  <span style={{ fontSize: "14px", flexShrink: 0 }}>{widget.icon}</span>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "rgba(230,251,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {widget.label}
                  </span>
                  <span style={{ fontSize: "10px", color: "rgba(0,229,255,0.8)", fontWeight: 700, flexShrink: 0 }}>
                    {data ? stat : "·"}
                  </span>
                  <StatusDot status={data ? status : "inactive"} />
                </div>
                )}

                {showChips && isActive && activeView === "card" && (
                  <div
                    ref={cardRef}
                    style={{
                      ...getCardLeft(chipRefs.current[widget.id]),
                      position: "absolute",
                      bottom: "calc(100% + 8px)",
                    }}
                  >
                    {renderCard(widget)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!showChips && activeId && activeView === "card" && WIDGETS.find(w => w.id === activeId) && (
        <div
          ref={cardRef}
          style={{
            position: "fixed",
            bottom: "calc(4.5vh + 140px)",
            right: "calc(50% - min(445px, 29.5vw))",
            zIndex: 50,
          }}
        >
          {renderCard(WIDGETS.find(w => w.id === activeId)!)}
        </div>
      )}

      {activeId && activeView === "expanded" && (
        <div style={EXPANDED_OVERLAY_STYLE} onMouseDown={handleClose}>
          <div onMouseDown={e => e.stopPropagation()}>
            {renderExpanded(activeId)}
          </div>
        </div>
      )}
    </>
  );
}
