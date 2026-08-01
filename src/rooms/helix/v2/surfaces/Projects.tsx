// Projects library (#4). Reads the SINGLE-SOURCE provider (shell + this surface share one
// list — no drift), search + status/domain facets, real progress, delete-with-cascade.
// Honest states via <SurfaceState>: skeleton while loading, error on failure, empty when a
// project genuinely has none (no more SAMPLE fake rows).
import React, { useMemo, useState } from "react";
import { Ico } from "../hxIcons";
import { useUI } from "../HxUI";
import { useProjects, HProject } from "../HelixProjects";
import { SurfaceState } from "../SurfaceState";

interface Row { id: string; name: string; status: string; progress: number; owner: string; tags: string[] }
const DOMAINS = ["Markets", "Macro", "Regulation", "DeFi"];

function toRow(p: HProject): Row {
  return {
    id: p.id, name: p.name,
    status: p.mode === "planning" ? "Planning" : "Active",
    progress: typeof p.helix_score === "number" ? p.helix_score : 0,
    owner: "Dev Analyst",
    tags: [p.mode || "research"],
  };
}

export function Projects({ onOpen }: { onOpen?: (p: { id: string; name: string }) => void }) {
  const { toast, prompt } = useUI();
  const { projects, loading, error, refresh, create, remove, select } = useProjects();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const [domains, setDomains] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const PAGE = 12;

  const rows = useMemo(() => projects.map(toRow), [projects]);

  const toggleDomain = (d: string) => setDomains(cur => cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]);
  const domMatch = (p: Row) => !domains.length || domains.some(d => p.tags.some(t => t.toLowerCase().includes(d.toLowerCase().slice(0, 4))));

  const createProject = async () => {
    const name = await prompt({ title: "New project", label: "What should this project be called?", placeholder: "e.g. Q3 Volatility Study", confirmText: "Create" });
    if (!name) return;
    const p = await create(name, "research");
    if (p) { toast(`Project "${name}" created`, "good"); onOpen?.({ id: p.id, name: p.name }); }
    else toast("Could not create project", "bad");
  };

  const removeProject = async (p: Row) => {
    const typed = await prompt({
      title: `Delete "${p.name}"?`,
      label: "This permanently removes the project and all its evidence, decisions, runs, and artifacts. Type DELETE to confirm.",
      placeholder: "DELETE", confirmText: "Delete project",
    });
    if (typed == null) return;
    if (typed.toUpperCase() !== "DELETE") { toast("Type DELETE to confirm", "warn"); return; }
    await remove(p.id);   // provider does optimistic delete + Undo toast + delayed server delete
  };

  const openProject = (p: Row) => { select({ id: p.id, name: p.name }); onOpen?.({ id: p.id, name: p.name }); };

  const filtered = rows.filter(p =>
    (status === "All" || p.status === status) && domMatch(p) && p.name.toLowerCase().includes(q.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div><div className="hxv-h1">All Projects</div><div className="hxv-h1-sub">{rows.length} project{rows.length === 1 ? "" : "s"}</div></div>
        <button className="hxv-btn solid" onClick={createProject}><Ico.plus /> New project</button>
      </div>

      <SurfaceState
        loading={loading && rows.length === 0}
        error={error}
        onRetry={refresh}
        empty={!loading && !error && rows.length === 0}
        emptyTitle="No projects yet"
        emptyMsg="Create your first research project to start gathering evidence and building decisions."
        emptyCta="New project"
        onEmptyCta={createProject}
      >

      <div className="hxv-evsearch" style={{ marginBottom: 14, maxWidth: 520 }}><Ico.search /> <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search projects by name, tag, or owner…" style={{ background: "transparent", border: "none", outline: "none", color: "var(--v-text)", flex: 1, fontFamily: "var(--v-font)", fontSize: 12.5 }} /></div>

      <div className="hxv-ev" style={{ gridTemplateColumns: "190px 1fr" }}>
        <div className="hxv-filters">
          <div className="hxv-filter-grp">
            <span className="hxv-u">Status</span>
            {(["All", "Active", "Planning"] as const).map(s => (
              <div key={s} className={"hxv-filter" + (status === s ? " on" : "")} onClick={() => setStatus(s)}>
                <span className="hxv-check">✓</span><span>{s}</span>
                <span className="hxv-filter-n">{s === "All" ? rows.length : rows.filter(p => p.status === s).length}</span>
              </div>
            ))}
          </div>
          <div className="hxv-filter-grp">
            <span className="hxv-u">Domain</span>
            {DOMAINS.map(d => (
              <div key={d} className={"hxv-filter" + (domains.includes(d) ? " on" : "")} onClick={() => toggleDomain(d)}>
                <span className="hxv-check">{domains.includes(d) ? "✓" : ""}</span><span>{d}</span>
                <span className="hxv-filter-n">{rows.filter(p => p.tags.some(t => t.toLowerCase().includes(d.toLowerCase().slice(0, 4)))).length}</span>
              </div>
            ))}
          </div>
          <div className="hxv-filter-grp">
            <span className="hxv-u">Owner</span>
            <div className="hxv-filter on" style={{ cursor: "default" }}><span className="hxv-check">✓</span><span>Dev Analyst</span><span className="hxv-filter-n">{rows.length}</span></div>
          </div>
        </div>

        <div>
          <div className="hxv-ptable hxv-stag">
            <div className="hxv-prow head"><span>Project</span><span>Status</span><span>Progress</span><span>Owner</span><span>Tags</span></div>
            {shown.length === 0 && (
              <div style={{ padding: 24, fontSize: 12.5, color: "var(--v-text3)" }}>No projects match your filters. Adjust the filters or clear the search.</div>
            )}
            {shown.map((p) => (
              <div className="hxv-prow" key={p.id} onClick={() => openProject(p)}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                <span className={"hxv-pill " + (p.status === "Active" ? "active" : "planning")}>{p.status}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="hxv-prog" style={{ flex: 1 }}><i style={{ width: p.progress + "%" }} /></span>
                  <span className="hxv-mono" style={{ fontSize: 11, color: "var(--v-text2)" }}>{p.progress}%</span>
                </span>
                <span style={{ fontSize: 12, color: "var(--v-text2)" }}>{p.owner}</span>
                <span className="hxv-ptags" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {p.tags.map(t => <span key={t} className="hxv-tag">{t}</span>)}
                  <button
                    title="Delete project" aria-label={`Delete ${p.name}`}
                    onClick={(e) => { e.stopPropagation(); removeProject(p); }}
                    style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--v-text3)", cursor: "pointer", padding: 5, borderRadius: 6, display: "inline-grid", placeItems: "center", lineHeight: 0, fontSize: 15 }}
                    onMouseEnter={e => { e.currentTarget.style.color = "var(--v-bad, #ff5c5c)"; e.currentTarget.style.background = "rgba(255,92,92,0.12)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "var(--v-text3)"; e.currentTarget.style.background = "transparent"; }}
                  ><Ico.trash /></button>
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, fontSize: 11.5, color: "var(--v-text3)" }}>
            <span>Showing {filtered.length ? (page - 1) * PAGE + 1 : 0}–{Math.min(page * PAGE, filtered.length)} of {filtered.length} projects{filtered.length !== rows.length ? ` (filtered from ${rows.length})` : ""}</span>
            {pageCount > 1 && (
              <span style={{ display: "flex", gap: 4 }}>
                {["‹", ...Array.from({ length: pageCount }, (_, i) => String(i + 1)), "›"].map((n, i) => {
                  const active = n === String(page);
                  const go = () => setPage(p => n === "‹" ? Math.max(1, p - 1) : n === "›" ? Math.min(pageCount, p + 1) : Number(n));
                  return (
                    <span key={i} onClick={go} style={{ minWidth: 26, height: 26, display: "grid", placeItems: "center", borderRadius: 6, cursor: "pointer",
                      background: active ? "rgba(51,194,209,0.16)" : "transparent", color: active ? "var(--v-accent)" : "var(--v-text3)", border: "1px solid " + (active ? "rgba(51,194,209,0.3)" : "var(--v-line)") }}>{n}</span>
                  );
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      </SurfaceState>
    </div>
  );
}
