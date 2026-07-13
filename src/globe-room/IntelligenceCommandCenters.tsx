import { useMemo, useState } from "react";
import { api } from "../api";
import "./IntelligenceCommandCenters.css";

type GraphProps = { data: any; loading: boolean };

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sendToJarvis(text: string) {
  document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text, files: [] } }));
}

export function GraphCommandCenter({ data, loading }: GraphProps) {
  const [query, setQuery] = useState("");
  const stats = data?.stats || {};
  const summary = data?.summary || {};
  const entities: any[] = Array.isArray(data?.entities) ? data.entities : [];
  const buckets = Object.entries(data?.buckets || {}) as [string, any[]][];
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return entities.filter((item) => !term || String(item?.name || "").toLowerCase().includes(term)).slice(0, 48);
  }, [entities, query]);
  const maxCount = Math.max(1, ...filtered.map((item) => Number(item?.count || 0)));

  return (
    <div className="intel-center graph-center">
      <section className="intel-hero">
        <div><span className="intel-kicker">PERSONAL REALITY GRAPH</span><h2>{Number(stats.active || 0).toLocaleString()} active memories</h2><p>Live semantic map of projects, facts, routines, people, and recurring entities Jarvis can retrieve.</p></div>
        <div className="intel-orbit" aria-hidden="true"><i /><i /><i /><b>J</b></div>
      </section>

      <div className="intel-metrics">
        {[['Episodic', stats.episodic, 'moments'], ['Semantic', stats.semantic, 'knowledge'], ['Procedural', stats.procedural, 'routines'], ['Entities', entities.length, 'indexed']].map(([label, value, caption]) => (
          <article key={String(label)}><span>{label}</span><strong>{loading ? '—' : Number(value || 0).toLocaleString()}</strong><small>{caption}</small></article>
        ))}
      </div>

      <div className="intel-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter graph entities…" aria-label="Filter graph entities" />
        <button onClick={() => sendToJarvis("Inspect my Personal Reality Graph and summarize the most important current projects, routines, facts, and gaps.")}>Ask Jarvis</button>
        <button onClick={() => downloadJson(`jarvis-life-graph-${new Date().toISOString().slice(0, 10)}.json`, data)}>Export graph</button>
      </div>

      <div className="intel-split">
        <section className="intel-panel">
          <header><strong>Entity field</strong><span>{filtered.length} visible</span></header>
          <div className="entity-field">
            {filtered.length ? filtered.map((item, index) => (
              <button key={`${item.type}-${item.name}-${index}`} className="entity-node" style={{ '--weight': Math.max(.18, Number(item.count || 0) / maxCount) } as React.CSSProperties} onClick={() => setQuery(String(item.name || ''))}>
                <span>{item.name || 'Untitled'}</span><small>{item.type || 'entity'} · {item.count || 0}</small>
              </button>
            )) : <div className="intel-empty">No graph entities match this filter.</div>}
          </div>
        </section>

        <section className="intel-panel graph-buckets">
          <header><strong>Memory domains</strong><span>{buckets.length} layers</span></header>
          {buckets.map(([name, items]) => {
            const count = Array.isArray(items) ? items.length : Number(items || 0);
            const total = Math.max(1, ...buckets.map(([, value]) => Array.isArray(value) ? value.length : Number(value || 0)));
            return <button key={name} onClick={() => sendToJarvis(`Tell me what you know in my ${name} memory domain and cite the relevant memories.`)}><span>{name}</span><i><b style={{ width: `${Math.max(4, count / total * 100)}%` }} /></i><strong>{count || Number(summary[name] || 0)}</strong></button>;
          })}
          <div className="intel-note"><span>Source</span><code>{stats.dbPath || 'Neural Vault'}</code></div>
        </section>
      </div>
    </div>
  );
}

export function VisionCommandCenter({ data, loading, onRefresh }: { data: any; loading: boolean; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [captureUrl, setCaptureUrl] = useState(String(data?.frameUrl || data?.capture?.url || ""));
  const mesh = data?.mesh || {};
  const objects: any[] = Array.isArray(mesh.objects) ? mesh.objects : [];
  const visualObjects = objects.filter((item) => ['screen', 'image', 'photo', 'camera'].includes(String(item?.type || '').toLowerCase())).slice(0, 8);

  async function captureScreen() {
    setBusy(true); setMessage("");
    try {
      const result = await api<any>("/api/device-mesh/screen", { method: "POST", body: JSON.stringify({ reason: "Vision Command Center explicit capture" }) });
      setCaptureUrl(`${result?.capture?.url || ''}?t=${Date.now()}`);
      setMessage(`Captured ${result?.capture?.dimensions || 'screen'} and added it to the mesh evidence inbox.`);
      onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return (
    <div className="intel-center vision-center">
      <section className="intel-hero">
        <div><span className="intel-kicker">MULTIMODAL VISION</span><h2>Visual intelligence console</h2><p>Laptop evidence, live mesh frames, phone cameras, and visual reasoning in one permission-aware surface.</p></div>
        <div className="vision-reticle" aria-hidden="true"><i /><b>LIVE</b></div>
      </section>
      <div className="intel-metrics">
        <article><span>Screen relay</span><strong>{mesh?.liveScreen?.active ? 'Live' : 'Standby'}</strong><small>{mesh?.liveScreen?.frameCount || 0} frames</small></article>
        <article><span>Visual objects</span><strong>{visualObjects.length}</strong><small>mesh evidence</small></article>
        <article><span>Control baton</span><strong>{mesh?.controlBaton?.state || 'idle'}</strong><small>permission gated</small></article>
        <article><span>Vision model</span><strong>{data?.visionModel || 'Gemini'}</strong><small>multimodal</small></article>
      </div>
      <div className="vision-grid">
        <section className="intel-panel vision-preview">
          <header><strong>Latest visual evidence</strong><span>{captureUrl ? 'ready' : 'no capture'}</span></header>
          <div className="vision-canvas">{captureUrl ? <img src={captureUrl} alt="Latest laptop screen capture" /> : <div className="vision-placeholder"><span>◎</span><strong>No visual evidence selected</strong><small>Capture only runs after your explicit click.</small></div>}<div className="vision-corners" /></div>
          <div className="vision-actions">
            <button disabled={busy} onClick={() => void captureScreen()}>{busy ? 'Capturing…' : 'Capture laptop'}</button>
            <button onClick={() => sendToJarvis("Inspect the latest laptop screen capture and explain what is visible, what matters, and the safest next actions.")}>Analyze with Jarvis</button>
            <button onClick={() => sendToJarvis("Analyze the latest phone camera frame in detail and extract useful text, objects, risks, and next actions.")}>Analyze phone</button>
          </div>
          {message && <p className="vision-message">{message}</p>}
        </section>
        <section className="intel-panel evidence-panel">
          <header><strong>Evidence queue</strong><span>{visualObjects.length} recent</span></header>
          <div className="evidence-list">
            {loading ? <div className="intel-empty">Synchronizing visual sources…</div> : visualObjects.length ? visualObjects.map((item) => <button key={item.id || item.name} onClick={() => item.url && setCaptureUrl(item.url)}><span>{item.type || 'image'}</span><strong>{item.name || item.summary || 'Visual object'}</strong><small>{item.sourceDeviceName || item.sourceDeviceId || 'Device Mesh'}</small></button>) : <div className="intel-empty">No screen or camera objects are in the recent mesh window.</div>}
          </div>
          <div className="intel-note"><span>Privacy</span><p>Camera and screen capture remain explicit. Analysis is only requested when you choose it.</p></div>
        </section>
      </div>
    </div>
  );
}
