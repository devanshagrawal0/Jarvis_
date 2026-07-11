import React, { useEffect, useState } from "react";
import { PatternScan, PatternItem, ConvergenceItem, PatternContradiction, BlindSpot } from "./helix-types";

interface Props {
  projectId: string;
  entryCount: number;
  onClose: () => void;
}

const STRENGTH_COLOR: Record<string, string> = {
  high: "#4aff9e",
  medium: "#ffe14a",
  low: "#ff9e4a",
};

function PatternCard({ p }: { p: PatternItem }) {
  return (
    <div className="ipp-card ipp-card--pattern">
      <div className="ipp-card-hdr">
        <span className="ipp-card-icon">◈</span>
        <span className="ipp-card-title">{p.title}</span>
        <span className="ipp-card-badge">{p.entry_count} entries</span>
      </div>
      <p className="ipp-card-desc">{p.description}</p>
      <div className="ipp-card-sig">
        <span className="ipp-card-sig-lbl">WHY THIS MATTERS</span>
        <span className="ipp-card-sig-text">{p.significance}</span>
      </div>
    </div>
  );
}

function ConvergenceCard({ c }: { c: ConvergenceItem }) {
  return (
    <div className="ipp-card ipp-card--convergence" style={{ "--conv-color": STRENGTH_COLOR[c.strength] } as React.CSSProperties}>
      <div className="ipp-card-hdr">
        <span className="ipp-conv-strength" style={{ color: STRENGTH_COLOR[c.strength] }}>{c.strength.toUpperCase()}</span>
        <span className="ipp-card-title">{c.claim}</span>
      </div>
      <div className="ipp-card-impl">
        <span className="ipp-card-sig-lbl">IMPLICATION</span>
        <span className="ipp-card-sig-text">{c.implication}</span>
      </div>
    </div>
  );
}

function ContradictionCard({ c }: { c: PatternContradiction }) {
  return (
    <div className="ipp-card ipp-card--contradiction">
      <div className="ipp-card-hdr">
        <span className="ipp-card-icon" style={{ color: "#ff6b6b" }}>⚡</span>
        <span className="ipp-card-title">{c.tension}</span>
      </div>
      <div className="ipp-contr-entries">
        {c.entries.map((e, i) => (
          <div key={i} className="ipp-contr-entry">
            <span className="ipp-contr-dot" style={{ background: i === 0 ? "#4a9eff" : "#ff6b6b" }} />
            <span>{e}</span>
          </div>
        ))}
      </div>
      <div className="ipp-card-sig">
        <span className="ipp-card-sig-lbl">HOW TO RESOLVE</span>
        <span className="ipp-card-sig-text">{c.resolution}</span>
      </div>
    </div>
  );
}

function BlindSpotCard({ b }: { b: BlindSpot }) {
  return (
    <div className="ipp-card ipp-card--blindspot">
      <div className="ipp-card-hdr">
        <span className="ipp-card-icon" style={{ color: "#ffe14a" }}>○</span>
        <span className="ipp-card-title">{b.area}</span>
      </div>
      <p className="ipp-card-desc">{b.why_it_matters}</p>
      <div className="ipp-card-sig">
        <span className="ipp-card-sig-lbl">SUGGESTED ACTION</span>
        <span className="ipp-card-sig-text">{b.suggested_action}</span>
      </div>
    </div>
  );
}

const TABS = ["Pulse", "Patterns", "Convergences", "Contradictions", "Blind Spots"] as const;
type Tab = typeof TABS[number];

export function IntelPatternsPanel({ projectId, entryCount, onClose }: Props) {
  const [scan, setScan] = useState<PatternScan | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Pulse");

  useEffect(() => {
    loadCached();
  }, [projectId]);

  async function loadCached() {
    setLoading(true);
    try {
      const r = await fetch(`/api/helix/patterns?projectId=${encodeURIComponent(projectId)}`);
      const d = await r.json();
      if (d.scan) setScan(d.scan);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function runScan() {
    setScanning(true);
    setError(null);
    try {
      const r = await fetch("/api/helix/patterns/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const d = await r.json();
      if (d.scan) { setScan(d.scan); setActiveTab("Pulse"); }
      else setError(d.error || "Scan failed");
    } catch { setError("Network error"); }
    finally { setScanning(false); }
  }

  const tabCounts: Record<Tab, number> = {
    "Pulse": 0,
    "Patterns": scan?.patterns.length ?? 0,
    "Convergences": scan?.convergences.length ?? 0,
    "Contradictions": scan?.contradictions.length ?? 0,
    "Blind Spots": scan?.blind_spots.length ?? 0,
  };

  return (
    <div className="ipp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ipp-panel">
        {/* Header */}
        <div className="ipp-header">
          <div className="ipp-header-left">
            <span className="ipp-eyebrow">◈ SIGNAL PATTERNS</span>
            <div className="ipp-header-sub">{entryCount} entries scanned · cross-project intelligence</div>
          </div>
          <div className="ipp-header-actions">
            <button
              className="ipp-scan-btn"
              onClick={runScan}
              disabled={scanning || entryCount < 2}
              title={entryCount < 2 ? "Add at least 2 entries to scan" : "Scan all entries for patterns"}
            >
              {scanning ? <><span className="hx-spin" /> Scanning…</> : "↺ Run Scan"}
            </button>
            <button className="ipp-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="ipp-tabs">
          {TABS.map(t => (
            <button
              key={t}
              className={`ipp-tab${activeTab === t ? " active" : ""}${!scan && t !== "Pulse" ? " ipp-tab--dim" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
              {tabCounts[t] > 0 && <span className="ipp-tab-badge">{tabCounts[t]}</span>}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="ipp-content">
          {loading && (
            <div className="ipp-loading">
              <div className="dbp-loading-ring" />
              <div className="ipp-loading-label">Loading last scan…</div>
            </div>
          )}

          {!loading && !scan && (
            <div className="ipp-empty">
              <div className="ipp-empty-icon">◈</div>
              <div className="ipp-empty-title">No scan yet</div>
              <div className="ipp-empty-sub">
                Run a pattern scan to surface cross-cutting themes, convergent signals,
                contradictions between entries, and research blind spots across your project.
              </div>
              <button
                className="ipp-scan-btn ipp-scan-btn--big"
                onClick={runScan}
                disabled={scanning || entryCount < 2}
              >
                {scanning ? "Scanning…" : "Run First Scan"}
              </button>
              {entryCount < 2 && <div className="ipp-empty-hint">Add at least 2 entries to enable pattern scanning.</div>}
            </div>
          )}

          {error && (
            <div className="ipp-error">
              <span className="ipp-error-icon">⚠</span>
              <span>{error}</span>
              <button className="ipp-error-retry" onClick={runScan}>Retry</button>
            </div>
          )}

          {scan && !loading && (
            <>
              {activeTab === "Pulse" && (
                <div className="ipp-pulse">
                  <div className="ipp-pulse-hdr">
                    <span className="ipp-pulse-eyebrow">Project Pulse</span>
                    {scan.created_at && (
                      <span className="ipp-pulse-ts">{new Date(scan.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {scan.entry_count} entries</span>
                    )}
                  </div>
                  <div className="ipp-pulse-body">{scan.summary}</div>
                  <div className="ipp-pulse-stats">
                    <div className="ipp-pulse-stat">
                      <span className="ipp-pulse-stat-val">{scan.patterns.length}</span>
                      <span className="ipp-pulse-stat-lbl">Patterns</span>
                    </div>
                    <div className="ipp-pulse-stat">
                      <span className="ipp-pulse-stat-val" style={{ color: "#4aff9e" }}>{scan.convergences.length}</span>
                      <span className="ipp-pulse-stat-lbl">Convergences</span>
                    </div>
                    <div className="ipp-pulse-stat">
                      <span className="ipp-pulse-stat-val" style={{ color: "#ff6b6b" }}>{scan.contradictions.length}</span>
                      <span className="ipp-pulse-stat-lbl">Tensions</span>
                    </div>
                    <div className="ipp-pulse-stat">
                      <span className="ipp-pulse-stat-val" style={{ color: "#ffe14a" }}>{scan.blind_spots.length}</span>
                      <span className="ipp-pulse-stat-lbl">Blind Spots</span>
                    </div>
                  </div>
                </div>
              )}
              {activeTab === "Patterns" && (
                <div className="ipp-list">
                  {scan.patterns.length === 0
                    ? <div className="ipp-list-empty">No recurring patterns found across entries.</div>
                    : scan.patterns.map((p, i) => <PatternCard key={i} p={p} />)
                  }
                </div>
              )}
              {activeTab === "Convergences" && (
                <div className="ipp-list">
                  {scan.convergences.length === 0
                    ? <div className="ipp-list-empty">No strong convergences found yet.</div>
                    : scan.convergences.map((c, i) => <ConvergenceCard key={i} c={c} />)
                  }
                </div>
              )}
              {activeTab === "Contradictions" && (
                <div className="ipp-list">
                  {scan.contradictions.length === 0
                    ? <div className="ipp-list-empty">No inter-entry contradictions found.</div>
                    : scan.contradictions.map((c, i) => <ContradictionCard key={i} c={c} />)
                  }
                </div>
              )}
              {activeTab === "Blind Spots" && (
                <div className="ipp-list">
                  {scan.blind_spots.length === 0
                    ? <div className="ipp-list-empty">No significant blind spots identified.</div>
                    : scan.blind_spots.map((b, i) => <BlindSpotCard key={i} b={b} />)
                  }
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
