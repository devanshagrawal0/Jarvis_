import { useMemo, useState } from "react";
import "./AssuranceCommandCenters.css";

function when(value?: string) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const delta = Date.now() - date.getTime();
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function jarvis(text: string) {
  document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text, files: [] } }));
}

function safeText(value: unknown, limit = 600) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

function Meter({ label, value, sub, tone = "cyan" }: { label: string; value: string | number; sub: string; tone?: string }) {
  return <article className={`as-meter as-${tone}`}><span>{label}</span><strong>{value}</strong><small>{sub}</small></article>;
}

export function ConnectionsCommandCenter({ data, loading }: { data: any; loading: boolean }) {
  const providers = Object.entries(data?.providers || {}) as [string, any][];
  const [filter, setFilter] = useState<"all" | "connected" | "action">("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const filtered = providers.filter(([key, provider]) => {
    const connected = Boolean(provider?.connected);
    const matches = `${key} ${provider?.label} ${provider?.model} ${provider?.lastError}`.toLowerCase().includes(query.toLowerCase());
    return matches && (filter === "all" || (filter === "connected" ? connected : !connected));
  });
  const selectedEntry = providers.find(([key]) => key === selectedKey) || filtered[0];
  const selected = selectedEntry?.[1];
  const connected = providers.filter(([, provider]) => provider?.connected).length;
  const configured = providers.filter(([, provider]) => provider?.configured || provider?.connected).length;
  const latencies = providers.map(([, provider]) => Number(provider?.latencyMs)).filter(Number.isFinite);
  const average = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  return <div className="as-center">
    <section className="as-hero"><div><span>PROVIDER FABRIC</span><h2>Connection Operations</h2><p>Live provider truth, authentication mode, latency, last activity, configuration gaps and repair evidence.</p></div><div className="as-radar"><i /><i /><b>{connected}</b></div></section>
    <div className="as-meters"><Meter label="Connected" value={`${connected}/${providers.length}`} sub="live providers" tone="green" /><Meter label="Configured" value={configured} sub="credentials present" /><Meter label="Average latency" value={`${average}ms`} sub="measured providers" tone="violet" /><Meter label="Action needed" value={providers.length - connected} sub="missing or offline" tone={providers.length - connected ? "amber" : "green"} /></div>
    <div className="as-tools"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search providers, models, errors…" />{(["all", "connected", "action"] as const).map((item) => <button key={item} data-active={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <div className="as-split"><section className="as-panel"><header><div><span>Provider matrix</span><strong>{filtered.length} services</strong></div><small>latency</small></header><div className="as-provider-list">{loading && !providers.length ? <div className="as-empty">Synchronizing providers…</div> : filtered.map(([key, provider]) => <button key={key} data-selected={selectedEntry?.[0] === key} onClick={() => setSelectedKey(key)}><i data-live={provider.connected} /><div><strong>{provider.label || key}</strong><span>{provider.model || provider.authMode || provider.source || "unconfigured"}</span></div><small>{Number.isFinite(provider.latencyMs) ? `${provider.latencyMs}ms` : "—"}</small></button>)}</div></section>
      <section className="as-panel as-detail"><header><div><span>Connection inspector</span><strong>{selected?.label || "No provider"}</strong></div>{selected ? <small>{selected.connected ? "connected" : selected.validationState || "missing"}</small> : null}</header>{selected ? <div className="as-body"><div className={`as-state ${selected.connected ? "live" : "blocked"}`}><i /><div><span>{selected.connected ? "Operational" : "Not operational"}</span><strong>{selected.connected ? selected.source || "connected" : selected.lastError || `Missing ${(selected.missing || []).join(", ") || "configuration"}`}</strong></div></div><div className="as-grid"><div><span>Model</span><strong>{selected.model || "none"}</strong></div><div><span>Auth</span><strong>{selected.authMode || "not reported"}</strong></div><div><span>Environment</span><strong>{selected.environment || selected.source || "unknown"}</strong></div><div><span>Latency</span><strong>{Number.isFinite(selected.latencyMs) ? `${selected.latencyMs}ms` : "not measured"}</strong></div><div><span>Last request</span><strong>{when(selected.lastRequestAt)}</strong></div><div><span>Last tool</span><strong>{selected.lastToolCall || "none"}</strong></div></div>{selected.baseUrl ? <div className="as-copy"><span>Endpoint</span><code>{selected.baseUrl}</code></div> : null}{selected.scopes?.length ? <div className="as-section"><span>Authorized scopes</span><div className="as-tags">{selected.scopes.map((scope: string) => <code key={scope}>{scope.replace("https://www.googleapis.com/auth/", "")}</code>)}</div></div> : null}{selected.missing?.length ? <div className="as-section"><span>Missing setup</span><ul>{selected.missing.map((item: string) => <li key={item}>{item}</li>)}</ul></div> : null}<div className="as-actions"><button onClick={() => jarvis(`Diagnose the ${selected.label} connection. Explain its current status, exact blocker, safe setup steps, and how to verify it without exposing secrets.`)}>Diagnose with Jarvis</button></div></div> : <div className="as-empty">Select a provider.</div>}</section></div>
  </div>;
}

export function TrustCommandCenter({ data, loading }: { data: any; loading: boolean }) {
  const confirmations: any[] = data?.confirmations || [];
  const devices: any[] = data?.devices || [];
  const pending = devices.filter((device) => !device.approved || String(device.status).includes("pending"));
  const approved = devices.filter((device) => device.approved && device.status === "approved");
  const principal = data?.principal || {};
  const zones = [
    { name: "Direct owner", state: data?.directOwner, detail: "Loopback browser with owner-bound session. Can inspect pending approvals and decide sensitive actions." },
    { name: "Paired device", state: approved.length > 0, detail: `${approved.length} approved nodes use bearer identity and explicit trust levels.` },
    { name: "Public pairing", state: true, detail: "Only health and short-lived pairing bootstrap routes are public." },
    { name: "Cloud relay", state: data?.remoteRelayConfigured, detail: data?.remoteRelayConfigured ? "Authenticated relay configured." : "No authenticated remote relay is configured." },
  ];
  return <div className="as-center trust-center">
    <section className="as-hero"><div><span>ZERO-TRUST CONTROL PLANE</span><h2>Trust & Authority</h2><p>Who JARVIS believes you are, which boundary the request crossed, and what still requires explicit owner approval.</p></div><div className="as-shield">◇<b>{principal.trustLevel || "none"}</b></div></section>
    <div className="as-meters"><Meter label="Principal" value={principal.kind || "none"} sub={principal.id || "unresolved"} tone="green" /><Meter label="Bind scope" value={data?.bindHost || "unknown"} sub="desktop API" /><Meter label="Approved devices" value={approved.length} sub={`${pending.length} pending`} tone="violet" /><Meter label="Confirmations" value={confirmations.length} sub="awaiting owner" tone={confirmations.length ? "amber" : "green"} /></div>
    <div className="as-trust-grid"><section className="as-panel"><header><div><span>Trust-zone map</span><strong>Request boundaries</strong></div></header><div className="as-zones">{zones.map((zone, index) => <article key={zone.name}><div><i data-live={zone.state} /><span>ZONE {index + 1}</span></div><strong>{zone.name}</strong><p>{zone.detail}</p></article>)}</div></section><section className="as-panel"><header><div><span>Owner approval queue</span><strong>{confirmations.length} pending</strong></div></header><div className="as-confirmations">{loading ? <div className="as-empty">Reading owner queue…</div> : confirmations.length ? confirmations.map((item) => <article key={item.id}><div><span>{item.risk || "execute"}</span><small>{when(item.createdAt)}</small></div><strong>{item.tool || item.action || "Sensitive action"}</strong><p>{safeText(item.summary || item.args || item.reason, 240)}</p><button onClick={() => jarvis(`Inspect pending confirmation ${item.id}. Explain the requested action, exact risk, evidence, and whether I should approve or deny it. Do not decide it automatically.`)}>Inspect safely</button></article>) : <div className="as-empty">No owner confirmations are waiting.</div>}</div></section><section className="as-panel as-span"><header><div><span>Security invariants</span><strong>Always enforced</strong></div></header><div className="as-invariants"><article><b>01</b><div><strong>Deny by default</strong><p>Private APIs require a trusted local session, paired bearer identity, or a method/path-bound signed relay assertion.</p></div></article><article><b>02</b><div><strong>Secrets remain references</strong><p>Widgets may show provider metadata and missing environment-variable names, never raw key values.</p></div></article><article><b>03</b><div><strong>Consequential actions stop</strong><p>Send, upload, trade, destructive filesystem, and remote-control actions remain approval-gated.</p></div></article><article><b>04</b><div><strong>Receipts survive actions</strong><p>Plans, results, verification evidence, device identity, risk, and timestamp remain auditable.</p></div></article></div></section></div>
  </div>;
}

export function ReceiptsCommandCenter({ data, loading }: { data: any; loading: boolean }) {
  const receipts: any[] = Array.isArray(data?.receipts) ? data.receipts : [];
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const risks = [...new Set(receipts.map((item) => String(item.risk || "unknown").toLowerCase()))].sort();
  const statuses = [...new Set(receipts.map((item) => String(item.status || "unknown").toLowerCase()))].sort();
  const filtered = useMemo(() => receipts.filter((item) => `${item.action} ${item.target} ${item.result} ${item.deviceId}`.toLowerCase().includes(query.toLowerCase()) && (risk === "all" || String(item.risk).toLowerCase() === risk) && (status === "all" || String(item.status).toLowerCase() === status)), [receipts, query, risk, status]);
  const selected = receipts.find((item) => item.id === selectedId) || filtered[0];
  const verified = receipts.filter((item) => ["verified", "complete", "completed"].includes(String(item.status).toLowerCase())).length;
  const risky = receipts.filter((item) => ["execute", "commit", "dangerous"].includes(String(item.risk).toLowerCase())).length;
  const actions = new Set(receipts.map((item) => item.action)).size;

  return <div className="as-center receipts-center">
    <section className="as-hero"><div><span>VERIFIABLE ACTION LEDGER</span><h2>Receipt Explorer</h2><p>Every recorded action with intent, plan, result, evidence, risk, device identity and execution time.</p></div><div className="as-receipt-mark">✓<b>{receipts.length}</b></div></section>
    <div className="as-meters"><Meter label="Receipts" value={receipts.length} sub="retained records" /><Meter label="Verified" value={verified} sub="evidence complete" tone="green" /><Meter label="Action types" value={actions} sub="unique operations" tone="violet" /><Meter label="High authority" value={risky} sub="execute or commit" tone={risky ? "amber" : "green"} /></div>
    <div className="as-tools"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, target, result, device…" /><select value={risk} onChange={(event) => setRisk(event.target.value)}><option value="all">All risk</option>{risks.map((item) => <option key={item}>{item}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All status</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select><button onClick={() => download(`jarvis-receipts-${new Date().toISOString().slice(0, 10)}.json`, filtered)}>Export</button></div>
    <div className="as-split"><section className="as-panel"><header><div><span>Action ledger</span><strong>{filtered.length} visible</strong></div><small>recorded</small></header><div className="as-receipt-list">{loading && !receipts.length ? <div className="as-empty">Loading receipts…</div> : filtered.map((item) => <button key={item.id} data-selected={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><i data-status={String(item.status).toLowerCase()} /><div><strong>{item.action || "unknown action"}</strong><span>{item.target || "no target"} · {item.deviceId || "unknown device"}</span></div><small>{when(item.createdAt)}</small></button>)}</div></section><section className="as-panel as-detail"><header><div><span>Receipt inspector</span><strong>{selected?.action || "No receipt"}</strong></div>{selected ? <small>{selected.status}</small> : null}</header>{selected ? <div className="as-body"><div className="as-receipt-head"><div><span>Target</span><strong>{selected.target || "none"}</strong></div><div><span>Risk</span><strong>{selected.risk || "unknown"}</strong></div><div><span>Device</span><strong>{selected.deviceId || "unknown"}</strong></div><div><span>Recorded</span><strong>{when(selected.createdAt)}</strong></div></div>{selected.input ? <div className="as-section"><span>Input fingerprint / request</span><pre>{safeText(selected.input, 500)}</pre></div> : null}<div className="as-section"><span>Execution plan</span><ol>{(selected.plan || []).map((step: string, index: number) => <li key={index}>{step}</li>)}{!selected.plan?.length ? <li>No multi-step plan was required.</li> : null}</ol></div><div className="as-section"><span>Result</span><pre>{safeText(selected.result, 1400)}</pre></div><div className="as-section"><span>Verification evidence</span><ul className="as-checks">{(selected.verification || []).map((item: string, index: number) => <li key={index}>{item}</li>)}{!selected.verification?.length ? <li>No verification evidence recorded.</li> : null}</ul></div><div className="as-actions"><button onClick={() => jarvis(`Explain receipt ${selected.id}: what action ran, its risk, whether the result is truly verified, and any unresolved concern.`)}>Ask Jarvis</button><button onClick={() => download(`jarvis-receipt-${selected.id}.json`, selected)}>Download receipt</button></div></div> : <div className="as-empty">Select a receipt.</div>}</section></div>
  </div>;
}
