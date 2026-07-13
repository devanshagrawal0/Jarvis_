// Command Center (upgrade #3). Pixel target: ref_10 §6 — the DNA-spine hero.
// The five-stage spine rendered as a living double-helix with live counts per stage,
// stat tiles, smart insights, and an observability rail.
import React from "react";
import { Ico, Spark } from "../hxIcons";
import { useUI } from "../HxUI";
import { Donut, Trend } from "../hxCharts";
import { MiniBars } from "../hxViz";

const TILES = [
  { v: "12", k: "Active Questions", d: "+2 this week", tone: "good", nav: "ask" },
  { v: "78%", k: "Evidence Health", d: "+6% vs last week", tone: "good", nav: "evidence" },
  { v: "7", k: "Active Decisions", d: "+1 today", tone: "", nav: "analyze" },
  { v: "5", k: "Build Queue", d: "2 running · 3 pending", tone: "", nav: "build" },
  { v: "Healthy", k: "System Status", d: "All systems operational", tone: "good", nav: "observability" },
];
const STAGES = [
  { lbl: "Question", v: "12", k: "Active", color: "#3f8cff", nav: "ask" },
  { lbl: "Evidence", v: "216", k: "Sources", color: "#34cfe0", nav: "evidence" },
  { lbl: "Analysis", v: "42", k: "Claims", color: "#33d69a", nav: "analyze" },
  { lbl: "Decision", v: "18", k: "Decisions", color: "#f2b03d", nav: "analyze" },
  { lbl: "Artifact", v: "26", k: "Artifacts", color: "#9b6cff", nav: "build" },
];
const INSIGHTS = [
  { t: "3 contradictions need your review", s: "High impact on 2 decisions", ico: "analyze" as const, nav: "analyze" },
  { t: "Evidence coverage improved +12% this week", s: "Market & Alpha now well-covered", ico: "spark" as const, nav: "evidence" },
  { t: "Pilot decision confidence increased", s: "From 65% to 78% after new sources", ico: "decide" as const, nav: "analyze" },
  { t: "2 sources are stale", s: "Consider refreshing before next build", ico: "clock" as const, nav: "evidence" },
];
const OBS = [
  ["System Reliability", "99.9%", "good"], ["Model Performance", "94%", "good"],
  ["Data Ingestion", "1.2k/min", ""], ["Storage Used", "2.4 TB", ""],
];
const WATCH = [["Kalshi BTC-USD", 3.2], ["ETH-USD Spot", 2.14], ["VIX Index", -1.33], ["10Y Treasury", 0.08]] as const;

// A double-helix built from two offset sine waves with 5 stage nodes.
function HelixSpine({ onNode }: { onNode?: (nav: string, lbl: string) => void }) {
  const W = 900, H = 150, mid = H / 2, amp = 34, turns = 2.4;
  const wave = (phase: number) => {
    let d = "";
    for (let x = 0; x <= W; x += 6) {
      const y = mid + Math.sin((x / W) * Math.PI * 2 * turns + phase) * amp;
      d += (x === 0 ? "M" : "L") + x + " " + y.toFixed(1) + " ";
    }
    return d;
  };
  const nodeX = (i: number) => 70 + (i * (W - 140)) / 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="hx1" x1="0" x2="1"><stop offset="0" stopColor="#3f8cff" /><stop offset="1" stopColor="#9b6cff" /></linearGradient>
        <linearGradient id="hx2" x1="0" x2="1"><stop offset="0" stopColor="#34cfe0" /><stop offset="1" stopColor="#33d69a" /></linearGradient>
      </defs>
      {/* cross-links */}
      {Array.from({ length: 30 }).map((_, i) => {
        const x = (i * W) / 30;
        const y1 = mid + Math.sin((x / W) * Math.PI * 2 * turns) * amp;
        const y2 = mid + Math.sin((x / W) * Math.PI * 2 * turns + Math.PI) * amp;
        return <line key={i} x1={x} y1={y1} x2={x} y2={y2} stroke="rgba(120,160,220,0.10)" strokeWidth="1" />;
      })}
      <path d={wave(0)} fill="none" stroke="url(#hx1)" strokeWidth="2" opacity="0.85" />
      <path d={wave(Math.PI)} fill="none" stroke="url(#hx2)" strokeWidth="2" opacity="0.85" />
      {STAGES.map((s, i) => {
        const x = nodeX(i);
        return (
          <g key={s.lbl} onClick={() => onNode?.(s.nav, s.lbl)} style={{ cursor: "pointer" }}>
            <title>{`Open ${s.lbl}`}</title>
            <circle cx={x} cy={mid} r="26" fill="transparent" />
            <circle cx={x} cy={mid} r="22" fill="rgba(6,9,17,0.9)" stroke={s.color} strokeWidth="2" />
            <circle cx={x} cy={mid} r="22" fill="none" stroke={s.color} strokeWidth="6" opacity="0.15" />
            <text x={x} y={mid - 2} fontSize="15" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="var(--v-mono)">{s.v}</text>
            <text x={x} y={mid + 10} fontSize="7.5" fill={s.color} textAnchor="middle" style={{ textTransform: "uppercase", letterSpacing: "1px" }}>{s.k}</text>
            <text x={x} y={mid + 44} fontSize="10" fill="var(--v-text2)" textAnchor="middle" style={{ textTransform: "uppercase", letterSpacing: "1.5px" }}>{s.lbl}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function CommandCenter({ onNav }: { onNav?: (s: string) => void } = {}) {
  const { toast } = useUI();
  const go = (nav: string, label: string) => { toast(`Opening ${label}`); onNav?.(nav); };
  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div>
          <div className="hxv-h1">Command Center</div>
          <div className="hxv-h1-sub">The whole research pipeline at a glance.</div>
        </div>
      </div>

      <div className="hxv-cc-tiles">
        {TILES.map(t => (
          <div className="hxv-cc-tile" key={t.k} onClick={() => go(t.nav, t.k)} style={{ cursor: "pointer" }}>
            <div className="hxv-cc-tile-top">
              <div className={"hxv-cc-tile-v " + (t.tone ? "hxv-val-" + t.tone : "")}>{t.v}</div>
              <span className="hxv-cc-tile-spark"><Spark seed={"cc" + t.k} up={t.tone === "good"} color={t.tone === "good" ? "#33c2d1" : "#8f7fe0"} w={78} h={26} /></span>
            </div>
            <div className="hxv-cc-tile-k">{t.k}</div>
            <div className={"hxv-cc-tile-d " + (t.tone ? "hxv-val-" + t.tone : "")} style={{ color: t.tone ? undefined : "var(--v-text3)" }}>{t.d}</div>
          </div>
        ))}
      </div>

      <div className="hxv-helix"><HelixSpine onNode={go} /></div>

      <div className="hxv-cc-cols">
        <div>
          <div className="hxv-u" style={{ marginBottom: 10 }}>Smart insights</div>
          {INSIGHTS.map(i => { const IconC = Ico[i.ico]; return (
            <div className="hxv-insight" key={i.t} onClick={() => go(i.nav, i.t.length > 32 ? "the related evidence" : i.t)} style={{ cursor: "pointer" }}>
              <span className="hxv-insight-ic"><IconC /></span>
              <div><div className="hxv-insight-t">{i.t}</div><div className="hxv-insight-s">{i.s}</div></div>
            </div>
          ); })}
        </div>
        <div>
          <div className="hxv-side-card">
            <div className="hxv-u" style={{ marginBottom: 8 }}>Observability</div>
            {OBS.map(([k, v, tone]) => (
              <div className="hxv-sc-row" key={k}><span className="hxv-sc-k">{k}</span>
                <span className={"hxv-sc-v " + (tone ? "hxv-val-" + tone : "")}>{v}</span></div>
            ))}
            <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
              <Donut value={0.86} size={96} color="var(--v-good)" sub="Health" />
            </div>
          </div>
          <div className="hxv-side-card">
            <div className="hxv-u" style={{ marginBottom: 8 }}>Watchlist</div>
            {WATCH.map(([k, v]) => (
              <div className="hxv-sc-row" key={k}><span className="hxv-sc-k">{k}</span><Trend value={v} /></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
