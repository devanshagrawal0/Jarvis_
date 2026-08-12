import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import "./MemoryCommandCenter.css";

type MemoryTab = "explore" | "continuity" | "architecture";
// W2: view command shape the brain drives widgets with.
type ViewCmd = { view: string; filter: string; select: string; nonce: number };

function command(text: string) {
  document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text, files: [] } }));
}

function ago(value?: string) {
  if (!value) return "never";
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta)) return "unknown";
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function Metric({ label, value, note, tone = "cyan" }: { label: string; value: number | string; note: string; tone?: string }) {
  return <article className={`mc-metric mc-${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

export function MemoryCommandCenter({ data, loading, viewCmd }: { data: any; loading: boolean; viewCmd?: ViewCmd }) {
  const [tab, setTab] = useState<MemoryTab>("explore");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [selectedUri, setSelectedUri] = useState("");

  // W2: apply an externally-driven tab ("switch memory to continuity / architecture").
  useEffect(() => {
    if (!viewCmd?.nonce) return;
    const v = `${viewCmd.view} ${viewCmd.filter}`.toLowerCase();
    if (/\b(continuity|timeline|history|sessions?)\b/.test(v)) setTab("continuity");
    else if (/\b(architecture|structure|graph|schema|system)\b/.test(v)) setTab("architecture");
    else if (/\b(explore|search|browse|memories|objects?)\b/.test(v)) setTab("explore");
    if (viewCmd.select) setSelectedUri(viewCmd.select);
  }, [viewCmd?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [remoteResults, setRemoteResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [trace, setTrace] = useState<any>(null);
  const [message, setMessage] = useState("");
  const status = data?.memoryOs || {};
  const vault = data?.vault || {};
  const counts = status?.counts || {};
  const vaultCounts = vault?.counts || {};
  const continuity = data?.continuity || vault?.continuity || {};
  const baseObjects: any[] = data?.objects || [];
  const entries: any[] = data?.entries || [];
  const objects = remoteResults ?? baseObjects;
  const types = useMemo(() => [...new Set(baseObjects.map((item) => String(item.type || "unknown")))].sort(), [baseObjects]);
  const visible = objects.filter((item) => type === "all" || item.type === type);
  const selected = objects.find((item) => item.uri === selectedUri) || visible[0];
  const identityAssertions = entries.filter((item) => ["user_identity", "response_tone", "response_format", "behavioral_rule"].includes(String(item.topic))).length;
  const inertAgents = (status?.agents || []).filter((agent: any) => !agent.lastRun).length;

  async function search() {
    const value = query.trim();
    if (!value) { setRemoteResults(null); setMessage(""); return; }
    setSearching(true); setMessage("");
    try {
      const result = await api<any>(`/api/memory-os/v4/query?q=${encodeURIComponent(value)}&limit=40`);
      setRemoteResults(result?.objects || []);
      setSelectedUri(result?.objects?.[0]?.uri || "");
      setMessage(`${result?.objects?.length || 0} canonical objects · ${Math.round(Number(result?.confidence || 0) * 100)}% retrieval confidence`);
    } catch (error) {
      setRemoteResults([]);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setSearching(false); }
  }

  async function inspectTrace() {
    if (!selected?.uri) return;
    setTrace(null); setMessage("Reading storage trace…");
    try {
      const result = await api<any>(`/api/memory-os/v4/storage-trace?uri=${encodeURIComponent(selected.uri)}`);
      setTrace(result); setMessage(`${result?.trace?.length || 0} storage trace steps verified`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  function setContext() {
    if (!selected) return;
    const pack = { uri: selected.uri, title: selected.title, summary: selected.summary, type: selected.type, projectIds: selected.projectIds, updatedAt: selected.updatedAt };
    try { localStorage.setItem("jarvis.active-memory-context", JSON.stringify(pack)); } catch { /* best effort */ }
    document.dispatchEvent(new CustomEvent("jarvis:context-package", { detail: pack }));
    command(`Use this canonical Memory OS object as active context for my next request. URI: ${selected.uri}. Title: ${selected.title}. Summary: ${selected.summary || selected.contentPreview || "No summary"}. First confirm what context was loaded and flag any stale or conflicting evidence.`);
  }

  return <div className="mc-center">
    <section className="mc-hero"><div className="mc-core"><i /><b>4</b></div><div><span>MEMORY OS CONTROL PLANE</span><h2>Memory Observatory</h2><p>Canonical file-backed objects, legacy semantic memories, continuity pointers, retrieval routes, storage traces and governance gaps.</p></div><div className="mc-version">{status?.version || "offline"}</div></section>
    <div className="mc-metrics"><Metric label="Canonical objects" value={counts.objects || 0} note="file + SQLite records" tone="green" /><Metric label="Semantic memories" value={vaultCounts.memories || entries.length || 0} note="legacy retrieval layer" /><Metric label="Indexed files" value={counts.fileIndex || 0} note="FileDB coverage" tone="violet" /><Metric label="Relationship edges" value={counts.edges || 0} note={counts.edges ? "linked graph" : "not populated"} tone={counts.edges ? "green" : "amber"} /></div>
    <nav className="mc-tabs">{(["explore", "continuity", "architecture"] as MemoryTab[]).map((item) => <button key={item} data-active={tab === item} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === "explore" ? <div className="mc-explore"><div className="mc-search"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="Search all canonical Memory OS objects…" /><button onClick={() => void search()}>{searching ? "Searching…" : "Search Memory OS"}</button><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option>{types.map((item) => <option key={item}>{item}</option>)}</select>{remoteResults !== null ? <button onClick={() => { setRemoteResults(null); setQuery(""); setMessage(""); }}>Clear</button> : null}</div>{message ? <div className="mc-message">{message}</div> : null}<div className="mc-split"><section className="mc-panel"><header><div><span>Object catalog</span><strong>{visible.length} visible</strong></div><small>{loading ? "refreshing" : remoteResults ? "query result" : "recent objects"}</small></header><div className="mc-list">{loading && !objects.length ? <div className="mc-empty">Hydrating layered memory…</div> : visible.map((item) => <button key={item.uri} data-selected={selected?.uri === item.uri} onClick={() => { setSelectedUri(item.uri); setTrace(null); }}><i data-type={item.type} /><div><strong>{item.title || item.uri}</strong><span>{item.type || "memory"} · {item.projectIds?.join(", ") || item.scopes?.join(", ") || "global"}</span></div><small>{ago(item.updatedAt || item.createdAt)}</small></button>)}</div></section><section className="mc-panel mc-inspector"><header><div><span>Canonical inspector</span><strong>{selected?.title || "No object"}</strong></div><small>{selected?.status || "—"}</small></header>{selected ? <div className="mc-body"><div className="mc-uri"><span>Stable memory URI</span><code>{selected.uri}</code><button onClick={() => void navigator.clipboard?.writeText(selected.uri)}>Copy</button></div><p className="mc-summary">{selected.summary || "No curated summary."}</p><div className="mc-object-grid"><div><span>Type</span><strong>{selected.type}</strong></div><div><span>Privacy</span><strong>{selected.privacy || "unknown"}</strong></div><div><span>Confidence</span><strong>{Math.round(Number(selected.confidence || 0) * 100)}%</strong></div><div><span>Importance</span><strong>{Math.round(Number(selected.importance || 0) * 100)}%</strong></div><div><span>Created</span><strong>{ago(selected.createdAt)}</strong></div><div><span>Checked</span><strong>{ago(selected.lastCheckedAt)}</strong></div></div><div className="mc-preview"><span>Content preview</span><p>{selected.contentPreview || "No content preview indexed."}</p></div>{selected.tags?.length ? <div className="mc-tags">{selected.tags.map((tag: string) => <code key={tag}>{tag}</code>)}</div> : null}<div className="mc-file"><span>Canonical file</span><code>{selected.filePath || "not reported"}</code></div>{trace ? <div className="mc-trace"><span>Storage proof</span>{(trace.trace || []).map((step: string) => <p key={step}>✓ {step}</p>)}</div> : null}<div className="mc-actions"><button onClick={setContext}>Use as Jarvis context</button><button onClick={() => void inspectTrace()}>Trace storage</button><button onClick={() => command(`Explain this memory object and its provenance. Check whether it is current, contradictory, or missing links. URI: ${selected.uri}`)}>Audit object</button></div></div> : <div className="mc-empty">Select a memory object.</div>}</section></div></div> : null}
    {tab === "continuity" ? <div className="mc-continuity"><section className="mc-panel"><header><div><span>Active working set</span><strong>What “it / this / that” resolve to</strong></div><small>updated {ago(continuity.updated_at)}</small></header><div className="mc-cont-grid">{[["Active project", continuity.active_project],["Active topic",continuity.active_topic],["Active issue",continuity.active_issue],["Active goal",continuity.active_goal],["Active artifact",continuity.active_artifact],["Active file",continuity.active_file],["Active tool",continuity.active_tool],["Last discussed object",continuity.last_discussed_object]].map(([label,value]) => <article key={label}><span>{label}</span><strong>{value || "not set"}</strong></article>)}</div></section><section className="mc-panel"><header><div><span>Conversation commitments</span><strong>Correction + promise memory</strong></div></header><div className="mc-commit"><article><span>Last user correction</span><p>{continuity.last_user_correction || "No correction retained."}</p></article><article><span>Last assistant commitment</span><p>{continuity.last_assistant_commitment || "No commitment retained."}</p></article><article><span>Likely next reference: “it”</span><p>{continuity.likely_next_references?.it || continuity.recent_pronoun_targets?.it || "unresolved"}</p></article></div><div className="mc-actions"><button onClick={() => command("Audit my current continuity state. Tell me what project, topic, issue, goal, artifact, and referents JARVIS will assume, what appears stale, and what should be cleared or refreshed. Do not mutate memory.")}>Audit continuity</button></div></section></div> : null}
    {tab === "architecture" ? <div className="mc-architecture"><section className="mc-layer-map"><article><i>01</i><div><span>Semantic Vault</span><strong>{vaultCounts.memories || 0} SQLite memories</strong><p>Fast legacy memories and FTS retrieval. It is a distinct layer, not the entire memory system.</p></div></article><b>→</b><article><i>02</i><div><span>Memory OS v4</span><strong>{counts.objects || 0} canonical objects</strong><p>Stable `memory://` identities mirrored into Markdown files and database rows.</p></div></article><b>→</b><article><i>03</i><div><span>Continuity</span><strong>{continuity.active_project || "No project"}</strong><p>Small working-state pointer set used to resolve follow-up language and recent intent.</p></div></article></section><div className="mc-health-grid"><section className="mc-panel"><header><div><span>Subsystem health</span><strong>What exists vs. what runs</strong></div></header><div className="mc-health-list"><article data-state={counts.fileIndex ? "ok" : "gap"}><i /> <div><strong>FileDB indexing</strong><p>{counts.fileIndex || 0} files have canonical index records.</p></div></article><article data-state={counts.edges ? "ok" : "gap"}><i /> <div><strong>Relationship graph</strong><p>{counts.edges || 0} edges. Objects exist, but the v4 relationship layer is currently empty.</p></div></article><article data-state={counts.rawEvents ? "ok" : "gap"}><i /> <div><strong>Raw event journal</strong><p>{counts.rawEvents || 0} raw events retained in the Memory OS event folder.</p></div></article><article data-state={counts.agentRuns ? "ok" : "gap"}><i /> <div><strong>Memory agents</strong><p>{status?.agents?.length || 0} definitions; {counts.agentRuns || 0} recorded runs; {inertAgents} have never run.</p></div></article><article data-state={identityAssertions < 2 ? "ok" : "gap"}><i /> <div><strong>Preference/identity assertions</strong><p>{identityAssertions} high-priority legacy assertions need curation when they disagree or duplicate one another.</p></div></article></div></section><section className="mc-panel"><header><div><span>Storage locations</span><strong>Inspectable, not magical</strong></div></header><div className="mc-paths"><article><span>SQLite index</span><code>{status.dbPath || vault.dbPath || "unavailable"}</code></article><article><span>Canonical objects</span><code>{status.folders?.objects || "unavailable"}</code></article><article><span>Compiled context</span><code>{status.folders?.compiled || "unavailable"}</code></article><article><span>Reports</span><code>{status.folders?.reports || "unavailable"}</code></article></div><div className="mc-actions"><button onClick={() => command(`Perform a read-only Memory OS health audit. Current counts: ${counts.objects || 0} objects, ${counts.fileIndex || 0} indexed files, ${counts.edges || 0} edges, ${counts.rawEvents || 0} raw events, ${counts.agentRuns || 0} agent runs, and ${vaultCounts.memories || 0} legacy memories. Explain the consequences and prioritize repairs. Do not run maintenance or mutate data.`)}>Deep memory audit</button></div></section></div></div> : null}
  </div>;
}
