import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { KalshiChip, KalshiCard, KalshiExpanded } from "./KalshiWidget";
import { TodayDashboard } from "./TodayDashboard";
import { GoogleConnectChips } from "./GoogleConnectChips";
import { SpatialWidgetFrame, type SpatialWidgetState } from "./SpatialWidgetFrame";
import { DeviceMeshCommandCenter } from "./DeviceMeshCommandCenter";
import { SynapseWidget } from "../rooms/synapse/SynapseWidget";
import { GraphCommandCenter, VisionCommandCenter } from "./IntelligenceCommandCenters";
import { AgentsCommandCenter, ModulesCommandCenter, ProjectsCommandCenter } from "./OperationalCommandCenters";
import { ConnectionsCommandCenter, ReceiptsCommandCenter, TrustCommandCenter } from "./AssuranceCommandCenters";
import { ProfileCommandCenter, VitalsCommandCenter, WeatherCommandCenter, TodayCommandCenter } from "./PersonalCommandCenters";
import { MemoryCommandCenter } from "./MemoryCommandCenter";
import { ContactsCommandCenter } from "./ContactsCommandCenter";
import { RuntimeMinimized, RuntimeWidget } from "./runtime/RuntimeWidget";

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

// One registry, shared with the launcher. It used to live here and be hand-copied there, with a
// comment claiming no import was needed; the two lists were already drifting, and a widget present
// in one and absent from the other fails silently in both directions.
import { WIDGETS, type WidgetDef } from "./widget-registry";

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

type TruthState = "live" | "stale" | "disconnected" | "empty" | "sample";

function truthState(data: any, hasContent: boolean): TruthState {
  if (data?.__state === "sample") return "sample";
  if (data?.__state === "error" || data?.__state === "disconnected") return "disconnected";
  if (data?.__state === "stale") return "stale";
  return hasContent ? "live" : "empty";
}

function TruthMessage({ state, empty, error }: { state: TruthState; empty: string; error?: string }) {
  const copy = state === "disconnected" ? (error || "Data source is disconnected.")
    : state === "stale" ? "Showing the last verified data."
    : state === "sample" ? "Sample data — not live."
    : empty;
  return (
    <div style={{ padding: "12px 10px", border: "1px dashed rgba(0,229,255,0.2)", borderRadius: 7, textAlign: "center" }}>
      <Badge label={state} color={state === "disconnected" ? "red" : state === "stale" || state === "sample" ? "amber" : "gray"} />
      <div style={{ marginTop: 7 }}><Muted>{copy}</Muted></div>
    </div>
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
            {modules.length === 0 && <TruthMessage state={truthState(data, false)} empty="No runtime modules reported." error={data?.__error} />}
          </div>
        )}
        <Divider />
        <Muted>{loaded} loaded · {active} active</Muted>
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
            {modules.map((m: any, i: number) => (
              <div key={i} style={{
                background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.14)",
                borderRadius: 8, padding: "10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              }}>
                <span style={{ fontSize: 18 }}>{m.icon ?? "⬡"}</span>
                <span style={{ fontSize: 11, fontWeight: 500, textAlign: "center" }}>{m.name ?? m.id}</span>
                <StatusDot status={(m.active || m.status === "active") ? "active" : "inactive"} />
              </div>
            ))}
            {modules.length === 0 && <TruthMessage state={truthState(data, false)} empty="No runtime modules reported." error={data?.__error} />}
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
        {!loading && projects.length === 0 && <TruthMessage state={truthState(data, false)} empty="No projects have been indexed yet." error={data?.__error} />}
        <Divider />
        <Muted>Total: {total} projects</Muted>
      </div>
    </div>
  );
}

export function ProjectsExpanded({ data, loading, onClose, onAttach, onAskJarvis }: {
  data: any; loading: boolean; onClose: () => void;
  onAttach?: (p: any) => void;
  onAskJarvis?: (p: any, question: string) => void;
}) {
  const projects: any[] = data?.projects ?? [];
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const displayList = loading ? [] : projects;
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
        {loading ? <LoadingRows /> : missions.length === 0 ? <TruthMessage state={truthState(data, false)} empty="No agent missions are running." error={data?.__error} /> : missions.slice(0, 3).map((m: any, i: number) => (
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
        {loading ? <LoadingRows n={6} /> : missions.length === 0 ? <TruthMessage state={truthState(data, false)} empty="No agent missions have been recorded." error={data?.__error} /> : missions.map((m: any, i: number) => (
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
function providerConnected(value: any): boolean {
  return value === true || Boolean(value && typeof value === "object" && value.connected === true);
}

export function ConnectionsCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const health: any = data?.providers ?? {};
  const connected = Object.values(health).filter(providerConnected).length;
  const total = Math.max(PROVIDERS.length, Object.keys(health).length);
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="⚡" title="Connections" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows n={5} /> : data?.__state === "disconnected" ? <TruthMessage state="disconnected" empty="" error={data?.__error} /> : PROVIDERS.map((name) => {
          const key = name.toLowerCase();
          const provider = health[key] ?? health[name];
          const status = providerConnected(provider);
          return (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
              <StatusDot status={status ? "active" : "inactive"} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{name}</span>
              <Badge label={status ? "connected" : "missing"} color={status ? "green" : "gray"} />
            </div>
          );
        })}
        <Divider />
        <Muted>{connected}/{total} connected</Muted>
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
        {loading ? <LoadingRows n={6} /> : data?.__state === "disconnected" ? <TruthMessage state="disconnected" empty="" error={data?.__error} /> : PROVIDERS.map((name) => {
          const key = name.toLowerCase();
          const provider = health[key] ?? health[name];
          const status = providerConnected(provider);
          const latency = Number.isFinite(data?.latency?.[key]) ? data.latency[key]
            : Number.isFinite(provider?.latencyMs) ? provider.latencyMs : null;
          return (
            <div key={name} style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
              padding: "10px 12px", background: "rgba(0,229,255,0.05)",
              border: "1px solid rgba(0,229,255,0.1)", borderRadius: 8,
            }}>
              <StatusDot status={status ? "active" : "inactive"} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{name}</div>
                <Muted>{latency == null ? "Latency not measured" : `Latency: ${latency}ms`}</Muted>
              </div>
              <Badge label={status ? "connected" : "missing"} color={status ? "green" : "gray"} />
            </div>
          );
        })}
      </div>
    </ExpandedWrapper>
  );
}

export function TrustCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const live = data?.state === "live";
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="◇" title="Trust Boundary" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : !live ? <TruthMessage state={truthState(data, false)} empty="Trust status unavailable." error={data?.__error} /> : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><Muted>Principal</Muted><Badge label={data.principal?.kind || "unknown"} color={data.directOwner ? "green" : "amber"} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><Muted>Bind host</Muted><span style={{ fontSize: 12 }}>{data.bindHost}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><Muted>Owner relay</Muted><Badge label={data.remoteRelayConfigured ? "configured" : "off"} color={data.remoteRelayConfigured ? "amber" : "gray"} /></div>
          </>
        )}
      </div>
    </div>
  );
}

export function TrustExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◇" title="Trust Boundary" badge={data?.directOwner ? "direct owner" : data?.principal?.kind} onClose={onClose} />
      <div style={{ padding: 16 }}>
        {loading ? <LoadingRows n={4} /> : data?.state !== "live" ? <TruthMessage state={truthState(data, false)} empty="Trust status unavailable." error={data?.__error} /> : (
          <>
            <div style={{ marginBottom: 12 }}><Badge label={data.directOwner ? "LOCAL OWNER" : String(data.principal?.kind || "UNKNOWN")} color={data.directOwner ? "green" : "amber"} /></div>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              <div>Server binding: <strong>{data.bindHost}</strong></div>
              <div>Signed Cloudflare relay: <strong>{data.remoteRelayConfigured ? "configured" : "not configured"}</strong></div>
              <div>Principal trust: <strong>{data.principal?.trustLevel || "none"}</strong></div>
            </div>
            <Divider />
            <Muted>Remote access is controlled by JARVIS_HOST, JARVIS_ACCESS_TOKEN and JARVIS_RELAY_SECRET. Approval decisions remain restricted to the direct owner surface.</Muted>
          </>
        )}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Kalshi widget — see KalshiWidget.tsx ────────────────────────────────────

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
        <button disabled title="Camera controls are not connected to the current JARVIS shell." style={{
          width: "100%", borderRadius: 7, padding: "7px 0", fontSize: 13, cursor: "pointer",
          background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.28)",
          color: "rgba(0,229,255,0.9)", fontWeight: 600, minHeight: "auto",
        }}>Camera not connected</button>
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
          <Muted>No live camera session is connected.</Muted>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled title="Live camera is not connected to this shell." style={{
            flex: 1, background: "rgba(32,247,164,0.15)", border: "1px solid rgba(32,247,164,0.35)",
            borderRadius: 8, padding: "8px 0", fontSize: 13, color: "#20f7a4", fontWeight: 600, cursor: "pointer", minHeight: "auto",
          }}>Live feed unavailable</button>
          <button disabled title="Snapshot requires an active live feed." style={{
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
        {loading ? <LoadingRows /> : entries.length === 0 ? <TruthMessage state={truthState(data, false)} empty="No memories are stored in this scope." error={data?.__error} /> : entries.slice(0, 3).map((e: any, i: number) => (
          <div key={i} style={{ marginBottom: 9 }}>
            <div style={{ fontSize: 12, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.content ?? e.text ?? e.title}
            </div>
            <Muted>{e.created_at ? new Date(e.created_at).toLocaleDateString() : `Entry ${i + 1}`}</Muted>
          </div>
        ))}
        <Divider />
        <Muted>{total} stored</Muted>
      </div>
    </div>
  );
}

// Cortex v4 · 2.3 — Memory Inspector: searchable view of what Jarvis actually
// remembers (live from the Neural Vault), not a mock timeline.
export function MemoryExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const runSearch = useCallback((q: string) => {
    const term = q.trim();
    if (!term) { setResults(null); return; }
    setSearching(true);
    api<any>(`/api/neural-vault/entries?q=${encodeURIComponent(term)}&limit=25`)
      .then((r) => setResults(Array.isArray(r?.entries) ? r.entries : []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, []);
  const entries: any[] = results ?? data?.entries ?? [];
  const total = data?.total ?? entries.length;
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◈" title="Memory Inspector" badge={results ? `${entries.length} match` : `${total} stored`} onClose={onClose} />
      <div style={{ padding: "12px 16px 6px" }}>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(query); }}
          placeholder="Search what Jarvis remembers…"
          style={{
            width: "100%", boxSizing: "border-box", padding: "8px 11px", fontSize: 13,
            background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.22)",
            borderRadius: 8, color: "rgba(230,251,255,0.92)", outline: "none",
          }}
        />
      </div>
      <div style={{ padding: "6px 16px 14px", maxHeight: "62vh", overflowY: "auto" }}>
        {(loading || searching) ? <LoadingRows n={6} /> : entries.length === 0 ? (
          <Muted>{results ? "No memories match that search." : "No memories stored yet."}</Muted>
        ) : entries.map((e: any, i: number) => (
          <div key={e.id ?? i} style={{
            display: "flex", gap: 10, marginBottom: 10, paddingBottom: 10,
            borderBottom: "1px solid rgba(0,229,255,0.08)",
          }}>
            <div style={{ width: 2, flexShrink: 0, background: "rgba(0,229,255,0.3)", borderRadius: 2, alignSelf: "stretch" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, marginBottom: 3 }}>{e.content ?? e.text ?? e.title}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Muted>{e.created_at ? new Date(e.created_at).toLocaleString() : ""}</Muted>
                {(e.topic || e.type) && <Badge label={e.topic || e.type} color="cyan" />}
                {typeof e.importance === "number" && e.importance >= 7 && <Badge label="key" color="cyan" />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Profile widget (Cortex v4 P2 — "everything about me") ────────────────────

export function ProfileCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const id = data?.identity ?? {};
  const place = data?.location?.resolved?.placeName ?? "—";
  const prefs: any[] = data?.preferences ?? [];
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="◐" title="Profile" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{id.preferred_name || id.legal_name || "—"}</div>
            {id.bio ? <Muted>{id.bio}</Muted> : null}
            <Divider />
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <Muted>Location</Muted><span style={{ fontSize: 12 }}>{place}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Muted>Local time</Muted><span style={{ fontSize: 12 }}>{data?.time || "—"}</span>
            </div>
            <Divider />
            <Muted>{prefs.length} preferences · {(data?.goals?.length ?? 0)} goals</Muted>
          </>
        )}
      </div>
    </div>
  );
}

export function ProfileExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const id = data?.identity ?? {};
  const prefs: any[] = data?.preferences ?? [];
  const goals: any[] = data?.goals ?? [];
  const facts: string[] = data?.facts ?? [];
  const locations: any[] = data?.locations ?? [];
  const row = (label: string, value: any) => value ? (
    <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
      <div style={{ width: 110, flexShrink: 0 }}><Muted>{label}</Muted></div>
      <div style={{ flex: 1, fontSize: 13 }}>{value}</div>
    </div>
  ) : null;
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◐" title="About You" badge={data?.location?.resolved?.placeName} onClose={onClose} />
      <div style={{ padding: "14px 16px", maxHeight: "70vh", overflowY: "auto" }}>
        {loading ? <LoadingRows n={6} /> : (
          <>
            <div style={{ marginBottom: 14 }}>
              {row("Name", id.legal_name)}
              {row("Call me", id.preferred_name)}
              {row("Bio", id.bio)}
              {row("Email", id.primary_email)}
              {row("Timezone", id.home_timezone)}
              {row("Local time", data?.time)}
            </div>
            {prefs.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,229,255,0.8)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "6px 0 8px" }}>Preferences</div>
                {prefs.map((p: any, i: number) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 12 }}>
                    <Badge label={p.category || "pref"} color="cyan" />
                    <span style={{ opacity: 0.7 }}>{p.subject}:</span>
                    <span>{p.value}</span>
                  </div>
                ))}
              </>
            )}
            {goals.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,229,255,0.8)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "12px 0 8px" }}>Goals</div>
                {goals.map((g: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, marginBottom: 5 }}>• {g.title} {g.kind ? <Muted>({g.kind})</Muted> : null}</div>
                ))}
              </>
            )}
            {facts.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,229,255,0.8)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "12px 0 8px" }}>Facts</div>
                {facts.map((f: string, i: number) => <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>• {f}</div>)}
              </>
            )}
            {locations.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,229,255,0.8)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "12px 0 8px" }}>Locations</div>
                {locations.map((l: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>• {l.label}: {l.address} <Muted>({l.timezone})</Muted></div>
                ))}
              </>
            )}
            {data?.cost && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,229,255,0.8)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "12px 0 8px" }}>Usage &amp; Cost</div>
                <div style={{ display: "flex", gap: 18, marginBottom: 8 }}>
                  <div><div style={{ fontSize: 18, fontWeight: 700 }}>${(data.cost.today?.cost ?? 0).toFixed(2)}</div><Muted>today · {data.cost.today?.calls ?? 0} calls</Muted></div>
                  <div><div style={{ fontSize: 18, fontWeight: 700 }}>${(data.cost.month?.cost ?? 0).toFixed(2)}</div><Muted>this month</Muted></div>
                </div>
                {data.cost.byModel && Object.entries(data.cost.byModel).map(([m, v]: [string, any]) => (
                  <div key={m} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                    <span style={{ opacity: 0.75 }}>{m.replace("gemini-", "")}</span>
                    <span><span style={{ opacity: 0.55 }}>{v.calls} calls · </span>${(v.cost ?? 0).toFixed(3)}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </ExpandedWrapper>
  );
}

// ─── Weather widget (Cortex v4 P4 — keyless open-meteo) ───────────────────────

function dayName(dateStr: string, i: number): string {
  if (i === 0) return "Today";
  try { return new Date(dateStr + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" }); } catch { return dateStr; }
}

export function WeatherCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const cur = data?.current;
  const days: any[] = data?.days ?? [];
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="☀" title={data?.place ? `Weather · ${data.place}` : "Weather"} onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : !cur ? <Muted>Weather unavailable.</Muted> : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 30 }}>{cur.icon}</span>
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{cur.temp}°</div>
                <Muted>{cur.label} · feels {cur.feels}°</Muted>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 11 }}>
              <Muted>💧 {cur.humidity ?? "—"}%</Muted><Muted>🌬 {cur.wind} mph</Muted>
            </div>
            <Divider />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              {days.slice(1, 4).map((d, i) => (
                <div key={i} style={{ textAlign: "center", fontSize: 11 }}>
                  <div style={{ opacity: 0.65 }}>{dayName(d.date, i + 1)}</div>
                  <div style={{ fontSize: 16 }}>{d.icon}</div>
                  <div>{d.hi}°<span style={{ opacity: 0.5 }}>/{d.lo}°</span></div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function TodayCard({ data, loading, onClose, onExpand, embedded }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void; embedded?: boolean; onRefresh?: () => void;
}) {
  const t = (iso?: string | null) => { try { return iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""; } catch { return ""; } };
  const now = data?.nowNext?.now, next = data?.nowNext?.next;
  const top: any[] = data?.topOfMind ?? [];
  const counts = data?.counts ?? {};
  // embedded = the "normal" widget state inside a SpatialWidgetFrame: fill the frame, no own chrome.
  return (
    <div style={embedded ? { width: "100%", height: "100%", overflow: "auto", background: "transparent", color: "#dff4ff" } : CARD_STYLE}>
      {!embedded && <CardHeader icon="◔" title="Today" onClose={onClose} onExpand={onExpand} />}
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : (
          <>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{now ? now.title : next ? next.title : "Nothing scheduled"}</div>
              <Muted>{now ? `on now${now.endAt ? ` · until ${t(now.endAt)}` : ""}` : next ? `next · ${t(next.startAt)}` : "the day is clear"}</Muted>
            </div>
            <Divider />
            <div style={{ display: "flex", gap: 12, fontSize: 11, margin: "8px 0" }}>
              <Muted>✓ {counts.openTasks ?? 0} tasks</Muted>
              <Muted>⧖ {counts.waitingOnThem ?? 0} waiting</Muted>
              <Muted>⏰ {counts.pendingReminders ?? 0} reminders</Muted>
            </div>
            <GoogleConnectChips />
            {top.length ? <>
              <Divider />
              <div style={{ marginTop: 6 }}>
                {top.slice(0, 3).map((task) => (
                  <div key={task.id} style={{ fontSize: 11, padding: "3px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ color: "#ffbf62", marginRight: 6 }}>{"!".repeat(Math.max(1, task.priority || 1))}</span>{task.title}
                  </div>
                ))}
              </div>
            </> : null}
          </>
        )}
      </div>
    </div>
  );
}

export function WeatherExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const cur = data?.current;
  const days: any[] = data?.days ?? [];
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="☀" title={`Weather${data?.place ? ` · ${data.place}` : ""}`} badge={cur ? `${cur.temp}°F` : undefined} onClose={onClose} />
      <div style={{ padding: "16px" }}>
        {loading ? <LoadingRows n={5} /> : !cur ? <Muted>Weather is unavailable right now.</Muted> : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
              <span style={{ fontSize: 52 }}>{cur.icon}</span>
              <div>
                <div style={{ fontSize: 42, fontWeight: 700, lineHeight: 1 }}>{cur.temp}°F</div>
                <div style={{ fontSize: 14 }}>{cur.label}</div>
                <Muted>Feels like {cur.feels}° · 💧 {cur.humidity ?? "—"}% · 🌬 {cur.wind} mph</Muted>
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,229,255,0.8)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>4-Day Forecast</div>
            {days.map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(0,229,255,0.08)" }}>
                <div style={{ width: 54, fontSize: 13 }}>{dayName(d.date, i)}</div>
                <span style={{ fontSize: 20, width: 28 }}>{d.icon}</span>
                <div style={{ flex: 1, fontSize: 13 }}>{d.label}</div>
                {d.precip != null && d.precip > 0 && <Muted>💧{d.precip}%</Muted>}
                <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{d.hi}° <span style={{ opacity: 0.5 }}>/ {d.lo}°</span></div>
              </div>
            ))}
          </>
        )}
      </div>
    </ExpandedWrapper>
  );
}

// ─── System Vitals widget (Cortex v4 P4 — real node os stats) ─────────────────

function fmtUptime(sec: number): string {
  if (!sec || sec < 0) return "—";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function Meter({ pct, warn = 80 }: { pct: number; warn?: number }) {
  const color = pct >= warn ? "#ffbc60" : pct >= 92 ? "#ff6b6b" : "#20f7a4";
  return (
    <div style={{ height: 6, background: "rgba(0,229,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: color, borderRadius: 4, transition: "width .4s" }} />
    </div>
  );
}

export function VitalsCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const mem = data?.memory; const cpu = data?.cpu;
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="◍" title="System Vitals" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : !data?.available ? <Muted>Vitals unavailable.</Muted> : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span>Memory</span><Muted>{mem?.usedGB}/{mem?.totalGB} GB · {mem?.pct}%</Muted>
            </div>
            <Meter pct={mem?.pct ?? 0} />
            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between" }}>
              <Muted>CPU</Muted><span style={{ fontSize: 12 }}>{cpu?.cores} cores</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Muted>Uptime</Muted><span style={{ fontSize: 12 }}>{fmtUptime(data?.uptimeSec)}</span>
            </div>
            <Divider />
            <Muted>Jarvis: {data?.jarvis?.rssMB} MB · up {fmtUptime(data?.jarvis?.uptimeSec)}</Muted>
          </>
        )}
      </div>
    </div>
  );
}

export function VitalsExpanded({ data, loading, onClose }: { data: any; loading: boolean; onClose: () => void }) {
  const mem = data?.memory; const cpu = data?.cpu; const jv = data?.jarvis;
  const row = (label: string, value: any, meter?: number) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span>{label}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
      </div>
      {typeof meter === "number" ? <Meter pct={meter} /> : null}
    </div>
  );
  return (
    <ExpandedWrapper>
      <ExpandedHeader icon="◍" title="System Vitals" badge={data?.host} onClose={onClose} />
      <div style={{ padding: "16px" }}>
        {loading ? <LoadingRows n={5} /> : !data?.available ? <Muted>System vitals are unavailable.</Muted> : (
          <>
            {row("Memory", `${mem?.usedGB} / ${mem?.totalGB} GB (${mem?.pct}%)`, mem?.pct)}
            {row("CPU", `${cpu?.cores} cores · load ${cpu?.load1}`)}
            {row("Platform", data?.platform)}
            {row("System uptime", fmtUptime(data?.uptimeSec))}
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,229,255,0.8)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "8px 0" }}>Jarvis Process</div>
            {row("Resident memory", `${jv?.rssMB} MB`)}
            {row("Heap used", `${jv?.heapMB} MB`)}
            {row("Process uptime", fmtUptime(jv?.uptimeSec))}
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>{cpu?.model}</div>
          </>
        )}
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
        {loading ? <LoadingRows n={4} /> : devices.length === 0 ? <TruthMessage state={truthState(data, false)} empty="No devices are paired." error={data?.__error} /> : devices.slice(0, 4).map((d: any, i: number) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 14 }}>{DEVICE_ICONS[d.kind ?? "default"] ?? "◫"}</span>
            <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
            <Muted>{d.kind}</Muted>
            <StatusDot status={d.status === "online" || d.online ? "active" : "inactive"} />
          </div>
        ))}
        <Divider />
        <Muted>{online} online</Muted>
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
        {loading ? <LoadingRows n={5} /> : devices.length === 0 ? <TruthMessage state={truthState(data, false)} empty="No devices are paired." error={data?.__error} /> : devices.map((d: any, i: number) => (
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
        {loading ? <LoadingRows /> : receipts.length === 0 ? <TruthMessage state={truthState(data, false)} empty="No verified actions have been recorded." error={data?.__error} /> : receipts.slice(0, 3).map((r: any, i: number) => (
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
        <Muted>{total} logs</Muted>
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
        {loading ? <LoadingRows n={6} /> : receipts.length === 0 ? <TruthMessage state={truthState(data, false)} empty="No verified actions have been recorded." error={data?.__error} /> : receipts.map((r: any, i: number) => (
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
          disabled
          title="Graph workspace is not connected to the current shell yet."
          style={{
            width: "100%", background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.28)",
            borderRadius: 7, padding: "7px 0", fontSize: 13, color: "rgba(0,229,255,0.9)",
            fontWeight: 600, cursor: "pointer", minHeight: "auto",
          }}
        >Graph unavailable</button>
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
  const active = projects.find((p: any) => p.active || p.status === "active") ?? null;
  const currentPhaseIdx = active ? HELIX_PHASES.indexOf(active.phase ?? "") : -1;
  return (
    <div style={CARD_STYLE}>
      <CardHeader icon="⬡" title="Helix" onClose={onClose} onExpand={onExpand} />
      <div style={CARD_BODY_STYLE}>
        {loading ? <LoadingRows /> : !active ? <TruthMessage state={truthState(data, false)} empty="No active HELIX project." error={data?.__error} /> : (
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
          onClick={() => document.dispatchEvent(new CustomEvent("jarvis:open-widget", { detail: { id: "helix", focus: true } }))}
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
  useEffect(() => {
    document.dispatchEvent(new CustomEvent("jarvis:open-widget", { detail: { id: "helix", focus: true } }));
    onClose();
  }, [onClose]);
  return null;
}

// ─── Chip stat helper per widget ──────────────────────────────────────────────

function getChipStat(id: string, data: any): string {
  if (!data) return "—";
  switch (id) {
    case "runtime":     return `${(data.tasks ?? []).filter((task: any) => ["queued", "planning", "ready", "running", "waiting_approval", "waiting_owner", "paused", "recovering", "verified"].includes(task.state)).length} active`;
    case "contacts":    return `${data.contacts?.length ?? 0} known`;
    case "today":       return data.nowNext?.next ? new Date(data.nowNext.next.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : (data.counts?.openTasks ? `${data.counts.openTasks} tasks` : "clear");
    case "profile":     return data.identity?.preferred_name ?? "—";
    case "weather":     return data.current ? `${data.current.temp}°` : "—";
    case "vitals":      return data.memory ? `${data.memory.pct}%` : "—";
    case "modules":     return `${data.modules?.length ?? "—"}`;
    case "projects":    return `${data.projects?.length ?? data.total ?? "—"}`;
    case "agents":      return `${[...(data.durableMissions ?? []), ...(data.deployableMissions ?? [])].filter((m: any) => m.status === "running" || m.status === "executing").length} live`;
    case "connections": return `${Object.values(data.providers ?? {}).filter(providerConnected).length}/${Object.keys(data.providers ?? {}).length || PROVIDERS.length}`;
    case "trust":       return data.directOwner ? "owner" : data.principal?.kind ?? "locked";
    case "kalshi":      return data.markets?.[0] ? `YES ${data.markets[0].yesBid}¢` : "·";
    case "vision":      return data.mesh?.liveScreen?.active ? "LIVE" : `${(data.mesh?.objects ?? []).filter((item: any) => ["screen", "image", "photo", "camera"].includes(String(item?.type || "").toLowerCase())).length} assets`;
    case "memory":      return `${data.total ?? data.entries?.length ?? "—"}`;
    case "devices":     return `${(data.devices ?? []).filter((d: any) => d.approved && d.status === "approved").length} paired`;
    case "receipts":    return `${data.total ?? data.receipts?.length ?? "—"}`;
    case "graph":       return `${data.stats?.active ?? data.entities?.length ?? 0} nodes`;
    case "helix":       return `${data.projects?.length ?? 0} projects`;
    case "synapse":     return data.activeSession ? (data.activeSession.status === "active" ? "live" : String(data.activeSession.status)) : "idle";
    default:            return "—";
  }
}

function getChipStatus(id: string, data: any): "active" | "warning" | "inactive" {
  if (!data) return "inactive";
  if (data.__state === "disconnected") return "inactive";
  if (data.__state === "stale") return "warning";
  switch (id) {
    case "runtime":
      if (data.status?.emergencyStop?.stopped) return "warning";
      return data.status?.state === "ready" ? "active" : "inactive";
    case "connections": {
      const vals = Object.values(data.providers ?? {});
      if (vals.length > 0 && vals.every(providerConnected)) return "active";
      if (vals.some(providerConnected)) return "warning";
      return "inactive";
    }
    case "trust":
      return data.state === "live" && data.principal ? "active" : "inactive";
    case "agents": {
      const missions = [...(data.durableMissions ?? []), ...(data.deployableMissions ?? [])];
      if (missions.some((m: any) => m.status === "running" || m.status === "executing")) return "active";
      return missions.some((m: any) => m.status === "queued" || m.status === "paused") ? "warning" : "inactive";
    }
    case "kalshi":
      return data.__state === "live" && Array.isArray(data.markets) && data.markets.length > 0 ? "active" : "inactive";
    case "synapse":
      return data.activeSession?.status === "active" ? "active" : data.activeSession?.pendingJoin ? "warning" : "inactive";
    default:
      return "active";
  }
}

// ─── Fetch logic per widget ───────────────────────────────────────────────────

async function widgetApi(path: string, empty: Record<string, unknown>): Promise<any> {
  try {
    const value = await api<any>(path);
    return { ...value, __state: value?.__state || "live", __fetchedAt: new Date().toISOString() };
  } catch (error) {
    return {
      ...empty,
      __state: "disconnected",
      __error: error instanceof Error ? error.message : String(error),
      __fetchedAt: new Date().toISOString(),
    };
  }
}

async function fetchWidgetData(id: string): Promise<any> {
  switch (id) {
    case "runtime":
      return Promise.all([
        widgetApi("/api/action/status", { state: "unavailable", emergencyStop: { stopped: false } }),
        widgetApi("/api/action/tasks?limit=100", { tasks: [] }),
        widgetApi("/api/action/surfaces", { surfaces: [] }),
        widgetApi("/api/action/automations", { automations: [] }),
      ]).then(([status, tasks, surfaces, automations]) => ({
        status,
        tasks: tasks.tasks || [],
        surfaces: surfaces.surfaces || [],
        automations: automations.automations || [],
        __state: [status, tasks, surfaces, automations].every((item) => item.__state === "live") ? "live" : "disconnected",
        __error: [status, tasks, surfaces, automations].find((item) => item.__error)?.__error,
        __fetchedAt: new Date().toISOString(),
      }));
    case "contacts":
      // The channel catalogue comes with the list so the editor can render every field the store
      // accepts. Fetching it separately inside the component would let the two disagree about what
      // exists — a field offered that is silently dropped, or a stored channel with no way to edit.
      return Promise.all([
        widgetApi("/api/contacts", { contacts: [] }),
        widgetApi("/api/contacts/meta", { channels: [] }),
      ]).then(([list, meta]) => ({
        contacts: list.contacts || [],
        channels: meta.channels || [],
        __state: list.__state,
        __error: list.__error,
        __fetchedAt: new Date().toISOString(),
      }));
    case "today":
      return widgetApi("/api/atlas/today", { available: false });
    case "profile":
      return widgetApi("/api/profile", { available: false });
    case "weather":
      return widgetApi("/api/weather", { available: false });
    case "vitals":
      return widgetApi("/api/system-vitals", { available: false });
    case "modules":
      return widgetApi("/api/modules", { modules: [] });
    case "projects":
      return widgetApi("/api/projects", { projects: [] });
    case "agents":
      return Promise.all([
        widgetApi("/api/agents", { agents: [] }),
        widgetApi("/api/agents/missions?limit=100", { missions: [] }),
        widgetApi("/api/missions", { missions: [], roles: {} }),
      ]).then(([specialists, deployable, durable]) => ({
        agents: specialists.agents || [],
        deployableMissions: (deployable.missions || []).map((mission: any) => ({ ...mission, _source: "deployable" })),
        durableMissions: (durable.missions || []).map((mission: any) => ({ ...mission, _source: "durable" })),
        roles: durable.roles || {},
        __state: [specialists, deployable, durable].some((item) => item.__state === "live") ? "live" : "disconnected",
        __fetchedAt: new Date().toISOString(),
      }));
    case "connections":
      return widgetApi("/api/provider-health", { providers: {} });
    case "trust":
      return Promise.all([
        widgetApi("/api/security/trust", { state: "disconnected", principal: null }),
        widgetApi("/api/confirmations/pending", { confirmations: [] }),
        widgetApi("/api/devices", { devices: [] }),
      ]).then(([trust, approvals, devices]) => ({
        ...trust,
        confirmations: approvals.confirmations || [],
        devices: devices.devices || [],
        __state: trust.__state,
        __fetchedAt: new Date().toISOString(),
      }));
    case "kalshi": {
      const watchlist = await api<any>("/api/kalshi/watchlist").catch((error) => ({
        __state: "disconnected", __error: error instanceof Error ? error.message : String(error),
        balance: 0, portfolioValue: 0, markets: [], positions: [],
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
        markets: Array.isArray(watchlist.markets) ? watchlist.markets : [],
        __state: watchlist.__state || (watchlist.markets?.length ? "live" : "empty"),
        __error: watchlist.__error,
      };
    }
    case "vision":
      return widgetApi("/api/device-mesh/status", { mesh: {}, frameUrl: "", visionModel: "Gemini" });
    case "memory":
      return Promise.all([
        widgetApi("/api/memory-os/v4/status", { counts: {}, agents: [], folders: {} }),
        widgetApi("/api/memory-os/v4/objects?limit=100", { objects: [] }),
        widgetApi("/api/neural-vault/status", { counts: {}, continuity: {} }),
        widgetApi("/api/neural-vault/entries?limit=100", { entries: [] }),
        widgetApi("/api/neural-vault/continuity", {}),
      ]).then(([memoryOs, objects, vault, entries, continuity]) => ({
        memoryOs,
        objects: objects.objects ?? [],
        vault,
        entries: entries.entries ?? [],
        continuity,
        total: memoryOs?.counts?.objects ?? objects.objects?.length ?? 0,
        __state: [memoryOs, objects, vault].some((item) => item.__state === "live") ? "live" : "disconnected",
        __fetchedAt: new Date().toISOString(),
      }));
    case "devices":
      return widgetApi("/api/devices", { devices: [] });
    case "receipts":
      return widgetApi("/api/receipts", { receipts: [], total: 0 });
    case "graph":
      return widgetApi("/api/memory/life-graph?limit=120", { stats: {}, buckets: {}, entities: [], summary: {} });
    case "helix":
      return widgetApi("/api/helix/projects", { projects: [] });
    case "synapse":
      return widgetApi("/api/coop-symbiote/status", { activeSession: null });
    default:
      return {};
  }
}

// ─── Main WidgetStrip component ───────────────────────────────────────────────

function LegacyWidgetStrip({ mode, showChips = true }: { mode: string; showChips?: boolean }) {
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
      const detail = (e as CustomEvent).detail || {};
      const id = detail.id as string | undefined;
      if (!id || !WIDGETS.find(w => w.id === id)) return;
      setActiveId(id);
      // Cortex v4 P1.3 — "in focus mode" opens the widget expanded, not as a chip card.
      setActiveView(detail.focus ? "expanded" : "card");
    }
    document.addEventListener("jarvis:open-widget", handle);
    function handleUi(e: Event) {
      const detail = (e as CustomEvent).detail || {};
      const id = detail.id as string | undefined;
      if (detail.type === "close-widget" && (!id || id === activeId)) {
        setActiveId(null);
        setActiveView("chip");
        return;
      }
      if (detail.type === "populate-widget" && id && WIDGETS.some((widget) => widget.id === id)) {
        setWidgetData((current) => ({ ...current, [id]: { ...(detail.data || {}), __state: detail.state || "live", __fetchedAt: new Date().toISOString() } }));
        setFetchedIds((current) => new Set(current).add(id));
        setActiveId(id);
        setActiveView(detail.focus ? "expanded" : "card");
      }
    }
    document.addEventListener("jarvis:ui", handleUi);
    return () => {
      document.removeEventListener("jarvis:open-widget", handle);
      document.removeEventListener("jarvis:ui", handleUi);
    };
  }, [activeId]);

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
      case "today":       return <TodayCard       {...props} key={id} />;
      case "profile":     return <ProfileCard     {...props} key={id} />;
      case "weather":     return <WeatherCard     {...props} key={id} />;
      case "vitals":      return <VitalsCard      {...props} key={id} />;
      case "modules":     return <ModulesCard     {...props} key={id} />;
      case "projects":    return <ProjectsCard    {...props} key={id} />;
      case "agents":      return <AgentsCard      {...props} key={id} />;
      case "connections": return <ConnectionsCard {...props} key={id} />;
      case "trust":       return <TrustCard       {...props} key={id} />;
      case "kalshi":      return <KalshiCard      {...props} key={id} />;
      case "vision":      return <VisionCard      {...props} key={id} />;
      case "memory":      return <MemoryCard      {...props} key={id} />;
      case "devices":     return <DevicesCard     {...props} key={id} />;
      case "receipts":    return <ReceiptsCard    {...props} key={id} />;
      case "graph":       return <GraphCard onClose={handleClose} onExpand={handleExpand} key={id} />;
      case "helix":       return <HelixCard       {...props} key={id} />;
      case "synapse":     return <SynapseWidget   key={id} />;
      default:            return null;
    }
  }

  function renderExpanded(id: string) {
    const data = widgetData[id];
    const loading = loadingIds.has(id);
    const props = { data, loading, onClose: handleClose };
    switch (id) {
      case "contacts":    return <ContactsCommandCenter data={data} loading={loading} onRefresh={() => void handleRefresh(id)} />;
      case "today":       return <TodayCommandCenter data={data} loading={loading} />;
      case "profile":     return <ProfileCommandCenter data={data} loading={loading} />;
      case "weather":     return <WeatherCommandCenter data={data} loading={loading} />;
      case "vitals":      return <VitalsCommandCenter data={data} loading={loading} />;
      case "modules":     return <ModulesCommandCenter data={data} loading={loading} />;
      case "projects":    return <ProjectsCommandCenter data={data} loading={loading} />;
      case "agents":      return <AgentsCommandCenter data={data} loading={loading} onRefresh={() => void handleRefresh(id)} />;
      case "connections": return <ConnectionsCommandCenter data={data} loading={loading} />;
      case "trust":       return <TrustCommandCenter data={data} loading={loading} />;
      case "kalshi":      return <KalshiExpanded      {...props} onRefresh={() => handleRefresh(id)} />;
      case "vision":      return <VisionCommandCenter data={data} loading={loading} onRefresh={() => void handleRefresh(id)} />;
      case "memory":      return <MemoryCommandCenter data={data} loading={loading} />;
      case "devices":     return <DeviceMeshCommandCenter />;
      case "receipts":    return <ReceiptsCommandCenter data={data} loading={loading} />;
      case "graph":       return <GraphCommandCenter data={data} loading={loading} />;
      case "helix":       return <HelixExpanded onClose={handleClose} />;
      case "synapse":     return <SynapseWidget />;
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

// ─── Era III Spatial Workspace ──────────────────────────────────────────────

const SPATIAL_STORAGE_KEY = "jarvis.spatial-widgets.v1";

function loadSpatialWindows(): Record<string, SpatialWidgetState> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SPATIAL_STORAGE_KEY) || "{}");
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* start with a clean workspace */ }
  return {};
}

function defaultSpatialWindow(id: string, order: number, focus = false): SpatialWidgetState {
  const columns = Math.max(1, Math.floor((window.innerWidth - 80) / 560));
  const column = order % columns;
  const row = Math.floor(order / columns) % 2;
  const w = Math.min(680, Math.max(580, window.innerWidth * .36));
  const h = Math.min(610, Math.max(500, window.innerHeight * .56));
  if (focus) return { id, mode: "expanded", x: Math.round(window.innerWidth * .07), y: 12, w: Math.min(1240, Math.round(window.innerWidth * .76)), h: Math.min(760, window.innerHeight - 148), z: 100 + order };
  return { id, mode: "normal", x: 22 + column * 42, y: 14 + row * 44, w, h, z: 100 + order };
}

// ─── W1: widget command & control — Jarvis moves / resizes / arranges windows ──
// Pure geometry so the brain can say "put the calendar top-right", "make it small",
// "tidy my widgets" and get a clean, viewport-clamped, non-overlapping result.

const SIZE_PRESETS: Record<string, { w: number; h: number }> = {
  small: { w: 400, h: 360 },
  medium: { w: 580, h: 500 },
  large: { w: 800, h: 640 },
};

function clampRect(x: number, y: number, w: number, h: number) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const cw = Math.min(w, vw - 24), ch = Math.min(h, vh - 24);
  return {
    x: Math.round(Math.max(12, Math.min(x, vw - cw - 12))),
    y: Math.round(Math.max(12, Math.min(y, vh - ch - 12))),
    w: Math.round(cw), h: Math.round(ch),
  };
}

// A named screen region → top-left corner for a widget of size w×h.
function positionToXY(position: string, w: number, h: number) {
  const vw = window.innerWidth, vh = window.innerHeight, M = 18;
  const cx = Math.round((vw - w) / 2), cy = Math.round((vh - h) / 2);
  const left = M, right = Math.round(vw - w - M), top = M, bottom = Math.round(vh - h - M);
  const key = (position || "").toLowerCase().trim().replace(/[\s_]+/g, "-");
  const map: Record<string, { x: number; y: number }> = {
    "top-left": { x: left, y: top }, "top-right": { x: right, y: top },
    "bottom-left": { x: left, y: bottom }, "bottom-right": { x: right, y: bottom },
    "center": { x: cx, y: cy }, "middle": { x: cx, y: cy },
    "left": { x: left, y: cy }, "right": { x: right, y: cy },
    "top": { x: cx, y: top }, "bottom": { x: cx, y: bottom },
  };
  return map[key] || { x: cx, y: cy };
}

// Even grid over N ids — no overlap, leaves room for the command bar at the bottom.
function tileLayout(ids: string[]): Record<string, { x: number; y: number; w: number; h: number }> {
  const vw = window.innerWidth, vh = window.innerHeight;
  const M = 18, G = 14, topPad = 16, bottomPad = 104;
  const n = ids.length;
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  if (n === 0) return out;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cw = Math.floor((vw - M * 2 - G * (cols - 1)) / cols);
  const ch = Math.floor((vh - topPad - bottomPad - G * (rows - 1)) / rows);
  ids.forEach((id, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    out[id] = { x: M + c * (cw + G), y: topPad + r * (ch + G), w: Math.max(300, cw), h: Math.max(220, ch) };
  });
  return out;
}

// Diagonal cascade — medium windows stepped from the top-left.
function cascadeLayout(ids: string[]): Record<string, { x: number; y: number; w: number; h: number }> {
  const w = 560, h = 460, step = 40, M = 26;
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  ids.forEach((id, i) => { out[id] = clampRect(M + i * step, M + i * step, w, h); });
  return out;
}

// Awareness / no-overlap: find a spot for a NEW window that does not cover any
// open one. Scans left-to-right, top-to-bottom for the first clear slot; returns
// null when the screen is genuinely full (caller then re-tiles everything to fit).
function findFreeSlot(current: Record<string, SpatialWidgetState>, w: number, h: number): { x: number; y: number } | null {
  const vw = window.innerWidth, vh = window.innerHeight;
  const M = 18, pad = 10, bottomPad = 96, stepX = 46, stepY = 42;
  const taken = Object.values(current).filter((s) => s.mode !== "minimized").map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }));
  const hits = (x: number, y: number) => taken.some((r) =>
    !(x + w + pad <= r.x || r.x + r.w + pad <= x || y + h + pad <= r.y || r.y + r.h + pad <= y));
  for (let y = M; y + h <= vh - bottomPad; y += stepY) {
    for (let x = M; x + w <= vw - M; x += stepX) {
      if (!hits(x, y)) return { x, y };
    }
  }
  return null; // full — caller re-tiles
}

export function WidgetStrip({ mode }: { mode: string; showChips?: boolean }) {
  const [windows, setWindows] = useState<Record<string, SpatialWidgetState>>(loadSpatialWindows);
  const [widgetData, setWidgetData] = useState<Record<string, any>>({});
  // W2: externally-driven view state per widget (which tab/segment/filter to show).
  // `nonce` bumps each command so a widget re-applies even if the view value repeats.
  const [widgetView, setWidgetView] = useState<Record<string, { view: string; filter: string; select: string; nonce: number }>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const windowsRef = useRef(windows);
  const inFlightRef = useRef<Set<string>>(new Set());
  windowsRef.current = windows;

  useEffect(() => {
    try { localStorage.setItem(SPATIAL_STORAGE_KEY, JSON.stringify(windows)); } catch { /* persistence is best effort */ }
  }, [windows]);

  // The launcher marks which modules are already on screen. This state lives here, so it is
  // broadcast rather than duplicated — a second copy would confidently label a closed widget "open"
  // the moment the two fell out of step. The query event exists because the launcher mounts after
  // the last change was announced and would otherwise show nothing as open until something moved.
  const openIds = Object.keys(windows);
  const openKey = openIds.join(",");
  useEffect(() => {
    function announce() {
      document.dispatchEvent(new CustomEvent("jarvis:widgets-changed", { detail: { ids: openKey ? openKey.split(",") : [] } }));
    }
    announce();
    document.addEventListener("jarvis:widgets-query", announce);
    return () => document.removeEventListener("jarvis:widgets-query", announce);
  }, [openKey]);

  const refresh = useCallback(async (id: string) => {
    if (inFlightRef.current.has(id)) return;
    inFlightRef.current.add(id);
    setLoadingIds((current) => new Set(current).add(id));
    try {
      const next = await fetchWidgetData(id);
      setWidgetData((current) => {
        const prior = current[id];
        if (next?.__state === "disconnected" && prior && prior.__state !== "disconnected") {
          return { ...current, [id]: { ...prior, __state: "stale", __error: next.__error, __fetchedAt: new Date().toISOString() } };
        }
        return { ...current, [id]: next };
      });
    } finally {
      inFlightRef.current.delete(id);
      setLoadingIds((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  }, []);

  const openWidget = useCallback((id: string, focus = false) => {
    if (!WIDGETS.some((widget) => widget.id === id)) return;
    setWindows((current) => {
      const nextZ = Math.max(300, ...Object.values(current).map((state) => state.z)) + 1;
      const existing = current[id];
      if (existing) {
        // Focus/expand must actually grow the window to full-screen dims — "expanded" mode is only a
        // border style in CSS, the size lives in state, so re-focusing an open widget must resize it
        // too (otherwise "expand it" flips a class and nothing visibly changes).
        if (focus) {
          const f = defaultSpatialWindow(id, 0, true);
          return { ...current, [id]: { ...existing, mode: "expanded", x: f.x, y: f.y, w: f.w, h: f.h, z: nextZ } };
        }
        const next = { ...existing, mode: existing.mode === "minimized" ? "normal" : existing.mode, z: nextZ };
        return { ...current, [id]: next };
      }
      const base = defaultSpatialWindow(id, Object.keys(current).length, focus);
      // Expanded/focus windows are meant to dominate — place as-is.
      if (focus) return { ...current, [id]: { ...base, z: nextZ } };
      // Normal window: drop it into the first clear slot so it covers nothing.
      const slot = findFreeSlot(current, base.w, base.h);
      if (slot) return { ...current, [id]: { ...base, ...slot, z: nextZ } };
      // Screen is full — add it, then re-tile everything so nothing overlaps.
      const withNew = { ...current, [id]: { ...base, z: nextZ } };
      const ids = Object.keys(withNew).filter((k) => withNew[k].mode !== "minimized");
      const rects = tileLayout(ids);
      const tiled = { ...withNew };
      let z = 300;
      for (const k of ids) { const rr = rects[k]; if (rr) tiled[k] = { ...tiled[k], mode: "normal", x: rr.x, y: rr.y, w: rr.w, h: rr.h, z: ++z }; }
      return tiled;
    });
    void refresh(id);
  }, [refresh]);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent).detail || {};
      if (detail.id) openWidget(String(detail.id), Boolean(detail.focus));
    }
    function handleUi(event: Event) {
      const detail = (event as CustomEvent).detail || {};
      const id = String(detail.id || "");
      if (detail.type === "close-widget") {
        setWindows((current) => { const next = { ...current }; if (id) delete next[id]; else for (const key of Object.keys(next)) delete next[key]; return next; });
      }
      if (detail.type === "populate-widget" && id) {
        setWidgetData((current) => ({ ...current, [id]: { ...(detail.data || {}), __state: detail.state || "live", __fetchedAt: new Date().toISOString() } }));
        openWidget(id, Boolean(detail.focus));
      }
      if (detail.type === "move-widget" && id) {
        if (!WIDGETS.some((w) => w.id === id)) return; // ignore unknown widget ids
        setWindows((current) => {
          const nextZ = Math.max(300, ...Object.values(current).map((s) => s.z)) + 1;
          // Open it if it isn't already, so the move is a real, visible effect (never a silent no-op).
          const cur = current[id] || defaultSpatialWindow(id, Object.keys(current).length, false);
          // A minimized or expanded (full-screen) widget cannot visibly "move" — normalise its size
          // first, otherwise a full-screen widget nudged to a corner still fills the screen.
          let w = cur.w, h = cur.h, mode = cur.mode;
          if (mode !== "normal") { w = SIZE_PRESETS.medium.w; h = SIZE_PRESETS.medium.h; mode = "normal"; }
          let x = Number.isFinite(detail.x) ? Number(detail.x) : undefined;
          let y = Number.isFinite(detail.y) ? Number(detail.y) : undefined;
          if (x === undefined || y === undefined) {
            const p = positionToXY(String(detail.position || "center"), w, h);
            x = p.x; y = p.y;
          }
          const r = clampRect(x, y, w, h);
          return { ...current, [id]: { ...cur, mode, x: r.x, y: r.y, w: r.w, h: r.h, z: nextZ } };
        });
      }
      if (detail.type === "resize-widget" && id) {
        if (!WIDGETS.some((w) => w.id === id)) return;
        setWindows((current) => {
          const cur = current[id] || defaultSpatialWindow(id, Object.keys(current).length, false);
          const size = String(detail.size || "").toLowerCase().trim();
          const nextZ = Math.max(300, ...Object.values(current).map((s) => s.z)) + 1;
          if (size === "minimize" || size === "minimized") return { ...current, [id]: { ...cur, mode: "minimized" } };
          if (["expand", "expanded", "maximize", "maximise", "full", "fullscreen"].includes(size)) {
            const f = defaultSpatialWindow(id, 0, true);
            return { ...current, [id]: { ...cur, mode: "expanded", x: f.x, y: f.y, w: f.w, h: f.h, z: nextZ } };
          }
          const preset = SIZE_PRESETS[size];
          const w = Number.isFinite(detail.w) ? Number(detail.w) : preset?.w;
          const h = Number.isFinite(detail.h) ? Number(detail.h) : preset?.h;
          if (!w || !h) return current;
          const r = clampRect(cur.x, cur.y, w, h);
          return { ...current, [id]: { ...cur, mode: "normal", x: r.x, y: r.y, w: r.w, h: r.h, z: nextZ } };
        });
      }
      if (detail.type === "arrange-widgets") {
        setWindows((current) => {
          const layout = String(detail.layout || "tile").toLowerCase().trim();
          const ids = Object.keys(current).filter((k) => current[k].mode !== "minimized");
          if (ids.length === 0) return current;
          const rects = (layout === "cascade" || layout === "stack") ? cascadeLayout(ids) : tileLayout(ids);
          const next = { ...current };
          let z = 300;
          for (const k of ids) {
            const rr = rects[k];
            if (rr) next[k] = { ...next[k], mode: "normal", x: rr.x, y: rr.y, w: rr.w, h: rr.h, z: ++z };
          }
          return next;
        });
      }
      if (detail.type === "set-view" && id) {
        // Make sure the widget is on screen. Kalshi's tabbed dashboard only exists in
        // expanded mode, so a Kalshi view command also expands it.
        openWidget(id, id === "kalshi");
        setWidgetView((cur) => ({
          ...cur,
          [id]: {
            view: String(detail.view || "").toLowerCase(),
            filter: String(detail.filter || "").toLowerCase(),
            select: String(detail.select || ""),
            nonce: (cur[id]?.nonce || 0) + 1,
          },
        }));
      }
    }
    document.addEventListener("jarvis:open-widget", handleOpen);
    document.addEventListener("jarvis:ui", handleUi);
    return () => {
      document.removeEventListener("jarvis:open-widget", handleOpen);
      document.removeEventListener("jarvis:ui", handleUi);
    };
  }, [openWidget]);

  useEffect(() => {
    const ids = Object.keys(windows);
    for (const id of ids) if (!widgetData[id]) void refresh(id);
  }, [windows, widgetData, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      for (const [id, state] of Object.entries(windowsRef.current)) if (state.mode !== "minimized") void refresh(id);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (mode !== "main") return null;

  const patchWindow = (id: string, patch: Partial<SpatialWidgetState>) => setWindows((current) => ({
    ...current,
    [id]: { ...current[id], ...patch },
  }));
  const closeWindow = (id: string) => setWindows((current) => { const next = { ...current }; delete next[id]; return next; });
  const focusWindow = (id: string) => {
    setWindows((current) => ({ ...current, [id]: { ...current[id], z: Math.max(300, ...Object.values(current).map((state) => state.z)) + 1 } }));
  };

  function renderSpatialContent(id: string, state: SpatialWidgetState) {
    const data = widgetData[id];
    const loading = loadingIds.has(id);
    const onClose = () => closeWindow(id);
    const props = { data, loading, onClose };
    switch (id) {
      case "runtime":     return <RuntimeWidget mode={state.mode} initialData={data} onRefresh={() => void refresh(id)} />;
      case "contacts":    return <ContactsCommandCenter data={data} loading={loading} onRefresh={() => void refresh(id)} />;
      case "today":       return state.mode === "expanded"
                            ? <TodayDashboard data={data} loading={loading} onRefresh={() => void refresh(id)} onExpand={() => patchWindow(state.id, { mode: "expanded" })} /> // focused view: full reference dashboard
                            : <TodayCard {...props} embedded onRefresh={() => void refresh(id)} onExpand={() => patchWindow(state.id, { mode: "expanded" })} />;            // normal view: compact card
      case "profile":     return <ProfileCommandCenter data={data} loading={loading} />;
      case "weather":     return <WeatherCommandCenter data={data} loading={loading} />;
      case "vitals":      return <VitalsCommandCenter data={data} loading={loading} />;
      case "modules":     return <ModulesCommandCenter data={data} loading={loading} />;
      case "projects":    return <ProjectsCommandCenter data={data} loading={loading} />;
      case "agents":      return <AgentsCommandCenter data={data} loading={loading} onRefresh={() => void refresh(id)} viewCmd={widgetView[id]} />;
      case "connections": return <ConnectionsCommandCenter data={data} loading={loading} viewCmd={widgetView[id]} />;
      case "trust":       return <TrustCommandCenter data={data} loading={loading} />;
      case "kalshi":      return state.mode === "expanded"
                            ? <KalshiExpanded {...props} embedded onRefresh={() => refresh(id)} viewCmd={widgetView[id]} />   // focused view: full tabbed dashboard
                            : <KalshiCard {...props} embedded onExpand={() => patchWindow(state.id, { mode: "expanded" })} />; // normal view: compact card
      case "vision":      return <VisionCommandCenter data={data} loading={loading} onRefresh={() => void refresh(id)} />;
      case "memory":      return <MemoryCommandCenter data={data} loading={loading} viewCmd={widgetView[id]} />;
      case "devices":     return <DeviceMeshCommandCenter />;
      case "receipts":    return <ReceiptsCommandCenter data={data} loading={loading} />;
      case "graph":       return <GraphCommandCenter data={data} loading={loading} />;
      case "helix":       return <HelixExpanded onClose={onClose} />;
      case "synapse":     return <SynapseWidget />;
      default:              return null;
    }
  }

  const visibleWindows = Object.values(windows).filter((state) => state.mode !== "minimized").sort((left, right) => left.z - right.z);
  const minimizedRuntime = windows.runtime?.mode === "minimized" ? windows.runtime : null;
  return (
    <div className="spatial-workspace">
      {minimizedRuntime && <RuntimeMinimized
        data={widgetData.runtime}
        onRestore={() => patchWindow("runtime", { mode: "normal", z: Math.max(300, ...Object.values(windows).map((state) => state.z)) + 1 })}
        onStop={() => { void api("/api/action/stop", { method: "POST", body: JSON.stringify({ reason: "Owner stopped Action Fabric from minimized Runtime" }) }).then(() => refresh("runtime")); }}
      />}
      {visibleWindows.map((state) => {
        const widget = WIDGETS.find((item) => item.id === state.id)!;
        const data = widgetData[state.id];
        return (
          <SpatialWidgetFrame
            key={state.id}
            state={state}
            icon={widget.icon}
            title={widget.label}
            stat={data ? getChipStat(state.id, data) : "syncing"}
            status={data ? getChipStatus(state.id, data) : "inactive"}
            fetchedAt={data?.__fetchedAt || data?.generatedAt}
            loading={loadingIds.has(state.id)}
            onFocus={() => focusWindow(state.id)}
            onUpdate={(patch) => patchWindow(state.id, patch)}
            onClose={() => closeWindow(state.id)}
            onRefresh={() => void refresh(state.id)}
          >
            {renderSpatialContent(state.id, state)}
          </SpatialWidgetFrame>
        );
      })}

    </div>
  );
}
