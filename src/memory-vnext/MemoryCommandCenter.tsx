import { useMemo, useState } from "react";
import "./memory-command-center.css";

type Row = Record<string, unknown>;
type Surface = { label: string; summary: Array<[string, number | string]>; rows?: Row[] };

export type MemoryCommandCenterModel = {
  title: string;
  state: "healthy" | "degraded" | "unhealthy";
  generatedAt: string;
  overview: { canonicalSequence: number; schemaVersion: number; scopes: number; candidates: number; conflicts: number; staleProjections: number; backups: number; providerCostUsd: number; privacyDenials: number };
  conversationCortex: { branches: Row[]; segments: Row[]; stateItems: number; checkpoints: number };
  truth: { assertions: Row[]; active: number; contested: number; conflicts: Row[] };
  context: { packs: Row[]; influence: Row[]; delivered: number; used: number; unused: number };
  workers: { supervisor?: Row; jobs: Row[]; outbox: Row[]; activeLeases: number };
  cache: { namespaces: Row[]; activeEntries: number; staleRejects: number; providerHandles: number };
  consistency: { canonicalSequence: number; projections: Row[]; watermarks: Row[] };
  consolidation: { proposals: Row[]; replayFailures: number; stagedActive: number };
  forget: { jobs: Row[]; receipts: Row[] };
  privacy: { activeScopes: number; activePolicies: number; denials: number; activeMeshShares: number; revokedMeshShares: number };
  operations: { quickCheck: string; integrityCheck: string; walBytes: number; databaseBytes: number; journalMode: string; synchronous: number; backups: Row[]; exports: Row[]; restoreDrills: Row[]; rebuilds: Row[]; soaks: Row[] };
  actions: string[];
  confirmationRequired: boolean;
};

type Props = { model: MemoryCommandCenterModel; busyAction?: string | null; onAction?: (action: string, confirmed: boolean) => void };
const tabs = ["overview", "cortex", "truth", "context", "workers", "cache", "consistency", "consolidation", "forget", "privacy", "operations"] as const;
type Tab = typeof tabs[number];
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const short = (value: unknown) => typeof value === "number" ? value.toLocaleString() : value == null ? "—" : String(value);

function RecordTable({ rows }: { rows: Row[] }) {
  const columns = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 7), [rows]);
  if (!rows.length) return <div className="mvcc-empty">No records in this view.</div>;
  return <div className="mvcc-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{title(column)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id || row.job_id || row.projector || index)}>{columns.map((column) => <td key={column} title={short(row[column])}>{short(row[column])}</td>)}</tr>)}</tbody></table></div>;
}

function SurfaceView({ surface }: { surface: Surface }) {
  return <section className="mvcc-surface"><header><div><span>LIVE READ MODEL</span><h3>{surface.label}</h3></div><small>{surface.rows?.length || 0} visible records</small></header><div className="mvcc-summary">{surface.summary.map(([label, value]) => <article key={label}><span>{label}</span><strong>{short(value)}</strong></article>)}</div>{surface.rows ? <RecordTable rows={surface.rows} /> : null}</section>;
}

export function MemoryCommandCenter({ model, busyAction = null, onAction }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const surfaces: Record<Tab, Surface> = {
    overview: { label: "System Overview", summary: [["Canonical sequence", model.overview.canonicalSequence], ["Schema", model.overview.schemaVersion], ["Active scopes", model.overview.scopes], ["Review candidates", model.overview.candidates], ["Open conflicts", model.overview.conflicts], ["Stale projections", model.overview.staleProjections], ["Verified backups", model.overview.backups], ["Provider cost", `$${model.overview.providerCostUsd.toFixed(4)}`], ["Privacy denials", model.overview.privacyDenials]] },
    cortex: { label: "Conversation Cortex", summary: [["Active state items", model.conversationCortex.stateItems], ["Checkpoints", model.conversationCortex.checkpoints], ["Branches", model.conversationCortex.branches.length], ["Topic segments", model.conversationCortex.segments.length]], rows: [...model.conversationCortex.branches, ...model.conversationCortex.segments] },
    truth: { label: "Truth Inspector", summary: [["Active assertions", model.truth.active], ["Contested", model.truth.contested], ["Conflict sets", model.truth.conflicts.length]], rows: [...model.truth.assertions, ...model.truth.conflicts] },
    context: { label: "Context & Influence", summary: [["Delivered", model.context.delivered], ["Used", model.context.used], ["Unused", model.context.unused], ["Context packs", model.context.packs.length]], rows: [...model.context.packs, ...model.context.influence] },
    workers: { label: "Worker Control", summary: [["Supervisor", String(model.workers.supervisor?.mode || "unknown")], ["Active leases", model.workers.activeLeases], ["Jobs", model.workers.jobs.length], ["Outbox", model.workers.outbox.length]], rows: [...model.workers.jobs, ...model.workers.outbox] },
    cache: { label: "Cache Fabric", summary: [["Namespaces", model.cache.namespaces.length], ["Active entries", model.cache.activeEntries], ["Stale rejects", model.cache.staleRejects], ["Provider handles", model.cache.providerHandles]], rows: model.cache.namespaces },
    consistency: { label: "Consistency View", summary: [["Canonical sequence", model.consistency.canonicalSequence], ["Projectors", model.consistency.projections.length], ["Watermarks", model.consistency.watermarks.length]], rows: [...model.consistency.projections, ...model.consistency.watermarks] },
    consolidation: { label: "Consolidation Laboratory", summary: [["Proposals", model.consolidation.proposals.length], ["Replay failures", model.consolidation.replayFailures], ["Staged sessions", model.consolidation.stagedActive]], rows: model.consolidation.proposals },
    forget: { label: "Forget Center", summary: [["Forget jobs", model.forget.jobs.length], ["Deletion receipts", model.forget.receipts.length]], rows: [...model.forget.jobs, ...model.forget.receipts] },
    privacy: { label: "Scopes & Privacy", summary: [["Active scopes", model.privacy.activeScopes], ["Active policies", model.privacy.activePolicies], ["Policy denials", model.privacy.denials], ["Active mesh shares", model.privacy.activeMeshShares], ["Revoked shares", model.privacy.revokedMeshShares]] },
    operations: { label: "Backup & Operations", summary: [["Quick check", model.operations.quickCheck], ["Integrity", model.operations.integrityCheck], ["WAL", `${model.operations.walBytes.toLocaleString()} B`], ["Database", `${model.operations.databaseBytes.toLocaleString()} B`], ["Journal", model.operations.journalMode], ["Backups", model.operations.backups.length], ["Off-device exports", model.operations.exports.length], ["Restore drills", model.operations.restoreDrills.length]], rows: [...model.operations.backups, ...model.operations.exports, ...model.operations.restoreDrills, ...model.operations.rebuilds, ...model.operations.soaks] },
  };
  const requestAction = (action: string) => { if (!onAction || busyAction) return; if (!model.confirmationRequired) onAction(action, true); else setPendingAction(action); };
  const confirm = () => { if (!pendingAction) return; onAction?.(pendingAction, true); setPendingAction(null); };

  return <section className="mvcc" aria-label="Memory Command Center">
    <header className="mvcc-head"><div className="mvcc-mark" aria-hidden="true"><i /><b>M</b></div><div><p>JARVIS MEMORY FABRIC · SCHEMA {model.overview.schemaVersion}</p><h2>{model.title}</h2><span>Canonical {model.overview.canonicalSequence.toLocaleString()} · updated {new Date(model.generatedAt).toLocaleTimeString()}</span></div><div className={`mvcc-state is-${model.state}`}><i />{model.state}</div></header>
    <nav className="mvcc-tabs" aria-label="Memory command surfaces">{tabs.map((item) => <button aria-selected={tab === item} key={item} onClick={() => setTab(item)} type="button">{title(item)}</button>)}</nav>
    <SurfaceView surface={surfaces[tab]} />
    <section className="mvcc-control"><header><div><span>GOVERNED ACTIONS</span><strong>Every action requires a one-time owner confirmation</strong></div></header><div>{model.actions.map((action) => <button disabled={!onAction || Boolean(busyAction)} key={action} onClick={() => requestAction(action)} type="button">{busyAction === action ? "Working…" : title(action)}</button>)}</div></section>
    {pendingAction ? <div className="mvcc-confirm" role="alertdialog" aria-label={`Confirm ${title(pendingAction)}`}><div><span>OWNER CONFIRMATION</span><strong>{title(pendingAction)}</strong><p>This creates a short-lived, single-use authorization receipt. The action and result will be audited.</p></div><button onClick={() => setPendingAction(null)} type="button">Cancel</button><button className="is-confirm" onClick={confirm} type="button">Confirm action</button></div> : null}
  </section>;
}

export default MemoryCommandCenter;
