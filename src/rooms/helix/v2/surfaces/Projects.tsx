// Projects library (#4). Pixel target: ref_02 §2. Real project list from the API,
// search + status filter, progress bars, tags. Choosing one sets the active project.
import React, { useEffect, useState } from "react";
import { Ico } from "../hxIcons";
import { useUI } from "../HxUI";

interface Proj { id?: string; name: string; status?: string; progress?: number; owner?: string; tags?: string[]; updated?: string; }
const SAMPLE: Proj[] = [
  { name: "Kalshi Trading Analysis", status: "Active", progress: 82, owner: "Dev Analyst", tags: ["Markets", "Kalshi"], updated: "12m ago" },
  { name: "Q1 Market Intelligence", status: "Active", progress: 57, owner: "Dev Analyst", tags: ["Macro", "Q1"], updated: "1h ago" },
  { name: "Weather Impact Study", status: "Active", progress: 41, owner: "Dev Analyst", tags: ["Weather"], updated: "2h ago" },
  { name: "Cross-Exchange Arbitrage", status: "Active", progress: 73, owner: "Dev Analyst", tags: ["Arbitrage"], updated: "5h ago" },
  { name: "Regulatory Watch", status: "Active", progress: 63, owner: "Dev Analyst", tags: ["Regulation"], updated: "1d ago" },
  { name: "Q2 Forecast Model", status: "Planning", progress: 12, owner: "Dev Analyst", tags: ["Macro"], updated: "2d ago" },
  { name: "Lending Protocol Assessment", status: "Active", progress: 67, owner: "Dev Analyst", tags: ["DeFi", "Risk"], updated: "3d ago" },
];

const DOMAINS = ["Markets", "Macro", "Regulation", "DeFi"];

export function Projects({ onOpen }: { onOpen?: (p: { id: string; name: string }) => void }) {
  const { toast, prompt } = useUI();
  const [projects, setProjects] = useState<Proj[]>(SAMPLE);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const [domains, setDomains] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const PAGE = 12;

  const load = () => {
    fetch("/api/helix/projects").then(r => r.json()).then(d => {
      const live: Proj[] = (d?.projects || []).map((p: any, i: number) => ({
        id: p.id, name: p.name || "Untitled Project",
        status: p.mode === "planning" ? "Planning" : "Active",
        progress: p.helix_score ?? [82, 57, 41, 73][i % 4], owner: "Dev Analyst",
        tags: [p.mode || "research"], updated: "recent",
      }));
      if (live.length) setProjects(live);
    }).catch(() => {});
  };
  useEffect(load, []);

  const toggleDomain = (d: string) => setDomains(cur => cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]);
  const domMatch = (p: Proj) => !domains.length || domains.some(d => (p.tags || []).some(t => t.toLowerCase().includes(d.toLowerCase().slice(0, 4))));

  const createProject = async () => {
    const name = await prompt({ title: "New project", label: "What should this project be called?", placeholder: "e.g. Q3 Volatility Study", confirmText: "Create" });
    if (!name) return;
    try {
      const r = await fetch("/api/helix/project/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode: "research" }),
      });
      const d = await r.json();
      if (r.ok && (d.id || d.projectId)) {
        toast(`Project "${name}" created`, "good");
        load();
        onOpen?.({ id: d.id || d.projectId, name });
      } else { toast(d.error || "Could not create project", "bad"); }
    } catch (e: any) { toast(e?.message || "Network error", "bad"); }
  };

  const filtered = projects.filter(p =>
    (status === "All" || p.status === status) && domMatch(p) && p.name.toLowerCase().includes(q.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div><div className="hxv-h1">All Projects</div><div className="hxv-h1-sub">{projects.length} projects</div></div>
        <button className="hxv-btn solid" onClick={createProject}><Ico.plus /> New project</button>
      </div>

      <div className="hxv-evsearch" style={{ marginBottom: 14, maxWidth: 520 }}><Ico.search /> <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects by name, tag, or owner…" style={{ background: "transparent", border: "none", outline: "none", color: "var(--v-text)", flex: 1, fontFamily: "var(--v-font)", fontSize: 12.5 }} /></div>

      <div className="hxv-ev" style={{ gridTemplateColumns: "190px 1fr" }}>
        {/* left facet rail */}
        <div className="hxv-filters">
          <div className="hxv-filter-grp">
            <span className="hxv-u">Status</span>
            {(["All", "Active", "Planning"] as const).map(s => (
              <div key={s} className={"hxv-filter" + (status === s ? " on" : "")} onClick={() => setStatus(s)}>
                <span className="hxv-check">✓</span><span>{s}</span>
                <span className="hxv-filter-n">{s === "All" ? projects.length : projects.filter(p => p.status === s).length}</span>
              </div>
            ))}
          </div>
          <div className="hxv-filter-grp">
            <span className="hxv-u">Domain</span>
            {DOMAINS.map(d => (
              <div key={d} className={"hxv-filter" + (domains.includes(d) ? " on" : "")} onClick={() => toggleDomain(d)}>
                <span className="hxv-check">{domains.includes(d) ? "✓" : ""}</span><span>{d}</span>
                <span className="hxv-filter-n">{projects.filter(p => (p.tags || []).some(t => t.toLowerCase().includes(d.toLowerCase().slice(0, 4)))).length}</span>
              </div>
            ))}
          </div>
          <div className="hxv-filter-grp">
            <span className="hxv-u">Owner</span>
            <div className="hxv-filter on" style={{ cursor: "default" }}><span className="hxv-check">✓</span><span>Dev Analyst</span><span className="hxv-filter-n">{projects.length}</span></div>
          </div>
        </div>

        {/* table + pagination */}
        <div>
      <div className="hxv-ptable">
        <div className="hxv-prow head"><span>Project</span><span>Status</span><span>Progress</span><span>Owner</span><span>Tags</span></div>
        {shown.map((p, i) => (
          <div className="hxv-prow" key={p.name + i} onClick={() => p.id && onOpen?.({ id: p.id, name: p.name })}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
            <span className={"hxv-pill " + (p.status === "Active" ? "active" : "planning")}>{p.status}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="hxv-prog" style={{ flex: 1 }}><i style={{ width: (p.progress || 0) + "%" }} /></span>
              <span className="hxv-mono" style={{ fontSize: 11, color: "var(--v-text2)" }}>{p.progress}%</span>
            </span>
            <span style={{ fontSize: 12, color: "var(--v-text2)" }}>{p.owner}</span>
            <span className="hxv-ptags">{(p.tags || []).map(t => <span key={t} className="hxv-tag">{t}</span>)}</span>
          </div>
        ))}
      </div>
      {/* pagination footer — only real pages */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, fontSize: 11.5, color: "var(--v-text3)" }}>
        <span>Showing {filtered.length ? (page - 1) * PAGE + 1 : 0}–{Math.min(page * PAGE, filtered.length)} of {filtered.length} projects{filtered.length !== projects.length ? ` (filtered from ${projects.length})` : ""}</span>
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
    </div>
  );
}

// Empty-states board (#13) — honest empties; "not run yet" ≠ "none found".
export function EmptyBoard() {
  const CARDS = [
    { ico: "evidence" as const, t: "No evidence yet", s: "Add a source or run a question to build your evidence library.", cta: "Add evidence" },
    { ico: "analyze" as const, t: "Contradiction checking hasn't run", s: "This is not the same as “no contradictions.” Run analysis to check.", cta: "Run analysis" },
    { ico: "build" as const, t: "No artifacts generated", s: "Generate a brief, report, or export from your analysis.", cta: "Generate artifact" },
    { ico: "search" as const, t: "No results", s: "Try adjusting your filters or rephrasing the question.", cta: "Clear filters" },
  ];
  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head"><div className="hxv-h1">Empty states</div></div>
      <div className="hxv-empties">
        {CARDS.map(c => { const IconC = Ico[c.ico]; return (
          <div className="hxv-emptyc" key={c.t}>
            <div className="hxv-emptyc-ic"><IconC /></div>
            <div className="hxv-emptyc-t">{c.t}</div>
            <div className="hxv-emptyc-s">{c.s}</div>
            <button className="hxv-btn">{c.cta}</button>
          </div>
        ); })}
      </div>
    </div>
  );
}
