import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

// ═══════════════════════════════════════════════════════════════════════════
// ARBITER — prediction-market edge-intelligence room
//
// Three views:
//   • Timeline  (main / landing) — general convergence + catalyst timeline
//   • Edges     — ranked opportunity feed (master) + selected detail
//   • (card)    — the repeating opportunity unit, used inside Edges
//
// Currently backed by MOCK data (see MOCK_EDGES / MOCK_CATALYSTS below) so the
// room renders before the Arbiter backend exists. Swap those for live
// /api/arbiter/* calls in Phase 1 wiring.
// ═══════════════════════════════════════════════════════════════════════════

// ── Design tokens (JARVIS palette) ──────────────────────────────────────────
const C = {
  bg:          "#020910",
  panel:       "rgba(4,14,24,0.72)",
  panelSolid:  "rgba(2,10,20,0.96)",
  border:      "rgba(0,200,255,0.16)",
  borderHi:    "rgba(0,229,255,0.42)",
  borderFaint: "rgba(0,200,255,0.08)",
  cyan:        "#00e5ff",
  cyanDim:     "rgba(0,229,255,0.65)",
  text:        "rgba(224,247,255,0.92)",
  muted:       "rgba(190,225,255,0.45)",
  yes:         "#20f7a4",
  no:          "#5599ff",
  amber:       "#ffbc60",
  red:         "#ff5b6b",
  font:        "'SF Mono','Fira Code','JetBrains Mono',ui-monospace,monospace",
};

const CONF_COLOR: Record<string, string> = {
  "VERY HIGH": C.yes, HIGH: C.cyan, MODERATE: C.amber, LOW: C.muted,
};

// ── Types ───────────────────────────────────────────────────────────────────
type Category = "sports" | "politics";
type Conf = "VERY HIGH" | "HIGH" | "MODERATE" | "LOW";

interface Edge {
  id: string;
  question: string;
  category: Category;
  kalshi: number;        // left-pill cents (Kalshi price, or JARVIS model prob)
  leftLabel?: string;    // "KALSHI" | "JARVIS" | "VEGAS"
  modelProb?: number | null;
  signals?: string[];
  polymarket: number;    // cents
  vegas?: number | null;        // implied cents from Vegas odds (sports only)
  sentiment?: number | null;    // implied cents from news + social sentiment
  edgeScore: number;
  confidence: Conf;
  fairValue?: number | null;   // JARVIS's own fair-value estimate (%)
  suggestion?: { side: "YES" | "NO"; platform: string; entry: number; action: string; detail: string } | null;
  rationale: string;
  closesIn: string;
  volume: string;
  liquidity: "HIGH" | "MEDIUM" | "LOW";
  kalshiHist: number[];
  polyHist: number[];
  related: string[];
}

interface Catalyst {
  id: string;
  date: string;         // "Jul 30"
  time: string;         // "2:00 PM ET"
  kind: "game" | "vote" | "ruling" | "econ" | "update";
  title: string;
  market: string;
  category: Category;
  marketCount?: number;
  edgeCount?: number;
  impacted?: Array<{ question: string; yes: number; isEdge: boolean; edgeScore?: number | null; action?: string | null }>;
}

// ── Mock data (sports + politics only) ──────────────────────────────────────
function series(start: number, end: number, n = 40, jitter = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = start + (end - start) * t;
    // deterministic pseudo-jitter (no Math.random — stable renders)
    const wob = Math.sin(i * 1.7) * jitter + Math.cos(i * 0.6) * (jitter * 0.5);
    out.push(Math.max(1, Math.min(99, Math.round(base + wob))));
  }
  return out;
}

const MOCK_EDGES: Edge[] = [
  {
    id: "fed-jul25", question: "Fed cuts rates by ≥25bps at July 30 meeting?", category: "politics",
    kalshi: 62, polymarket: 55, edgeScore: 17.4, confidence: "VERY HIGH",
    rationale: "Fed funds futures imply 64% probability; dovish tilt in recent speeches; weak payroll print.",
    closesIn: "19h 05m", volume: "$24.7M", liquidity: "HIGH",
    kalshiHist: series(48, 62), polyHist: series(44, 55),
    related: ["Fed cuts by 50bps?", "Rate cut by Sep?", "2025 rate cuts ≥2?"],
  },
  {
    id: "trump-2024", question: "Trump re-elected President in 2024?", category: "politics",
    kalshi: 68, polymarket: 59, edgeScore: 14.8, confidence: "VERY HIGH",
    rationale: "Polling avg 50.3% vs implied 41%; strong fundraising advantage; ballot access expanding.",
    closesIn: "5d 18h", volume: "$182M", liquidity: "HIGH",
    kalshiHist: series(55, 68), polyHist: series(50, 59),
    related: ["GOP wins Senate?", "Swing state margin?"],
  },
  {
    id: "chiefs-sb", question: "Will the Chiefs win the Super Bowl?", category: "sports",
    kalshi: 24, polymarket: 19, vegas: 27, edgeScore: 12.6, confidence: "HIGH",
    rationale: "Vegas implies 27% vs Polymarket 19%; healthy roster; favorable playoff seeding path.",
    closesIn: "45d 05h", volume: "$9.3M", liquidity: "MEDIUM",
    kalshiHist: series(18, 24), polyHist: series(15, 19),
    related: ["Chiefs make playoffs?", "AFC Champion?"],
  },
  {
    id: "ceasefire", question: "Israel–Hamas ceasefire by June 30?", category: "politics",
    kalshi: 41, polymarket: 33, edgeScore: 9.3, confidence: "HIGH",
    rationale: "Backchannel reports positive; mediators active; public rhetoric softening on both sides.",
    closesIn: "12d 03h", volume: "$14.1M", liquidity: "MEDIUM",
    kalshiHist: series(30, 41), polyHist: series(28, 33),
    related: ["Aid corridor opens?", "Hostage deal?"],
  },
  {
    id: "city-epl", question: "Man City win the Premier League?", category: "sports",
    kalshi: 44, polymarket: 38, vegas: 47, edgeScore: 7.1, confidence: "MODERATE",
    rationale: "Vegas 47% vs Polymarket 38%; goal difference lead; run-in fixtures favorable.",
    closesIn: "72d 05h", volume: "$6.8M", liquidity: "MEDIUM",
    kalshiHist: series(40, 44), polyHist: series(35, 38),
    related: ["City top 4?", "Arsenal win EPL?"],
  },
];

const MOCK_CATALYSTS: Catalyst[] = [
  { id: "c1", date: "Jul 12", time: "8:30 AM ET", kind: "econ", title: "June CPI release", market: "Fed cuts ≥25bps July?", category: "politics" },
  { id: "c2", date: "Jul 15", time: "9:00 PM ET", kind: "game", title: "NBA Finals Game 5", market: "Celtics win Finals?", category: "sports" },
  { id: "c3", date: "Jul 18", time: "All day", kind: "vote", title: "House budget floor vote", market: "Govt shutdown by Oct?", category: "politics" },
  { id: "c4", date: "Jul 24", time: "2:00 PM ET", kind: "update", title: "Fed blackout period begins", market: "Fed cuts ≥25bps July?", category: "politics" },
  { id: "c5", date: "Jul 30", time: "2:00 PM ET", kind: "econ", title: "FOMC rate decision", market: "Fed cuts ≥25bps July?", category: "politics" },
  { id: "c6", date: "Aug 03", time: "3:00 PM ET", kind: "game", title: "Premier League opening weekend", market: "Man City win EPL?", category: "sports" },
];

const KIND_ICON: Record<Catalyst["kind"], string> = {
  game: "◈", vote: "▣", ruling: "⚖", econ: "📈", update: "◉",
};

// ── Small building blocks ────────────────────────────────────────────────────
function DualChart({ a, b, w = 620, h = 200 }: { a: number[]; b: number[]; w?: number; h?: number }) {
  const all = [...a, ...b];
  const min = Math.min(...all) - 4, max = Math.max(...all) + 4;
  const toPts = (arr: number[]) =>
    arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - ((v - min) / (max - min)) * h}`).join(" ");
  const yTicks = [0.2, 0.4, 0.6, 0.8].map((f) => h - f * h);
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      {yTicks.map((y, i) => (
        <line key={i} x1={0} y1={y} x2={w} y2={y} stroke={C.borderFaint} strokeWidth={1} />
      ))}
      <polyline points={toPts(b)} fill="none" stroke={C.no} strokeWidth={2} strokeDasharray="5 4" opacity={0.85} />
      <polyline points={toPts(a)} fill="none" stroke={C.cyan} strokeWidth={2.2} opacity={0.95} />
    </svg>
  );
}

// Convergence chart: all series share one implied-probability axis (0–100¢).
// Shows the live market price line(s) heading toward JARVIS's fair-value target,
// with a real labelled ¢ axis and the current gap called out — so "convergence"
// is something you can actually read.
function ConvergenceChart({ edge, w = 680, h = 234 }: { edge: Edge; w?: number; h?: number }) {
  const isCross = edge.leftLabel === "KALSHI";
  const poly = edge.polyHist || [];
  const kal = isCross ? (edge.kalshiHist || []) : null;
  const fair = edge.fairValue ?? null;
  const vals = [...poly, ...(kal ?? []), ...(fair != null ? [fair] : [])];
  if (!vals.length) return null;
  let dMin = Math.max(0, Math.min(...vals) - 6);
  let dMax = Math.min(100, Math.max(...vals) + 6);
  if (dMax - dMin < 14) { const mid = (dMin + dMax) / 2; dMin = Math.max(0, mid - 7); dMax = Math.min(100, mid + 7); }

  const mL = 30, mR = 72, mT = 12, mB = 20;
  const pw = w - mL - mR, ph = h - mT - mB;
  const xAt = (i: number, n: number) => mL + (n <= 1 ? pw : (i / (n - 1)) * pw);
  const yAt = (v: number) => mT + ph - ((v - dMin) / (dMax - dMin || 1)) * ph;
  const toLine = (arr: number[]) => arr.map((v, i) => `${xAt(i, arr.length)},${yAt(v)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(dMin + f * (dMax - dMin)));
  const polyNow = poly[poly.length - 1];
  const kalNow = kal && kal.length ? kal[kal.length - 1] : null;
  const gap = fair != null ? Math.abs(polyNow - fair) : (kalNow != null ? Math.abs(polyNow - kalNow) : 0);

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={mL} y1={yAt(t)} x2={w - mR} y2={yAt(t)} stroke={C.borderFaint} strokeWidth={1} />
          <text x={mL - 6} y={yAt(t) + 3} textAnchor="end" fontSize={9} fill={C.muted}>{t}¢</text>
        </g>
      ))}
      {/* JARVIS fair-value target */}
      {fair != null && (<>
        <line x1={mL} y1={yAt(fair)} x2={w - mR} y2={yAt(fair)} stroke={C.amber} strokeWidth={1.5} strokeDasharray="6 4" opacity={0.9} />
        <text x={w - mR + 6} y={yAt(fair) + 3} fontSize={9} fontWeight={700} fill={C.amber}>JARVIS {fair}¢</text>
      </>)}
      {/* Current gap bracket */}
      {gap > 0 && (<>
        <line x1={w - mR - 3} y1={yAt(polyNow)} x2={w - mR - 3} y2={yAt(fair ?? kalNow ?? polyNow)} stroke={C.cyan} strokeWidth={1.5} opacity={0.55} />
        <text x={w - mR - 8} y={(yAt(polyNow) + yAt(fair ?? kalNow ?? polyNow)) / 2 + 3} textAnchor="end" fontSize={9} fontWeight={800} fill={C.cyan}>{Math.round(gap)}¢</text>
      </>)}
      {/* Kalshi (cross-platform only) */}
      {kal && kal.length ? <polyline points={toLine(kal)} fill="none" stroke={C.cyan} strokeWidth={2} /> : null}
      {/* Polymarket (always) */}
      <polyline points={toLine(poly)} fill="none" stroke={C.no} strokeWidth={2.2} />
      <circle cx={xAt(poly.length - 1, poly.length)} cy={yAt(polyNow)} r={3.5} fill={C.no} />
      <text x={w - mR + 6} y={yAt(polyNow) + 3} fontSize={9} fontWeight={700} fill={C.no}>Poly {polyNow}¢</text>
      {kal && kalNow != null ? (<>
        <circle cx={xAt(kal.length - 1, kal.length)} cy={yAt(kalNow)} r={3.5} fill={C.cyan} />
        <text x={w - mR + 6} y={yAt(kalNow) + 3} fontSize={9} fontWeight={700} fill={C.cyan}>Kalshi {kalNow}¢</text>
      </>) : null}
      <text x={mL} y={h - 5} fontSize={8} fill={C.muted}>7d ago</text>
      <text x={w - mR} y={h - 5} textAnchor="end" fontSize={8} fill={C.muted}>now</text>
    </svg>
  );
}

function Sparkline({ data, color = C.cyan, w = 90, h = 26 }: { data: number[]; color?: string; w?: number; h?: number }) {
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / ((max - min) || 1)) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}

function CatChip({ c }: { c: Category }) {
  const col = c === "sports" ? C.yes : C.amber;
  return (
    <span style={{
      fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", padding: "2px 7px",
      borderRadius: 4, color: col, background: `${col}14`, border: `1px solid ${col}33`,
    }}>{c}</span>
  );
}

// ── EDGE CARD (image 1 unit, compact for the feed) ───────────────────────────
function EdgeCard({ edge, rank, active, onClick }: {
  edge: Edge; rank: number; active: boolean; onClick: () => void;
}) {
  return (
    <div onClick={onClick} style={{
      display: "grid", gridTemplateColumns: "84px 1fr", gap: 14, cursor: "pointer",
      padding: "16px 18px", borderRadius: 12, marginBottom: 12,
      background: active ? "rgba(0,229,255,0.06)" : C.panel,
      border: `1px solid ${active ? C.borderHi : C.border}`,
      boxShadow: active ? "0 0 0 1px rgba(0,229,255,0.12), 0 0 20px rgba(0,229,255,0.08)" : "none",
      transition: "border-color .15s, background .15s",
    }}>
      {/* Score rail */}
      <div style={{ textAlign: "center", borderRight: `1px solid ${C.borderFaint}`, paddingRight: 12 }}>
        <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.1em", marginBottom: 4 }}>#{String(rank).padStart(2, "0")}</div>
        <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em", marginBottom: 2 }}>EDGE</div>
        <div style={{ fontSize: 30, fontWeight: 800, color: C.cyan, lineHeight: 1, letterSpacing: "-0.03em" }}>+{edge.edgeScore}</div>
        <div style={{ fontSize: 8, color: CONF_COLOR[edge.confidence], marginTop: 4, letterSpacing: "0.06em" }}>{edge.confidence}</div>
      </div>
      {/* Body */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <CatChip c={edge.category} />
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{edge.question}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <PricePill platform={edge.leftLabel ?? "KALSHI"} cents={edge.kalshi} />
          <span style={{ fontSize: 10, color: C.muted }}>vs</span>
          <PricePill platform="POLYMARKET" cents={edge.polymarket} />
          {edge.vegas != null && (<><span style={{ fontSize: 10, color: C.muted }}>vs</span><PricePill platform="VEGAS" cents={edge.vegas} /></>)}
          {edge.sentiment != null && (<><span style={{ fontSize: 10, color: C.muted }}>vs</span><PricePill platform="SENTIMENT" cents={edge.sentiment} /></>)}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkline data={edge.kalshiHist} />
            <span style={{ fontSize: 9, color: C.muted, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span style={{ color: C.red }}>closes</span>{edge.closesIn}
            </span>
          </div>
        </div>
        {edge.suggestion && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "4px 10px", borderRadius: 7, background: edge.suggestion.side === "YES" ? "rgba(32,247,164,0.1)" : "rgba(85,153,255,0.1)", border: `1px solid ${edge.suggestion.side === "YES" ? "rgba(32,247,164,0.3)" : "rgba(85,153,255,0.3)"}` }}>
            <span style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em" }}>DO</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: edge.suggestion.side === "YES" ? C.yes : C.no }}>{edge.suggestion.action}</span>
          </div>
        )}
        <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.5, fontStyle: "italic" }}>
          <span style={{ color: C.cyanDim, fontStyle: "normal" }}>Why: </span>{edge.rationale}
        </div>
      </div>
    </div>
  );
}

function PricePill({ platform, cents }: { platform: string; cents: number }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "5px 12px", borderRadius: 8, background: "rgba(0,0,0,0.3)", border: `1px solid ${C.borderFaint}`,
    }}>
      <span style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em" }}>{platform}</span>
      <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{cents}¢</span>
    </div>
  );
}

// ── VIEW: Edges (master feed + detail) ───────────────────────────────────────
function EdgesView({ edges }: { edges: Edge[] }) {
  const [selIdx, setSelIdx] = useState(0);
  const sel = edges[selIdx] ?? edges[0];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 460px", gap: 20, height: "100%", overflow: "hidden" }}>
      {/* Feed */}
      <div style={{ overflowY: "auto", paddingRight: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: C.cyan }}>◧ EDGE FEED</span>
          <span style={{ fontSize: 10, color: C.muted }}>Sorted by Edge Score · High → Low</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: C.muted }}>{edges.length} live</span>
        </div>
        {edges.map((e, i) => (
          <EdgeCard key={e.id} edge={e} rank={i + 1} active={i === selIdx} onClick={() => setSelIdx(i)} />
        ))}
      </div>
      {/* Detail */}
      <div style={{ overflowY: "auto", borderLeft: `1px solid ${C.borderFaint}`, paddingLeft: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: C.cyanDim, marginBottom: 10 }}>SELECTED OPPORTUNITY</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1.25, marginBottom: 12 }}>{sel.question}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}><CatChip c={sel.category} /><span style={{ fontSize: 9, color: C.muted }}>#{selIdx + 1} of {edges.length}</span></div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 20, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.08em" }}>EDGE SCORE</div>
            <div style={{ fontSize: 44, fontWeight: 800, color: C.cyan, lineHeight: 1 }}>+{sel.edgeScore}</div>
            <div style={{ fontSize: 10, color: CONF_COLOR[sel.confidence] }}>{sel.confidence}</div>
          </div>
          {sel.fairValue != null && (
            <div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.08em" }}>JARVIS FAIR VALUE</div>
              <div style={{ fontSize: 44, fontWeight: 800, color: C.text, lineHeight: 1 }}>{sel.fairValue}%</div>
              <div style={{ fontSize: 10, color: C.muted }}>vs market {sel.polymarket}%</div>
            </div>
          )}
        </div>

        {sel.suggestion && (
          <div style={{ marginBottom: 18, padding: "12px 14px", borderRadius: 10, background: "rgba(32,247,164,0.06)", border: `1px solid ${sel.suggestion.side === "YES" ? "rgba(32,247,164,0.35)" : "rgba(85,153,255,0.35)"}` }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: C.cyanDim, marginBottom: 6 }}>SUGGESTED POSITION</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: sel.suggestion.side === "YES" ? C.yes : C.no }}>{sel.suggestion.action}</span>
            </div>
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55 }}>{sel.suggestion.detail}</div>
          </div>
        )}

        <div style={{ fontSize: 10, letterSpacing: "0.1em", color: C.cyanDim, marginBottom: 8 }}>PRICE COMPARISON</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <PricePill platform={sel.leftLabel ?? "KALSHI"} cents={sel.kalshi} />
          <div style={{ alignSelf: "center", textAlign: "center" }}>
            <div style={{ fontSize: 8, color: C.muted }}>{sel.leftLabel === "JARVIS" ? "GAP" : "SPREAD"}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.cyan }}>+{Math.abs(sel.kalshi - sel.polymarket)}¢</div>
          </div>
          <PricePill platform="POLYMARKET" cents={sel.polymarket} />
          {sel.vegas != null && <PricePill platform="VEGAS" cents={sel.vegas} />}
          {sel.sentiment != null && <PricePill platform="SENTIMENT" cents={sel.sentiment} />}
        </div>

        <div style={{ fontSize: 10, letterSpacing: "0.1em", color: C.cyanDim, marginBottom: 8 }}>PRICE HISTORY · 7D</div>
        <div style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${C.borderFaint}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
          <DualChart a={sel.kalshiHist} b={sel.polyHist} h={150} />
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 9, color: C.muted, marginBottom: 18 }}>
          <span style={{ color: C.cyan }}>— Kalshi</span><span style={{ color: C.no }}>-- Polymarket</span>
          <span style={{ marginLeft: "auto" }}>Vol {sel.volume} · Liq {sel.liquidity}</span>
        </div>

        <div style={{ fontSize: 10, letterSpacing: "0.1em", color: C.cyanDim, marginBottom: 8 }}>RATIONALE</div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6, marginBottom: 18 }}>{sel.rationale}</div>

        <div style={{ fontSize: 10, letterSpacing: "0.1em", color: C.cyanDim, marginBottom: 8 }}>RELATED MARKETS</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {sel.related.map((r) => (
            <span key={r} style={{ fontSize: 10, padding: "5px 10px", borderRadius: 8, color: C.cyanDim, background: "rgba(0,229,255,0.05)", border: `1px solid ${C.borderFaint}` }}>{r}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── VIEW: Timeline (main / landing) ──────────────────────────────────────────
function TimelineView({ edges, catalysts }: { edges: Edge[]; catalysts: Catalyst[] }) {
  const [convIdx, setConvIdx] = useState(0);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const cIdx = Math.min(convIdx, edges.length - 1);
  const conv = edges[cIdx];
  const avgSpread = Math.round(edges.reduce((s, e) => s + Math.abs(e.kalshi - e.polymarket), 0) / edges.length);
  const stats = [
    ["MARKETS TRACKED", String(edges.length * 6)],
    ["LIVE EDGES", String(edges.length)],
    ["AVG DIVERGENCE", `${avgSpread}¢`],
    ["TOP EDGE", `+${Math.max(...edges.map(e => e.edgeScore))}`],
  ];
  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      {/* Stat strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 22 }}>
        {stats.map(([k, v]) => (
          <div key={k} style={{ padding: "12px 16px", borderRadius: 10, background: C.panel, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.08em", marginBottom: 6 }}>{k}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.cyan }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Convergence chart with edge selector */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: C.cyan }}>◈ CONVERGENCE</span>
          <span style={{ fontSize: 10, color: C.muted }}>live price → JARVIS fair value</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 9 }}>
            {conv.leftLabel === "KALSHI" && <span style={{ color: C.cyan }}>— Kalshi</span>}
            <span style={{ color: C.no }}>— Polymarket</span>
            <span style={{ color: C.amber }}>-- JARVIS fair</span>
          </span>
        </div>
        {/* edge selector */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
          {edges.slice(0, 6).map((e, i) => (
            <button key={e.id} onClick={() => setConvIdx(i)} style={{
              flexShrink: 0, fontSize: 10, padding: "5px 10px", borderRadius: 7, cursor: "pointer",
              background: i === cIdx ? "rgba(0,229,255,0.12)" : "transparent",
              border: `1px solid ${i === cIdx ? C.borderHi : C.borderFaint}`,
              color: i === cIdx ? C.cyan : C.muted, maxWidth: 210, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>+{e.edgeScore} · {e.question}</button>
          ))}
        </div>
        <div style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${C.borderFaint}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>{conv.question}</div>
          <ConvergenceChart edge={conv} />
          {conv.suggestion && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderFaint}`, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: conv.suggestion.side === "YES" ? C.yes : C.no }}>{conv.suggestion.action}</span>
              <span style={{ fontSize: 11, color: C.muted, flex: 1, minWidth: 200 }}>{conv.suggestion.detail}</span>
            </div>
          )}
        </div>
      </div>

      {/* General catalyst timeline */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: C.cyan }}>◷ CATALYST TIMELINE</span>
        <span style={{ fontSize: 10, color: C.muted }}>Upcoming events that move tracked markets</span>
      </div>
      <div style={{ position: "relative", paddingLeft: 28 }}>
        {/* vertical spine */}
        <div style={{ position: "absolute", left: 9, top: 4, bottom: 4, width: 2, background: "linear-gradient(180deg, rgba(0,229,255,0.5), rgba(0,229,255,0.1))" }} />
        {catalysts.map((c) => (
          <div key={c.id} style={{ position: "relative", marginBottom: 16 }}>
            <div style={{ position: "absolute", left: -23, top: 14, width: 12, height: 12, borderRadius: "50%", background: C.bg, border: `2px solid ${C.cyan}`, boxShadow: "0 0 8px rgba(0,229,255,0.5)" }} />
            <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 14, padding: "12px 16px", borderRadius: 10, background: C.panel, border: `1px solid ${C.border}` }}>
              <div style={{ borderRight: `1px solid ${C.borderFaint}`, paddingRight: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.cyan }}>{c.date}</div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{c.time}</div>
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>{KIND_ICON[c.kind]}</span>
                  <span style={{ fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: C.cyanDim }}>{c.kind}</span>
                  <CatChip c={c.category} />
                  {c.marketCount != null && (
                    <span style={{ marginLeft: "auto", fontSize: 9, color: C.muted }}>
                      {c.marketCount} market{c.marketCount === 1 ? "" : "s"}{c.edgeCount ? <span style={{ color: C.yes }}> · {c.edgeCount} edge{c.edgeCount === 1 ? "" : "s"}</span> : null}
                    </span>
                  )}
                </div>
                {c.impacted?.length ? (
                  <>
                    <div
                      onClick={() => setOpenCat(openCat === c.id ? null : c.id)}
                      style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{c.title}</span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: C.cyanDim }}>
                        {openCat === c.id ? "hide" : "impacted markets"}
                      </span>
                      <span style={{ fontSize: 11, color: C.cyanDim, display: "inline-block", transition: "transform 0.15s", transform: openCat === c.id ? "rotate(180deg)" : "none" }}>▾</span>
                    </div>
                    {openCat === c.id && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                        {c.impacted.map((m, i) => (
                          <div key={i} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: 6,
                            background: m.isEdge ? "rgba(0,229,255,0.05)" : "rgba(255,255,255,0.02)",
                            border: `1px solid ${m.isEdge ? "rgba(0,229,255,0.18)" : C.borderFaint}`,
                          }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.question}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.text, flexShrink: 0 }}>{m.yes}¢</span>
                            {m.isEdge && (
                              <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: C.yes, padding: "2px 6px", borderRadius: 5, background: "rgba(32,247,164,0.1)", border: "1px solid rgba(32,247,164,0.3)" }}>
                                +{m.edgeScore}{m.action ? ` · ${m.action}` : ""}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3 }}>{c.title}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>↳ {c.market}</div>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Reliability diagram: predicted YES prob (x) vs realized YES rate (y). Dots on
// the diagonal are well-calibrated; below = overconfident, above = underconfident.
function CalibrationChart({ buckets }: { buckets: any[] }) {
  const W = 260, H = 220, pad = 30;
  const plotW = W - pad * 2, plotH = H - pad * 2;
  const x = (v: number) => pad + (v / 100) * plotW;
  const y = (v: number) => H - pad - (v / 100) * plotH;
  const maxN = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: 320 }}>
      {/* frame + perfect-calibration diagonal */}
      <rect x={pad} y={pad} width={plotW} height={plotH} fill="none" stroke={C.borderFaint} />
      <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} stroke={C.muted} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
      {/* per-bucket dots, radius ∝ sample size */}
      {buckets.map((b) => (
        <g key={b.range}>
          <line x1={x(b.predicted)} y1={y(b.predicted)} x2={x(b.predicted)} y2={y(b.realized)} stroke={C.cyan} strokeWidth={1} opacity={0.3} />
          <circle cx={x(b.predicted)} cy={y(b.realized)} r={4 + (b.n / maxN) * 6} fill={C.cyan} opacity={0.85} />
        </g>
      ))}
      <text x={W / 2} y={H - 6} textAnchor="middle" fill={C.muted} fontSize={9}>PREDICTED YES %</text>
      <text x={10} y={H / 2} textAnchor="middle" fill={C.muted} fontSize={9} transform={`rotate(-90 10 ${H / 2})`}>REALIZED YES %</text>
    </svg>
  );
}

// ── VIEW: Scorecard (track record) ───────────────────────────────────────────
function ScorecardView({ data }: { data: any }) {
  const s = data?.summary ?? {};
  const recent: any[] = data?.recent ?? [];
  const calibration: any[] = data?.calibration ?? [];
  const tiles = [
    ["EDGES LOGGED", String(s.logged ?? 0)],
    ["OPEN", String(s.open ?? 0)],
    ["RESOLVED", String(s.resolved ?? 0)],
    ["HIT RATE", s.hitRate == null ? "—" : `${s.hitRate}%`],
    ["AVG EDGE", `+${s.avgEdge ?? 0}`],
  ];
  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 22 }}>
        {tiles.map(([k, v]) => (
          <div key={k} style={{ padding: "12px 16px", borderRadius: 10, background: C.panel, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.08em", marginBottom: 6 }}>{k}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.cyan }}>{v}</div>
          </div>
        ))}
      </div>
      {s.hitRate == null && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 18, fontStyle: "italic" }}>
          Hit rate / calibration populate as logged markets resolve. Every flagged edge is tracked and graded at resolution.
        </div>
      )}
      {calibration.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: C.cyan, marginBottom: 4 }}>◎ CALIBRATION</div>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 10 }}>
            JARVIS's predicted YES probability vs how often those markets actually resolved YES. On the diagonal = well-calibrated; below = overconfident. Dot size = sample count.
          </div>
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <CalibrationChart buckets={calibration} />
            <div style={{ display: "grid", gap: 6 }}>
              {calibration.map((b) => (
                <div key={b.range} style={{ display: "grid", gridTemplateColumns: "58px 60px 60px 40px", gap: 8, fontSize: 10, alignItems: "center" }}>
                  <span style={{ color: C.muted }}>{b.range}%</span>
                  <span style={{ color: C.cyanDim }}>pred {b.predicted}%</span>
                  <span style={{ color: b.realized >= b.predicted ? C.yes : C.amber }}>real {b.realized}%</span>
                  <span style={{ color: C.muted, textAlign: "right" }}>n={b.n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: C.cyan, marginBottom: 12 }}>◫ LOGGED EDGES</div>
      {!recent.length ? (
        <div style={{ fontSize: 12, color: C.muted }}>No edges logged yet — the scanner runs every 10 minutes.</div>
      ) : (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 90px 90px", gap: 10, padding: "6px 12px", fontSize: 8, color: C.muted, letterSpacing: "0.08em", borderBottom: `1px solid ${C.borderFaint}` }}>
            <div>MARKET</div><div style={{ textAlign: "center" }}>ENTRY</div><div style={{ textAlign: "center" }}>EDGE</div><div style={{ textAlign: "center" }}>CONF</div><div style={{ textAlign: "center" }}>STATUS</div>
          </div>
          {recent.map((r) => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 90px 90px", gap: 10, padding: "10px 12px", alignItems: "center", borderBottom: `1px solid ${C.borderFaint}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.question}</div>
                <div style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>{r.category} · {(r.signals || "").split(",").join(" · ")}</div>
              </div>
              <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700 }}>{r.entry_poly}¢</div>
              <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: C.cyan }}>+{r.entry_edge}</div>
              <div style={{ textAlign: "center", fontSize: 9, color: CONF_COLOR[r.confidence] ?? C.muted }}>{r.confidence}</div>
              <div style={{ textAlign: "center" }}>
                {r.status === "resolved" ? (
                  <span style={{ fontSize: 10, fontWeight: 700, color: r.correct ? C.yes : C.red }}>{r.correct ? "✓ WIN" : "✗ MISS"}</span>
                ) : (
                  <span style={{ fontSize: 9, color: C.muted }}>open</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── VIEW: Signals (raw pre-scored firehose) ──────────────────────────────────
const SIG_STATUS: Record<string, { label: string; color: string }> = {
  "actionable":     { label: "ACTIONABLE",     color: C.yes },
  "below-threshold":{ label: "below bar",       color: C.muted },
  "match-rejected": { label: "match rejected",  color: C.amber },
};

function SignalsView({ data, cat }: { data: any; cat: "all" | Category }) {
  const all: any[] = data?.signals ?? [];
  const signals = cat === "all" ? all : all.filter((s) => s.category === cat);
  const counts = signals.reduce((m: Record<string, number>, s) => { m[s.status] = (m[s.status] || 0) + 1; return m; }, {});

  // Compact estimate string: which alternative reads exist for this candidate.
  const estimates = (s: any) => [
    s.kalshi != null ? `K ${s.kalshi}¢` : null,
    s.modelProb != null ? `M ${s.modelProb}%` : null,
    s.vegas != null ? `V ${s.vegas}%` : null,
    s.sentiment != null ? `S ${s.sentiment}%` : null,
  ].filter(Boolean).join("  ");

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: C.cyan, marginBottom: 4 }}>≋ SIGNAL FIREHOSE</div>
      <div style={{ fontSize: 10, color: C.muted, marginBottom: 14, maxWidth: 680 }}>
        Every candidate the scan evaluated, before the actionable-edge filter. Most won't clear the bar — that's expected when markets agree (efficient). Cross-platform needs ≥3¢ divergence; model/vegas ≥6; sentiment ≥8.
      </div>
      <div style={{ display: "flex", gap: 14, marginBottom: 16, fontSize: 10 }}>
        <span style={{ color: C.yes }}>● {counts["actionable"] || 0} actionable</span>
        <span style={{ color: C.muted }}>● {counts["below-threshold"] || 0} below bar</span>
        <span style={{ color: C.amber }}>● {counts["match-rejected"] || 0} match-rejected</span>
      </div>
      {!signals.length ? (
        <div style={{ fontSize: 12, color: C.muted }}>
          {data ? "No candidates in this category on the last scan." : "Signal firehose is available only on live data (backend unreachable)."}
        </div>
      ) : (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 170px 52px 118px", gap: 10, padding: "6px 12px", fontSize: 8, color: C.muted, letterSpacing: "0.08em", borderBottom: `1px solid ${C.borderFaint}` }}>
            <div>MARKET</div><div style={{ textAlign: "center" }}>POLY</div><div>ESTIMATES</div><div style={{ textAlign: "center" }}>RAW</div><div style={{ textAlign: "center" }}>STATUS</div>
          </div>
          {signals.map((s) => {
            const st = SIG_STATUS[s.status] ?? { label: s.status, color: C.muted };
            return (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 56px 170px 52px 118px", gap: 10, padding: "9px 12px", alignItems: "center", borderBottom: `1px solid ${C.borderFaint}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.question}</div>
                  <div style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>
                    {s.category}{s.matchScore != null ? ` · match ${s.matchScore}` : ""}{s.triggers?.length ? ` · ${s.triggers.join(" · ")}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700 }}>{s.polymarket}¢</div>
                <div style={{ fontSize: 10, color: C.cyanDim, fontVariantNumeric: "tabular-nums" }}>{estimates(s) || "—"}</div>
                <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: s.status === "actionable" ? C.cyan : C.muted }}>{s.rawScore}</div>
                <div style={{ textAlign: "center", fontSize: 9, fontWeight: 700, color: st.color }}>{st.label}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Room shell ────────────────────────────────────────────────────────────────
type View = "timeline" | "edges" | "signals" | "scorecard";

export function ArbiterRoom({ onExit }: {
  jarvisContext?: Array<{ speaker: string; text: string }>;
  onExit: () => void;
}) {
  const [view, setView] = useState<View>("timeline");
  const [cat, setCat] = useState<"all" | Category>("all");
  const [live, setLive] = useState<{ edges: Edge[]; catalysts: Catalyst[] } | null>(null);
  const [scoreData, setScoreData] = useState<any>(null);
  const [signalsData, setSignalsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Fetch live edges + timeline from the Arbiter backend. Falls back to the
  // mock data if the backend is unreachable or returns nothing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [e, t, s, sig] = await Promise.all([
          api<any>("/api/arbiter/edges").catch(() => null),
          api<any>("/api/arbiter/timeline").catch(() => null),
          api<any>("/api/arbiter/scorecard").catch(() => null),
          api<any>("/api/arbiter/signals").catch(() => null),
        ]);
        if (cancelled) return;
        const edges: Edge[] = e?.edges?.length ? e.edges : MOCK_EDGES;
        const catalysts: Catalyst[] = t?.catalysts?.length ? t.catalysts : MOCK_CATALYSTS;
        setLive({ edges, catalysts });
        setScoreData(s);
        setSignalsData(sig);
      } catch {
        if (!cancelled) setLive({ edges: MOCK_EDGES, catalysts: MOCK_CATALYSTS });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const allEdges = live?.edges ?? MOCK_EDGES;
  const allCatalysts = live?.catalysts ?? MOCK_CATALYSTS;
  const usingMock = !live || live.edges === MOCK_EDGES;

  const edges = useMemo(
    () => (cat === "all" ? allEdges : allEdges.filter((e) => e.category === cat)),
    [cat, allEdges]
  );
  const catalysts = useMemo(
    () => (cat === "all" ? allCatalysts : allCatalysts.filter((c) => c.category === cat)),
    [cat, allCatalysts]
  );

  const NAV: Array<{ id: View; label: string; icon: string }> = [
    { id: "timeline", label: "Timeline", icon: "◷" },
    { id: "edges", label: "Edges", icon: "◧" },
    { id: "signals", label: "Signals", icon: "≋" },
    { id: "scorecard", label: "Scorecard", icon: "◎" },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 400, background: C.bg,
      backgroundImage: "radial-gradient(1200px 500px at 50% -10%, rgba(0,229,255,0.06), transparent 60%)",
      fontFamily: C.font, color: C.text, display: "flex", flexDirection: "column",
    }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 22px", borderBottom: `1px solid ${C.borderFaint}` }}>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.14em", color: C.cyan }}>◆ ARBITER</span>
        <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.06em" }}>prediction-market edge intelligence</span>
        {/* view switch */}
        <div style={{ display: "flex", gap: 4, marginLeft: 20 }}>
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              fontSize: 12, fontWeight: view === n.id ? 700 : 500, padding: "7px 16px", borderRadius: 8, cursor: "pointer",
              background: view === n.id ? "rgba(0,229,255,0.12)" : "transparent",
              border: `1px solid ${view === n.id ? C.borderHi : "transparent"}`,
              color: view === n.id ? C.cyan : C.muted,
            }}>{n.icon} {n.label}</button>
          ))}
        </div>
        {/* category filter */}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {(["all", "sports", "politics"] as const).map((c) => (
            <button key={c} onClick={() => setCat(c)} style={{
              fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em",
              background: cat === c ? "rgba(0,229,255,0.1)" : "transparent",
              border: `1px solid ${cat === c ? C.borderHi : C.borderFaint}`,
              color: cat === c ? C.cyan : C.muted,
            }}>{c}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: C.yes }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.yes, boxShadow: `0 0 6px ${C.yes}` }} />LIVE
        </div>
        <button onClick={onExit} title="Exit" style={{ fontSize: 18, background: "none", border: "none", color: C.muted, cursor: "pointer", padding: "0 4px" }}>×</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, padding: "22px 26px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.muted, fontSize: 13 }}>Scanning Kalshi + Polymarket…</div>
        ) : view === "scorecard" ? (
          <ScorecardView data={scoreData} />
        ) : view === "signals" ? (
          <SignalsView data={signalsData} cat={cat} />
        ) : !edges.length ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: C.muted, gap: 8 }}>
            <div style={{ fontSize: 15, color: C.text }}>No live edges in {cat === "all" ? "any category" : cat} right now.</div>
            <div style={{ fontSize: 11 }}>Cross-platform matches are sparse — the scan runs every 10 min.</div>
          </div>
        ) : view === "timeline" ? (
          <TimelineView edges={edges} catalysts={catalysts} />
        ) : (
          <EdgesView edges={edges} />
        )}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", padding: "8px 22px", borderTop: `1px solid ${C.borderFaint}`, fontSize: 9, color: C.muted }}>
        <span>Data from Kalshi, Polymarket, Vegas odds + news/social sentiment · sports + politics · Model estimates &amp; positions are informational, not financial advice.</span>
        <span style={{ marginLeft: "auto", color: usingMock ? C.amber : C.yes }}>
          {usingMock ? "MOCK DATA — backend unreachable" : "LIVE — Kalshi + Polymarket"}
        </span>
      </div>
    </div>
  );
}
