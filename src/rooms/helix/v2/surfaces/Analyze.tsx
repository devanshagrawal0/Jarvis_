// Analyze / Decide surface (H7). Pixel target: ref_05. Assertion-linked answer,
// operational indicators (REPLACES the orb + Helix Score), decision composer +
// integrity check. Confidence is ordinal (§14 Q7); decisions block on unsupported
// dependencies with a solo override (§14 Q1).
import React, { useState } from "react";
import { Ico } from "../hxIcons";
import { useDrawer } from "../Drawer";
import { useUI } from "../HxUI";
import { Donut, Radar } from "../hxCharts";
import { ConfBar } from "../hxViz";
import { IndicatorStrip } from "../HxWidgets";

const ASSERTS: { k: string; t: string; conf: "high" | "med"; sup: number; con: number }[] = [
  { k: "A1", t: "K-shifts outperforms baseline in liquid markets", conf: "high", sup: 12, con: 1 },
  { k: "A2", t: "Market impact is manageable with optimal execution", conf: "high", sup: 9, con: 1 },
  { k: "A3", t: "Data quality is sufficient for initial rollout", conf: "med", sup: 6, con: 0 },
  { k: "A4", t: "Risk limits effectively cap downside", conf: "high", sup: 11, con: 0 },
  { k: "A5", t: "Infrastructure can handle projected load", conf: "med", sup: 4, con: 2 },
  { k: "A6", t: "Rollout in phases reduces operational risk", conf: "high", sup: 10, con: 0 },
  { k: "A7", t: "Expected returns justify implementation cost", conf: "med", sup: 5, con: 1 },
];
const INDICATORS = [
  { k: "Question coverage", v: "18 / 23", sub: "78% answered", act: "5 open", tone: "plan", delta: 4, invert: false },
  { k: "Citation completeness", v: "86%", sub: "40 / 47 cited", act: "1 uncited", tone: "review", delta: 2, invert: false },
  { k: "Open contradictions", v: "6", sub: "across 4 assertions", act: "Review", tone: "review", delta: 1, invert: true },
  { k: "Stale claims", v: "8", sub: "older than 30 days", act: "Review", tone: "review", delta: 3, invert: true },
  { k: "Unsupported decision deps", v: "4", sub: "blocking decision", act: "Investigate", tone: "invest", delta: -1, invert: true },
  { k: "Open research questions", v: "7", sub: "require investigation", act: "Plan", tone: "plan", delta: 2, invert: true },
];
const SUMMARY = [
  ["Confidence", "High", "high"], ["Evidence coverage", "Strong", "high"],
  ["Most supported", "A1, A4, A6", ""], ["Weakest", "A3, A5, A7", ""], ["Top risks", "Data quality, Infra", ""],
];
const SNAP = [["Total evidence", "47", ""], ["Supporting", "36", "g"], ["Contradicting", "6", "r"], ["Neutral", "5", ""]];
const INTEGRITY: { tone: "block" | "warn" | "pass"; t: string }[] = [
  { tone: "block", t: "A5: Infrastructure capacity estimates conflict — contradicting evidence unresolved" },
  { tone: "block", t: "Position limits not stress-tested — required results missing" },
  { tone: "warn", t: "A3: Data quality threshold not cited — add citation" },
  { tone: "pass", t: "Owner assigned · alternatives recorded · risks explicit" },
];

export function Analyze({ projectId }: { projectId?: string } = {}) {
  const { open } = useDrawer();
  const { toast } = useUI();
  const [sel, setSel] = useState("A1");
  const [rerunning, setRerunning] = useState(false);
  const reRun = () => { if (rerunning) return; setRerunning(true); toast("Re-running analysis over current evidence…"); setTimeout(() => { setRerunning(false); toast("Analysis refreshed — 7 assertions, 86% cited", "good"); }, 1500); };
  const [stmt, setStmt] = useState("Approve phased rollout of the k-shifts trading algorithm (3 pilot markets)");
  const [decMsg, setDecMsg] = useState("");
  const [decBusy, setDecBusy] = useState(false);

  const recordDecision = async (override: boolean) => {
    if (!projectId) { setDecMsg("Pick a project first."); return; }
    setDecBusy(true); setDecMsg("");
    try {
      const r = await fetch("/api/helix/decision/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: "Rollout decision", statement: stmt, override, overrideReason: override ? "accepted risk after review" : "" }),
      });
      const d = await r.json();
      if (r.ok) setDecMsg(d.integrity?.blockers && !override ? `Blocked — ${d.integrity.note}. Override to proceed.` : `Decision recorded (${(d.decisionId || "").slice(0, 8)})${override ? " · override stamped" : ""}.`);
      else setDecMsg(d.error || "Failed");
    } catch (e: any) { setDecMsg(e?.message || "Network error"); }
    finally { setDecBusy(false); setTimeout(() => setDecMsg(""), 6000); }
  };
  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div>
          <div className="hxv-h1">Analyze &amp; Decide</div>
          <div className="hxv-h1-sub">What the evidence means, and what we commit to. <span className="hxv-demo-badge" title="The assertions & indicators shown are sample scaffolding; the decision composer below records REAL decisions with a live server-side integrity check.">sample analysis · real decisions</span></div>
        </div>
        <button className="hxv-btn" onClick={reRun} disabled={rerunning}><Ico.spark /> {rerunning ? "Re-running…" : "Re-run analysis"}</button>
      </div>

      {/* Synthesized answer + assertions */}
      <div className="hxv-an">
        <div className="hxv-ans">
          <div className="hxv-ans-p">
            <span className="hxv-badge high" style={{ marginRight: 8 }}>High confidence</span>
            Implement a phased rollout of a k-shifts trading algorithm starting with liquid, high-volume pairs and
            tight risk guardrails. This optimizes for signal quality, operational safety, and measurable learning
            while controlling market impact and model risk.
          </div>
          <div className="hxv-panel-h" style={{ border: "none" }}><span className="hxv-u">Key assertions · click to trace</span><span className="hxv-link" onClick={() => toast("Argument map opens in the detail drawer — click any assertion to trace it")}>View argument map</span></div>
          {ASSERTS.map(a => (
            <div className={"hxv-assert" + (sel === a.k ? " on" : "")} key={a.k} onClick={() => { setSel(a.k); open({
              type: "Assertion · " + a.k,
              title: a.t,
              support: { label: a.con ? `${a.sup} support · ${a.con} contradict` : `${a.sup} support`, tone: a.con ? "con" : "sup" },
              confidence: { label: a.conf === "high" ? "Strong" : "Moderate",
                inputs: [["Supporting evidence", String(a.sup)], ["Contradicting", String(a.con)], ["Evidence coverage", a.conf === "high" ? "Strong" : "Partial"]] },
              lineage: ["Derived from evidence set", `${a.sup} supporting items`, a.con ? `${a.con} contradicting item(s)` : "No contradictions", "Feeds the synthesized answer"],
              audit: [["Assertion", a.k], ["Support", `${a.sup} / ${a.con}`], ["Confidence", a.conf === "high" ? "Strong" : "Moderate"]],
            }); }}>
              <span className="hxv-akey">{a.k}</span>
              <span className="hxv-atext">{a.t}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 5, justifySelf: "start", alignItems: "flex-start" }} onClick={e => e.stopPropagation()}>
                <span className={"hxv-badge " + a.conf}>{a.conf === "high" ? "High" : "Medium"}</span>
                <ConfBar value={a.con === 0 ? (a.conf === "high" ? 0.86 : 0.7) : Math.max(0.32, (a.sup / (a.sup + a.con)) * (a.conf === "high" ? 1 : 0.9))}
                  band={(() => { const cv = a.con === 0 ? (a.conf === "high" ? 0.86 : 0.7) : Math.max(0.32, (a.sup / (a.sup + a.con)) * (a.conf === "high" ? 1 : 0.9)); return [cv - 0.06, cv + 0.06]; })()}
                  width={88} showValue={false} />
              </span>
              <span className={"hxv-sup-n g"}>{a.sup} support</span>
              <span className={"hxv-sup-n " + (a.con ? "r" : "z")}>{a.con} contradict</span>
            </div>
          ))}
        </div>

        {/* Middle column: operational measures + key trade-offs (ref_05 §1) */}
        <div>
          {[["Net edge (bps)", "12 – 28", "Estimated range"], ["Feasibility", "Medium", "5/6 coverage areas"], ["Data sufficiency", "Good", "Backtest-ready"], ["Implementation risk", "Moderate", "Latency · limits"]].map(([k, v, s]) => (
            <div className="hxv-measure" key={k}><div className="hxv-measure-k">{k}</div><div className="hxv-measure-v">{v}</div><div className="hxv-measure-s">{s}</div></div>
          ))}
          <div className="hxv-side-card">
            <div className="hxv-u" style={{ marginBottom: 10 }}>Key trade-offs</div>
            {[["Latency", "Coverage", 0.35], ["Complexity", "Robustness", 0.6], ["Speed", "Scale", 0.72]].map(([l, r, v]) => (
              <div className="hxv-trade" key={l as string}>
                <div className="hxv-trade-lbl"><span>{l}</span><span>{r}</span></div>
                <div className="hxv-trade-track"><i style={{ left: `${(v as number) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="hxv-side-card">
            <div className="hxv-u" style={{ marginBottom: 8 }}>Answer summary</div>
            {SUMMARY.map(([k, v, tone]) => (
              <div className="hxv-sc-row" key={k}><span className="hxv-sc-k">{k}</span>
                <span className={"hxv-sc-v " + (tone ? "hxv-val-good" : "")}>{v}</span></div>
            ))}
          </div>
          <div className="hxv-side-card">
            <div className="hxv-u" style={{ marginBottom: 8 }}>Evidence snapshot</div>
            {SNAP.map(([k, v, tone]) => (
              <div className="hxv-sc-row" key={k}><span className="hxv-sc-k">{k}</span>
                <span className={"hxv-sc-v " + (tone === "g" ? "hxv-val-good" : tone === "r" ? "hxv-val-bad" : "")}>{v}</span></div>
            ))}
            <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
              <Donut value={0.86} size={92} color="var(--v-good)" sub="Cited" />
            </div>
          </div>
          <div className="hxv-side-card">
            <div className="hxv-u" style={{ marginBottom: 4 }}>Support by dimension</div>
            <Radar size={210} axes={["Perf", "Risk", "Data", "Infra", "Cost", "Ops"]}
              series={[{ name: "support", color: "var(--v-accent)", values: [0.9, 0.85, 0.5, 0.45, 0.6, 0.7] }]} />
          </div>
        </div>
      </div>

      {/* Operational indicators — a scannable quant watchlist (Feature #17) */}
      <IndicatorStrip title="Operational indicators · watchlist" items={INDICATORS.map(i => ({
        k: i.k, v: i.v, sub: i.sub, delta: i.delta, invert: i.invert,
        status: (i.tone === "invest" ? "bad" : i.tone === "review" ? "warn" : "good") as "good" | "warn" | "bad",
        up: i.tone === "plan",
        onClick: () => open({
          type: "Operational indicator", title: i.k,
          support: { label: i.sub, tone: (i.tone === "review" || i.tone === "invest") ? "con" : "sup" },
          confidence: { label: i.v, inputs: [["Current value", i.v], ["Detail", i.sub], ["Suggested action", i.act]] },
          lineage: ["Computed from the current evidence + assertion set", i.sub, `Recommended next step: ${i.act}`],
          audit: [["Indicator", i.k], ["Value", i.v], ["Action", i.act]],
        }),
      }))} />

      {/* Decision composer + integrity */}
      <div className="hxv-u" style={{ marginBottom: 10 }}>Decision</div>
      <div className="hxv-dec">
        <div className="hxv-panel" style={{ padding: 16 }}>
          <div className="hxv-dec-field">
            <label>Decision statement</label>
            <input className="hxv-dec-input" value={stmt} onChange={e => setStmt(e.target.value)} />
          </div>
          <div className="hxv-dec-field" style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}><label>Owner</label><input className="hxv-dec-input" defaultValue="Dev Analyst" /></div>
            <div style={{ flex: 1 }}><label>Review date</label><input className="hxv-dec-input" defaultValue="2026-08-01" /></div>
          </div>
          {decMsg && <div className={"hxv-integrity " + (decMsg.startsWith("Blocked") ? "block" : decMsg.includes("recorded") ? "pass" : "warn")} style={{ marginTop: 4 }}><span>{decMsg.startsWith("Blocked") ? "⛔" : decMsg.includes("recorded") ? "✓" : "⚠"}</span><span>{decMsg}</span></div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="hxv-btn ghost" onClick={() => recordDecision(false)} disabled={decBusy}>Record decision</button>
            <button className="hxv-btn" onClick={() => recordDecision(true)} disabled={decBusy}>Override &amp; approve</button>
          </div>
        </div>
        <div className="hxv-side-card">
          <div className="hxv-u" style={{ marginBottom: 10 }}>Integrity check</div>
          {INTEGRITY.map((c, i) => (
            <div className={"hxv-integrity " + c.tone} key={i}>
              <span>{c.tone === "block" ? "⛔" : c.tone === "warn" ? "⚠" : "✓"}</span>
              <span>{c.t}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "var(--v-text3)", marginTop: 10 }}>2 blockers must resolve, or override with a stamped reason.</div>
        </div>
      </div>
    </div>
  );
}
