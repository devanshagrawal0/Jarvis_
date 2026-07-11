import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { blankSpec, templateSpecs, summarizeEntry, isLogic, DEFAULT_UNIVERSE, type BotSpec, type SignalCond, type LogicNode, type Cmp } from "./forge-spec";
import { SIGNALS, SIGNAL_GROUPS } from "./forge-blocks";
import { useStrategies, useForgeLibrary, fetchStrategy, saveStrategy, deleteStrategy, deleteSignal, deleteVariable, saveFolder, saveSignal, deleteFolder, runBacktest, analyzePython, type PyBrief } from "./forge-data";
import { ForgeStudio } from "./ForgeStudio";
import { monteCarlo, composePortfolio, hrpAllocate, type BacktestResult, type MonteCarlo, type PortfolioResult } from "./forge-engine";
import { ForgeGraph } from "./ForgeGraph";
import { ForgeDock } from "./ForgeDock";
import { saveVersion, getVersions } from "./forge-versions";
import { Icon } from "./ForgeIcons";
import { deepAnalyze, type DeepReport } from "./forge-analysis";
import { analyzeStrategy, analyzeRegimes, type Analysis, type RegimeAnalysis } from "./improver/analyze";
import { askImproverAgent } from "./improver/agent";
import { ForgeRegime } from "./ForgeRegime";
import { runSentinel, type SentinelResult } from "./improver/sentinel";
import { genesis, type GenesisResult } from "./improver/genesis";
import { evolve, type DarwinResult } from "./improver/darwin";
import { runMetaLabeler, type MetaResult } from "./improver/meta";
import { runTerraform, type TerrainResult } from "./improver/terraform";
import { mineSignals, type MinedSignal } from "./improver/prospector";
const ForgeTerraform = lazy(() => import("./ForgeTerraform").then(m => ({ default: m.ForgeTerraform })));
import { saveReport, forgeImprove, forgeAdversary } from "./forge-data";
import { ForgeDNA } from "./ForgeDNA";
import { ForgeCandles } from "./ForgeCandles";
const ForgeOracle = lazy(() => import("./ForgeOracle")); // three/r3f loaded only when opened
import "./forge.css";

function drawEquity(ctx: CanvasRenderingContext2D, w: number, h: number, eq: { equity: number }[]) {
  ctx.clearRect(0, 0, w, h);
  if (eq.length < 2) { ctx.fillStyle = "rgba(150,190,225,.4)"; ctx.font = "11px ui-monospace"; ctx.fillText("run a backtest to see the equity curve", 12, h / 2); return; }
  const vals = eq.map(e => e.equity); const lo = Math.min(...vals), hi = Math.max(...vals), rg = hi - lo || 1;
  const X = (i: number) => (i / (eq.length - 1)) * (w - 8) + 4, Y = (v: number) => h - 8 - ((v - lo) / rg) * (h - 16);
  const up = vals[vals.length - 1] >= vals[0]; const col = up ? "#34d399" : "#f4556b";
  ctx.beginPath(); ctx.moveTo(X(0), h); eq.forEach((e, i) => ctx.lineTo(X(i), Y(e.equity))); ctx.lineTo(X(eq.length - 1), h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + "44"); g.addColorStop(0.6, col + "14"); g.addColorStop(1, col + "00"); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); eq.forEach((e, i) => i ? ctx.lineTo(X(i), Y(e.equity)) : ctx.moveTo(X(i), Y(e.equity))); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.shadowColor = col; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
  const ex = X(eq.length - 1), ey = Y(vals[vals.length - 1]); ctx.beginPath(); ctx.arc(ex, ey, 4, 0, 7); ctx.fillStyle = col + "55"; ctx.fill(); ctx.beginPath(); ctx.arc(ex, ey, 2, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
}

function EquityChart({ result }: { result: BacktestResult | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const DPR = Math.min(devicePixelRatio || 1, 2), w = c.clientWidth || 360, h = 120;
    c.width = w * DPR; c.height = h * DPR; const ctx = c.getContext("2d")!; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawEquity(ctx, w, h, result?.equity || []);
  }, [result]);
  return <canvas ref={ref} className="fg-eq" style={{ height: 120 }} />;
}

function drawDrawdown(ctx: CanvasRenderingContext2D, w: number, h: number, eq: { drawdown: number }[]) {
  ctx.clearRect(0, 0, w, h);
  if (eq.length < 2) return;
  const dds = eq.map(e => e.drawdown); const min = Math.min(-1, ...dds);
  const X = (i: number) => (i / (eq.length - 1)) * (w - 8) + 4, Y = (v: number) => 4 + (v / min) * (h - 10);
  ctx.beginPath(); ctx.moveTo(X(0), 4); eq.forEach((e, i) => ctx.lineTo(X(i), Y(e.drawdown))); ctx.lineTo(X(eq.length - 1), 4); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(244,85,107,0)"); g.addColorStop(1, "rgba(244,85,107,.4)"); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); eq.forEach((e, i) => i ? ctx.lineTo(X(i), Y(e.drawdown)) : ctx.moveTo(X(i), Y(e.drawdown))); ctx.strokeStyle = "#f4556b"; ctx.lineWidth = 1; ctx.stroke();
}
function DrawdownChart({ result }: { result: BacktestResult | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const DPR = Math.min(devicePixelRatio || 1, 2), w = c.clientWidth || 360, h = 56;
    c.width = w * DPR; c.height = h * DPR; const ctx = c.getContext("2d")!; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawDrawdown(ctx, w, h, result?.equity || []);
  }, [result]);
  return <canvas ref={ref} className="fg-dd" style={{ height: 56 }} />;
}

const CMP_LABELS: Record<Cmp, string> = { cross_up: "crosses above", cross_dn: "crosses below", gt: ">", lt: "<", gte: "≥", lte: "≤", true: "is true", false: "is false" };

/* Read-only code scaffold generated from the BotSpec (Python tab). Not an exact
   executable translation — a readable skeleton to hand off / adapt. */
function codegenPython(spec: BotSpec): string {
  const sym = spec.universe.symbols[0] || "SPY";
  const inds = [...new Set(spec.signals.map(s => s.type.toUpperCase()))];
  const sigLines = spec.signals.map(s => `    ${s.id} = ${s.type.toUpperCase()}(df['close'], ${Object.values(s.params).join(", ")})`).join("\n") || "    pass";
  const entry = summarizeEntry(spec.entry, spec.signals);
  const exits = [spec.exit.stopLossPct && `stop_loss=${spec.exit.stopLossPct}%`, spec.exit.takeProfitPct && `take_profit=${spec.exit.takeProfitPct}%`, spec.exit.trailingPct && `trailing=${spec.exit.trailingPct}%`, spec.exit.timeBars && `time_exit=${spec.exit.timeBars}bars`].filter(Boolean).join(", ") || "signal reversal";
  return `# ${spec.meta.name} — scaffold generated by THE FORGE
# Universe: ${sym} @ ${spec.universe.bar}  |  sizing: ${spec.sizing.method} = ${spec.sizing.value}
import pandas as pd
from indicators import ${inds.join(", ") || "SMA"}

def strategy(df: pd.DataFrame) -> pd.Series:
    # ── signals ──
${sigLines}
    # ── entry: ${entry} ──
    entry = build_entry(df)   # ${entry}
    # ── exit: ${exits} ──
    return backtest(df, entry, exit=dict(${exits.replace(/%/g, "").replace(/=/g, "=")}))${spec.risk.maxDrawdownPct ? `\n    # risk kill-switch @ ${spec.risk.maxDrawdownPct}% drawdown` : ""}
`;
}

/* Flatten the Improver diagnosis tree to indented rows for display. */
function flattenTree(nodes: { id: string; kind: string; claim: string; verdict: string; childIds: string[]; dollarImpact: number }[], rootId: string) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const rows: { node: typeof nodes[0]; depth: number }[] = [];
  const walk = (id: string, depth: number) => { const n = byId.get(id); if (!n) return; if (depth > 0) rows.push({ node: n, depth: depth - 1 }); for (const c of n.childIds) walk(c, depth + 1); };
  walk(rootId, 0);
  return rows;
}

const FULL_UNIVERSE: string[] = [...DEFAULT_UNIVERSE,
  "ORCL", "QCOM", "TXN", "CSCO", "AMGN", "HON", "IBM", "GE", "CAT", "BA",
  "GS", "MS", "WFC", "C", "AXP", "BLK", "SPGI", "LMT", "RTX", "NKE",
  "MCD", "SBUX", "LOW", "TGT", "MDT", "PFE", "TMO", "DHR", "LIN", "NEE",
];   // ~60 liquid large-caps
const UNIVERSE_PRESETS: { name: string; symbols: string[] }[] = [
  { name: "★ All Large-cap (60)", symbols: FULL_UNIVERSE },
  { name: "Default 30", symbols: [...DEFAULT_UNIVERSE] },
  { name: "Mega-cap Tech", symbols: ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META"] },
  { name: "Index ETFs", symbols: ["SPY", "QQQ", "IWM", "DIA"] },
  { name: "Sectors", symbols: ["XLK", "XLF", "XLE", "XLV", "XLY", "XLI", "XLP", "XLU"] },
  { name: "Semis", symbols: ["NVDA", "AMD", "AVGO", "TSM", "MU", "INTC"] },
  { name: "Dow 10", symbols: ["AAPL", "MSFT", "JPM", "V", "UNH", "HD", "PG", "JNJ", "CVX", "MRK"] },
  { name: "Crypto", symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"] },
];

export function ForgeView({ onSound }: { onSound?: (n: string) => void }) {
  // Theme the shared Jarvis command panel to the Forge's ice accent while this
  // room is mounted (the panel lives at the document root, so we set vars there).
  useEffect(() => {
    const root = document.documentElement, prev = new Map<string, string>();
    const vars: Record<string, string> = { "--jr-a": "210,232,250", "--jr-bg1": "20,22,28", "--jr-bg2": "9,10,14", "--jr-tx": "224,236,248" };
    for (const k in vars) { prev.set(k, root.style.getPropertyValue(k)); root.style.setProperty(k, vars[k]); }
    return () => { prev.forEach((v, k) => v ? root.style.setProperty(k, v) : root.style.removeProperty(k)); };
  }, []);

  const { list, loading, reload } = useStrategies();
  const [spec, setSpec] = useState<BotSpec | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [mc, setMc] = useState<MonteCarlo | null>(null);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pyBrief, setPyBrief] = useState<PyBrief | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [portOpen, setPortOpen] = useState(false);
  const [portSel, setPortSel] = useState<Set<string>>(new Set());
  const [portRes, setPortRes] = useState<PortfolioResult | null>(null);
  const [composing, setComposing] = useState(false);
  const [portMethod, setPortMethod] = useState<"equal" | "hrp">("hrp");
  const [buildMode, setBuildMode] = useState<"graph" | "forms">("graph");
  const [focusSec, setFocusSec] = useState<string | null>(null);
  const [libTab, setLibTab] = useState<"Library" | "Projects" | "Blocks">("Library");
  const [canvasTab, setCanvasTab] = useState<"Visual Builder" | "Python" | "Transcript" | "Research">("Visual Builder");
  const [zoom, setZoom] = useState(100);
  const [libQuery, setLibQuery] = useState("");
  const [libFilter, setLibFilter] = useState<"All" | "Favorites" | "Mine" | "Official">("All");
  const [blockCat, setBlockCat] = useState<string | null>("Momentum");
  const [favs, setFavs] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem("forge-favs") || "[]")); } catch { return new Set(); } });
  const toggleFav = (id: string) => setFavs(f => { const n = new Set(f); n.has(id) ? n.delete(id) : n.add(id); try { localStorage.setItem("forge-favs", JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  const [studio, setStudio] = useState<null | "signal" | "variable">(null);
  const [oracleOpen, setOracleOpen] = useState(false);
  const [deepRep, setDeepRep] = useState<DeepReport | null>(null);
  const [analyzingDeep, setAnalyzingDeep] = useState(false);
  const [improve, setImprove] = useState<{ loading: boolean; text?: string } | null>(null);
  const [adversary, setAdversary] = useState<{ loading: boolean; text?: string } | null>(null);
  const runAdversary = async () => {
    if (!spec || !result) return;
    setAdversary({ loading: true }); onSound?.("open");
    const summary = `${spec.meta.name}: buy when ${summarizeEntry(spec.entry, spec.signals)}. Universe ${spec.universe.symbols.join(",")} on ${spec.universe.bar}. Exit ${JSON.stringify(spec.exit)}.`;
    const res = await forgeAdversary(summary, result.metrics as unknown as Record<string, number>);
    setAdversary({ loading: false, text: res?.critique || res?.error || "Couldn't reach the Adversary — is the brain online?" });
    onSound?.("done");
  };
  const [improver, setImprover] = useState<{ loading: boolean; analysis?: Analysis } | null>(null);
  const [genesisOpen, setGenesisOpen] = useState(false);
  const [genesisBusy, setGenesisBusy] = useState(false);
  const [genesisRes, setGenesisRes] = useState<GenesisResult | null>(null);
  const [genesisErr, setGenesisErr] = useState<string | null>(null);
  const genesisInputRef = useRef<HTMLInputElement>(null);
  const runGenesis = async (goal: string) => {
    if (!goal.trim()) return;
    setGenesisBusy(true); setGenesisErr(null); setGenesisRes(null); onSound?.("tick");
    const r = await genesis(goal.trim(), Date.now());
    setGenesisBusy(false);
    if (r.result) setGenesisRes(r.result); else setGenesisErr(r.error || "Failed.");
    onSound?.("done");
  };
  const adoptGenesis = () => { if (genesisRes) { saveVersion(genesisRes.spec.meta.id, genesisRes.spec, genesisRes.result.metrics as unknown as Record<string, number>, "Adopted Genesis strategy"); setSpec(genesisRes.spec); setResult(genesisRes.result); setMc(null); setGenesisOpen(false); setGenesisRes(null); onSound?.("save"); } };
  const [sentinel, setSentinel] = useState<{ loading: boolean; res?: SentinelResult } | null>(null);
  const runSentinelCheck = async () => { if (!result || !spec) return; setSentinel({ loading: true }); onSound?.("open"); const res = await runSentinel(spec, result); setSentinel({ loading: false, res: res || undefined }); onSound?.("done"); };
  const [meta, setMeta] = useState<{ loading: boolean; res?: MetaResult } | null>(null);
  const runMeta = async () => { if (!result || !spec) return; setMeta({ loading: true }); onSound?.("open"); const res = await runMetaLabeler(spec, result); setMeta({ loading: false, res: res || undefined }); onSound?.("done"); };
  const [prospect, setProspect] = useState<{ loading: boolean; signals?: MinedSignal[]; added: Set<string> } | null>(null);
  const runProspect = async () => { if (!spec) return; setProspect({ loading: true, added: new Set() }); onSound?.("open"); const signals = await mineSignals(spec.universe.symbols[0] || "SPY"); setProspect({ loading: false, signals, added: new Set() }); onSound?.("done"); };
  const addMined = async (m: MinedSignal) => { await saveSignal({ name: m.name, expr: m.dslHint, description: `${m.reading} — ${m.description}`.slice(0, 240), codePath: `altdata:${m.category}`, createdBy: "ai" }); reloadLib(); setProspect(p => p ? { ...p, added: new Set([...p.added, m.id]) } : p); onSound?.("save"); toast(`Added “${m.name}” to library`, "ok"); };
  const [terra, setTerra] = useState<{ loading: boolean; res?: TerrainResult } | null>(null);
  const runTerra = async () => { if (!spec) return; setTerra({ loading: true }); onSound?.("open"); const res = await runTerraform(spec); setTerra({ loading: false, res: res || undefined }); onSound?.("done"); };
  const applyTerra = () => { if (terra?.res && spec) { setSpec({ ...spec, exit: { ...spec.exit, stopLossPct: terra.res.best.xv, takeProfitPct: terra.res.best.yv } }); setResult(null); setMc(null); setTerra(null); onSound?.("save"); } };
  const [darwin, setDarwin] = useState<{ loading: boolean; gen?: number; res?: DarwinResult } | null>(null);
  const runDarwin = async () => { if (!spec) return; setDarwin({ loading: true, gen: 0 }); onSound?.("open"); const res = await evolve(spec, (g) => setDarwin(d => d ? { ...d, gen: g } : d)); setDarwin({ loading: false, res: res || undefined }); onSound?.("done"); };
  const adoptDarwin = () => { if (darwin?.res) { saveVersion(darwin.res.best.meta.id, darwin.res.best, darwin.res.bestMetrics as unknown as Record<string, number>, "Adopted Darwin winner"); setSpec(darwin.res.best); setResult(null); setMc(null); setDarwin(null); onSound?.("save"); } };
  const [regime, setRegime] = useState<{ loading: boolean; analysis?: RegimeAnalysis } | null>(null);
  const runRegimeRadar = async () => { if (!result || !spec) return; setRegime({ loading: true }); onSound?.("open"); const a = await analyzeRegimes(spec, result); setRegime({ loading: false, analysis: a || undefined }); onSound?.("done"); };
  const [agentMsgs, setAgentMsgs] = useState<{ role: "user" | "agent"; text: string }[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const agentInputRef = useRef<HTMLInputElement>(null);

  // ── Toast feedback (visibility of system status) — surfaces the previously
  // silent backend failures and confirms destructive/consequential actions.
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: "ok" | "warn" | "err" }[]>([]);
  const toastSeq = useRef(0);
  const timersRef = useRef<number[]>([]);   // M1: track toast timers so we can clear them on unmount
  const toast = (msg: string, kind: "ok" | "warn" | "err" = "ok") => {
    const id = ++toastSeq.current;
    setToasts(t => [...t, { id, msg, kind }]);
    timersRef.current.push(window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3400));
  };

  // ── Click-again-to-confirm delete (error prevention without a modal wall).
  const [pendingDel, setPendingDel] = useState<string | null>(null);
  const delTimer = useRef<number | null>(null);
  const armDelete = (key: string, fn: () => void, label: string) => {
    if (pendingDel === key) {
      if (delTimer.current) window.clearTimeout(delTimer.current);
      setPendingDel(null); fn(); toast(`Deleted “${label}”`, "ok"); onSound?.("close");
    } else {
      setPendingDel(key);
      if (delTimer.current) window.clearTimeout(delTimer.current);
      delTimer.current = window.setTimeout(() => setPendingDel(null), 3000);
      toast(`Click ✕ again to delete “${label}”`, "warn");
    }
  };

  // ── Esc closes the topmost overlay (never while an op is still running).
  const closeTopmost = () => {
    if (studio) return setStudio(null);
    if (genesisOpen) return setGenesisOpen(false);
    if (pyBrief) return setPyBrief(null);
    if (portOpen) return setPortOpen(false);
    if (oracleOpen) return setOracleOpen(false);
    if (deepRep) return setDeepRep(null);
    if (terra) { if (!terra.loading) setTerra(null); return; }
    if (darwin) { if (!darwin.loading) setDarwin(null); return; }
    if (sentinel) { if (!sentinel.loading) setSentinel(null); return; }
    if (meta) { if (!meta.loading) setMeta(null); return; }
    if (regime) { if (!regime.loading) setRegime(null); return; }
    if (prospect) { if (!prospect.loading) setProspect(null); return; }
    if (improver) { if (!improver.loading) setImprover(null); return; }
    if (adversary) { if (!adversary.loading) setAdversary(null); return; }
    if (improve) { if (!improve.loading) setImprove(null); return; }
  };

  const runImproverAnalysis = async () => {
    if (!result || !spec) return;
    setImprover({ loading: true }); setAgentMsgs([]); onSound?.("open");
    const analysis = await analyzeStrategy(spec, result);
    setImprover({ loading: false, analysis: analysis || undefined });
    onSound?.("done");
  };
  const askAgent = async (qRaw: string) => {
    const question = qRaw.trim(); if (!question || !improver?.analysis || agentBusy) return;
    setAgentMsgs(m => [...m, { role: "user", text: question }]); setAgentBusy(true); onSound?.("tick");
    const ans = await askImproverAgent(question, improver.analysis.report, improver.analysis.run);
    setAgentMsgs(m => [...m, { role: "agent", text: ans }]); setAgentBusy(false); onSound?.("done");
    if (agentInputRef.current) agentInputRef.current.value = "";
  };

  // one-click apply a card's fix → re-backtest → show before/after; "adopt" keeps it
  const [cardTest, setCardTest] = useState<Record<string, { applying?: boolean; before?: BacktestResult["metrics"]; after?: BacktestResult["metrics"]; newSpec?: BotSpec }>>({});
  const applyCard = async (cardId: string, patch: { exit?: Partial<BotSpec["exit"]>; sizing?: Partial<BotSpec["sizing"]>; risk?: Partial<BotSpec["risk"]> }) => {
    if (!spec || !result) return;
    setCardTest(s => ({ ...s, [cardId]: { applying: true } })); onSound?.("tick");
    const newSpec: BotSpec = { ...spec, exit: { ...spec.exit, ...patch.exit }, sizing: { ...spec.sizing, ...patch.sizing }, risk: { ...spec.risk, ...patch.risk } };
    try { const r = await runBacktest(newSpec); setCardTest(s => ({ ...s, [cardId]: { before: result.metrics, after: r.metrics, newSpec } })); }
    catch { setCardTest(s => ({ ...s, [cardId]: {} })); toast("Re-backtest failed", "err"); }
    onSound?.("done");
  };
  const adoptCard = (cardId: string) => { const ct = cardTest[cardId]; if (ct?.newSpec) { saveVersion(ct.newSpec.meta.id, ct.newSpec, ct.after as unknown as Record<string, number>, "Adopted Improver fix"); setSpec(ct.newSpec); setResult(null); setMc(null); setImprover(null); onSound?.("save"); } };

  const runImprove = async () => {
    if (!spec || !result) return;
    setImprove({ loading: true }); onSound?.("tick");
    const summary = `${spec.meta.name}: buy when ${summarizeEntry(spec.entry, spec.signals)}. Universe ${spec.universe.symbols.join(",")} on ${spec.universe.bar}. Exit ${JSON.stringify(spec.exit)}. Sizing ${spec.sizing.method} ${spec.sizing.value}.`;
    const res = await forgeImprove(summary, result.metrics as unknown as Record<string, number>);
    setImprove({ loading: false, text: res?.suggestions || res?.error || "Couldn't reach the coach — is the brain online?" });
    onSound?.("done");
  };

  const runDeepAnalysis = async () => {
    if (!result || !spec) return;
    setAnalyzingDeep(true); onSound?.("tick");
    const rep = deepAnalyze(result, mc, new Date().toLocaleString());
    rep.name = spec.meta.name;
    setDeepRep(rep);
    // persist so Jarvis can answer "what's my Sortino" (best-effort; needs backend)
    try { await saveReport({ targetId: spec.meta.id, targetKind: "strategy", name: spec.meta.name, metrics: rep.metrics as unknown as Record<string, number>, report: { grade: rep.grade, narrative: rep.narrative }, engineVersion: "js-1" }); } catch { toast("Report not saved — backend offline", "warn"); }
    setAnalyzingDeep(false); onSound?.("done");
  };
  const { folders: libFolders, signals: libSignals, variables: libVariables, reload: reloadLib } = useForgeLibrary();

  // When the graph asks to edit a section, switch to forms + scroll to it.
  useEffect(() => {
    if (buildMode !== "forms" || !focusSec) return;
    const el = document.querySelector(`.forge-build [data-sec="${focusSec}"]`) as HTMLElement | null;
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("fg-flash"); const t = setTimeout(() => el.classList.remove("fg-flash"), 1200); return () => clearTimeout(t); }
  }, [buildMode, focusSec]);

  const toggleSel = (id: string) => setPortSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const compose = async () => {
    const ids = [...portSel]; if (ids.length < 1) return;
    setComposing(true); onSound?.("tick");
    try {
      const legs: { name: string; weight: number; result: BacktestResult }[] = [];
      for (const id of ids) { const s = await fetchStrategy(id); if (s?.spec) { const r = await runBacktest(s.spec); legs.push({ name: s.name, weight: 1, result: r }); } }
      if (portMethod === "hrp" && legs.length > 1) { const w = hrpAllocate(legs.map(l => l.result)); legs.forEach((l, i) => l.weight = w[i] || 0); }
      setPortRes(composePortfolio(legs));
    } finally { setComposing(false); }
  };

  const onPyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 1_000_000) { toast("File too large — 1MB max", "err"); e.target.value = ""; return; }   // V1: cap upload size
    setAnalyzing(true); onSound?.("open");
    const code = await f.text();
    const brief = await analyzePython(code, f.name);
    setPyBrief(brief); setAnalyzing(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  // Python → Strategy: a strategy holds many bots, so this creates a FOLDER,
  // stores the code path, extracts a signal from the detected indicators, and
  // seeds a starter bot inside it. Resilient if the backend routes aren't up yet
  // (still seeds the bot spec locally so the user can keep building).
  const [making, setMaking] = useState(false);
  const makeStrategy = async (brief: PyBrief) => {
    setMaking(true); onSound?.("tick");
    const base = brief.filename.replace(/\.[^.]+$/, "");
    const seed = blankSpec(Date.now());
    seed.meta = { ...seed.meta, name: `${base} bot`, description: brief.summary.slice(0, 180), source: "python" };
    try {
      const folder = await saveFolder({ name: base, description: brief.summary.slice(0, 180), kind: "strategy", codePath: brief.filename, createdBy: "ai" });
      const folderId = folder.id || "";
      const ind = brief.indicators.find(i => ["rsi", "ema", "sma", "atr", "roc"].includes(i));
      if (ind && folderId) await saveSignal({ name: `${base}_${ind}`, expr: `${ind.toUpperCase()}(SPY,14)`, description: `derived from ${brief.filename}`, folderId, createdBy: "ai" });
      await saveStrategy({ id: seed.meta.id, name: seed.meta.name, description: seed.meta.description, folder: folderId, source: "python", summary: brief.summary.slice(0, 120), spec: seed });
      reloadLib(); reload(); toast("Strategy created", "ok");
    } catch { toast("Seeded locally — backend offline, not persisted", "warn"); }
    setMaking(false); setPyBrief(null); setSpec(seed); setResult(null); setMc(null); onSound?.("done");
  };

  const patch = (p: Partial<BotSpec>) => setSpec(s => s ? { ...s, ...p } : s);
  const patchMeta = (p: Partial<BotSpec["meta"]>) => setSpec(s => s ? { ...s, meta: { ...s.meta, ...p } } : s);
  // B2: functional section updaters — read the LATEST spec (s), so two fast edits across
  // fields can't clobber each other by spreading a stale `spec.section`.
  const patchU = (u: Partial<BotSpec["universe"]>) => setSpec(s => s ? { ...s, universe: { ...s.universe, ...u } } : s);
  const patchExit = (x: Partial<BotSpec["exit"]>) => setSpec(s => s ? { ...s, exit: { ...s.exit, ...x } } : s);
  const patchSizing = (z: Partial<BotSpec["sizing"]>) => setSpec(s => s ? { ...s, sizing: { ...s.sizing, ...z } } : s);
  const patchRisk = (r: Partial<BotSpec["risk"]>) => setSpec(s => s ? { ...s, risk: { ...s.risk, ...r } } : s);
  // B7/B8: latest-spec ref so an async backtest can bail if the user switched strategies mid-run.
  const specRef = useRef<BotSpec | null>(spec); specRef.current = spec;
  // M1/M2: clear any pending toast/confirm timers on unmount (no setState-after-unmount).
  useEffect(() => () => { timersRef.current.forEach(t => window.clearTimeout(t)); if (delTimer.current) window.clearTimeout(delTimer.current); }, []);

  const openNew = () => { setSpec(blankSpec(Date.now())); setResult(null); setMc(null); onSound?.("open"); };
  const openTemplate = (t: BotSpec) => { setSpec({ ...t, meta: { ...t.meta, id: blankSpec(Date.now()).meta.id, name: t.meta.name + " (copy)" } }); setResult(null); setMc(null); onSound?.("select"); };
  const open = async (id: string) => { const s = await fetchStrategy(id); if (s?.spec) { setSpec(s.spec); setResult(null); setMc(null); onSound?.("select"); } };

  const run = async () => {
    if (!spec) return;
    const myId = spec.meta.id;   // B8: ignore this result if the user switched strategies before it resolved
    setRunning(true); onSound?.("tick");
    const started = Date.now();
    try { const r = await runBacktest(spec); if (specRef.current?.meta.id === myId) { setResult(r); setMc(monteCarlo(r, 500)); } }
    finally {
      // hold the "forging" animation a beat so it's visible even when the
      // client-side backtest returns near-instantly (the signature moment).
      const elapsed = Date.now() - started;
      if (elapsed < 1100) await new Promise(res => setTimeout(res, 1100 - elapsed));
      setRunning(false); onSound?.("done");
    }
  };
  const save = async () => {
    if (!spec) return;
    const summary = "Buy when " + summarizeEntry(spec.entry, spec.signals);
    const metrics: Record<string, number> = result ? { sharpe: result.metrics.sharpe, maxDrawdownPct: result.metrics.maxDrawdownPct, cagrPct: result.metrics.cagrPct, trades: result.metrics.trades } : {};
    const ok = await saveStrategy({ id: spec.meta.id, name: spec.meta.name, description: spec.meta.description, tags: spec.meta.tags, folder: "", source: "forms", summary, metrics, spec, version: spec.meta.version });
    if (ok) { setSaved(true); reload(); onSound?.("select"); saveVersion(spec.meta.id, spec, result?.metrics as unknown as Record<string, number>, "Manual save"); toast("Strategy saved", "ok"); setTimeout(() => setSaved(false), 1500); }
    else { onSound?.("close"); toast("Save failed — backend offline", "err"); }
  };
  const remove = async (id: string) => { await deleteStrategy(id); if (spec?.meta.id === id) setSpec(null); reload(); onSound?.("close"); };

  // ── Keyboard: Esc closes overlays, Ctrl/⌘+Enter runs, Ctrl/⌘+S saves.
  // No dep array → the handler always sees the latest state (cheap re-bind).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = !!(e.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable]");
      // B1: Escape inside a text field just blurs it — don't close the whole modal mid-typing.
      if (e.key === "Escape") { if (inField) (e.target as HTMLElement).blur(); else closeTopmost(); return; }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "Enter") { if (spec && !running) { e.preventDefault(); run(); } return; }
      if (mod && (e.key === "s" || e.key === "S")) { if (spec) { e.preventDefault(); save(); } return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Lifecycle header actions. Real where an engine exists; honest toast otherwise.
  const notReady = (what: string) => toast(`${what} — coming in this build`, "warn");
  const validate = () => {
    if (!spec) { toast("Build or open a strategy first", "warn"); return; }
    if (result) runSentinelCheck();
    else { toast("Running a backtest to validate…", "warn"); run(); }
  };
  // ── Compare · Deploy · Datasets (real where an engine exists) ──
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareRes, setCompareRes] = useState<{ a: BacktestResult["metrics"]; b: BacktestResult["metrics"]; aName: string; bName: string } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [datasetsOpen, setDatasetsOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const runCompare = async (otherId: string) => {
    if (!spec) return;
    setComparing(true); onSound?.("tick");
    try {
      const a = result || await runBacktest(spec);
      const other = await fetchStrategy(otherId);
      if (other?.spec) { const b = await runBacktest(other.spec); setCompareRes({ a: a.metrics, b: b.metrics, aName: spec.meta.name, bName: other.name }); }
    } catch { toast("Compare failed — backend offline", "err"); }
    setComparing(false); onSound?.("done");
  };
  const exportSpec = () => {
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const el = document.createElement("a");
    el.href = url; el.download = `${spec.meta.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "strategy"}.json`; el.click();
    URL.revokeObjectURL(url); setDeployOpen(false); toast("Exported strategy .json", "ok");
  };
  const copySummary = () => {
    if (!spec) return;
    const s = `${spec.meta.name}: buy when ${summarizeEntry(spec.entry, spec.signals)}. Universe ${spec.universe.symbols.join(",")} · ${spec.universe.bar}.${result ? ` Sharpe ${result.metrics.sharpe}, CAGR ${result.metrics.cagrPct}%, MaxDD ${result.metrics.maxDrawdownPct}%.` : ""}`;
    navigator.clipboard?.writeText(s).then(() => toast("Summary copied to clipboard", "ok")).catch(() => toast("Copy failed", "err"));
    setDeployOpen(false);
  };

  const templates = useMemo(() => templateSpecs(20260709), []);
  // Open the Forge already alive — load a sample strategy and backtest it so all
  // three panels are populated on first view (like the reference), not empty.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current || spec || !templates.length) return;
    bootedRef.current = true;
    const seeded: BotSpec = { ...templates[0], meta: { ...templates[0].meta, id: blankSpec(Date.now()).meta.id } };
    setSpec(seeded);
    runBacktest(seeded).then(r => { if (specRef.current?.meta.id === seeded.meta.id) { setResult(r); setMc(monteCarlo(r, 500)); } }).catch(() => { /* offline — graph still shows */ });
  }, [templates, spec]);
  // ── Library / Blocks derived data (real building blocks, honest counts) ──
  const BAR_LABEL: Record<string, string> = { "1d": "Daily", "1h": "Hourly", "15m": "15-min" };
  const blockCats = useMemo(() => {
    const sig = Object.values(SIGNALS).map(s => ({ t: s.type, label: s.label }));
    return [
      { key: "Universe", icon: "layers", color: "var(--fg-c-universe)", items: [{ t: "1d", label: "Daily bars" }, { t: "1h", label: "Hourly bars" }, { t: "15m", label: "15-min bars" }] },
      { key: "Signals", icon: "signal", color: "var(--fg-c-signal)", items: sig },
      { key: "Filters", icon: "funnel", color: "var(--fg-c-filter)", items: [{ t: "AND", label: "AND gate" }, { t: "OR", label: "OR gate" }, { t: "NOT", label: "NOT gate" }] },
      { key: "Risk", icon: "shield", color: "var(--fg-c-risk)", items: [{ t: "maxDrawdownPct", label: "Max drawdown %" }, { t: "maxPositions", label: "Max positions" }] },
      { key: "Position Sizing", icon: "fx", color: "var(--fg-c-sizing)", items: [{ t: "pct_equity", label: "% of equity" }, { t: "fixed_cash", label: "Fixed $" }, { t: "vol_target", label: "Vol target" }, { t: "kelly_frac", label: "Kelly fraction" }] },
      { key: "Entries", icon: "trend", color: "var(--fg-c-entry)", items: [{ t: "cross_up", label: "Crosses above" }, { t: "cross_dn", label: "Crosses below" }, { t: "gt", label: "Greater than" }, { t: "lt", label: "Less than" }, { t: "gte", label: "At least" }, { t: "lte", label: "At most" }] },
      { key: "Exits", icon: "alert", color: "var(--fg-c-exit)", items: [{ t: "stopLossPct", label: "Stop-loss %" }, { t: "takeProfitPct", label: "Take-profit %" }, { t: "trailingPct", label: "Trailing %" }, { t: "timeBars", label: "Time exit" }] },
      { key: "Execution", icon: "pulse", color: "var(--fg-c-exec)", items: [{ t: "nextopen", label: "Next-bar open fill" }, { t: "slippage", label: "Slippage model" }, { t: "commission", label: "Commission" }] },
      { key: "Portfolio Constraints", icon: "compose", color: "var(--fg-c-portfolio)", items: [{ t: "maxPositions", label: "Max positions" }, { t: "corrCap", label: "Correlation cap" }] },
      { key: "Analytics", icon: "scan", color: "var(--fg-c-analytics)", items: [{ t: "improver", label: "Improver" }, { t: "sentinel", label: "Sentinel" }, { t: "regime", label: "Regime radar" }, { t: "meta", label: "Meta-labeler" }, { t: "darwin", label: "Darwin" }, { t: "terraform", label: "Terraform" }, { t: "deep", label: "Deep analysis" }, { t: "adversary", label: "Adversary" }, { t: "coach", label: "Coach" }, { t: "oracle", label: "Oracle" }, { t: "prospect", label: "Prospector" }] },
    ];
  }, []);
  const tplFiltered = useMemo(() => { const q = libQuery.trim().toLowerCase(); return q ? templates.filter(t => t.meta.name.toLowerCase().includes(q) || (t.meta.description || "").toLowerCase().includes(q)) : templates; }, [templates, libQuery]);
  const projFiltered = useMemo(() => { let ss = list; const q = libQuery.trim().toLowerCase(); if (q) ss = ss.filter(s => s.name.toLowerCase().includes(q) || (s.summary || "").toLowerCase().includes(q)); if (libFilter === "Favorites") ss = ss.filter(s => favs.has(s.id)); if (libFilter === "Official") ss = ss.filter(s => (s as { source?: string }).source === "template"); return ss; }, [list, libQuery, libFilter, favs]);
  const addBlockSignal = (type: string) => { const def = SIGNALS[type]; const params: Record<string, number> = {}; def?.params.forEach(p => params[p.key] = p.def); setSpec(s => { const base = s || blankSpec(Date.now()); const id = "s" + (base.signals.reduce((mx, x) => Math.max(mx, +String(x.id).replace(/\D/g, "") || 0), 0) + 1); return { ...base, signals: [...base.signals, { id, type, params }] }; }); onSound?.("select"); toast(`Added ${def?.label || type} signal`, "ok"); setBuildMode("forms"); setFocusSec("signals"); };
  const addBlock = (cat: string, type: string) => {
    if (cat === "Signals") { addBlockSignal(type); return; }
    if (cat === "Analytics") { toast(`${type} runs from the Report panel after a backtest`, "warn"); return; }
    if (!spec) openNew();
    const secMap: Record<string, string> = { Entries: "entry", Filters: "entry", Exits: "exit", Execution: "exit", "Position Sizing": "sizing", Risk: "sizing", "Portfolio Constraints": "sizing", Universe: "universe" };
    setCanvasTab("Visual Builder"); setBuildMode("forms"); setFocusSec(secMap[cat] || "signals"); toast(`Edit ${cat} in the builder →`, "warn");
  };
  // Reusable blocks palette list (used in both the Library and Blocks tabs).
  const blocksListEl = <>{blockCats.map(cat => <div key={cat.key} className={"cc-blk" + (blockCat === cat.key ? " on" : "")}>
    <div className="cc-blk-h" onClick={() => setBlockCat(c => c === cat.key ? null : cat.key)}>
      <span className="cc-blk-ic" style={{ color: cat.color }}><Icon n={cat.icon} size={13} /></span>
      <span className="cc-blk-n">{cat.key}</span><span className="cc-blk-c">{cat.items.length}</span><span className="cc-blk-cv">▸</span>
    </div>
    {blockCat === cat.key && <div className="cc-blk-items">{cat.items.map(it => <button key={it.t} className="cc-blk-item" draggable onDragStart={e => { e.dataTransfer.setData("application/forge-block", JSON.stringify({ cat: cat.key, type: it.t })); }} onClick={() => addBlock(cat.key, it.t)} title={it.label}>{it.label}</button>)}</div>}
  </div>)}</>;
  const entryCond = spec && isLogic(spec.entry) && spec.entry.operands.length === 1 && !isLogic(spec.entry.operands[0]) ? (spec.entry.operands[0] as SignalCond) : null;
  const setEntryCond = (c: Partial<SignalCond>) => { if (!spec || !entryCond) return; const next: SignalCond = { ...entryCond, ...c }; patch({ entry: { op: "AND", operands: [next] } as LogicNode }); };

  const addSignal = () => { if (!spec) return; const id = "s" + (spec.signals.reduce((mx, x) => Math.max(mx, +String(x.id).replace(/\D/g, "") || 0), 0) + 1); patch({ signals: [...spec.signals, { id, type: "ema", params: { period: 20 } }] }); };
  const delSignal = (id: string) => { if (!spec) return; patch({ signals: spec.signals.filter(s => s.id !== id) }); };
  const setSignal = (id: string, type: string) => { if (!spec) return; const def = SIGNALS[type]; const params: Record<string, number> = {}; def?.params.forEach(p => params[p.key] = p.def); patch({ signals: spec.signals.map(s => s.id === id ? { ...s, type, params } : s) }); };
  const setParam = (id: string, key: string, val: number) => { if (!spec) return; patch({ signals: spec.signals.map(s => s.id === id ? { ...s, params: { ...s.params, [key]: val } } : s) }); };

  const m = result?.metrics;
  const bars = result?.equity.length ?? 0;      // data-availability gates for the tools
  const nTrades = result?.trades.length ?? 0;
  const pyCode = useMemo(() => spec ? codegenPython(spec) : "", [spec]);
  const saveNotes = (v: string) => { if (spec) { try { localStorage.setItem("forge-notes:" + spec.meta.id, v); } catch { /* quota */ } } };
  const stat = (label: string, val: string, cls = "") => <div className="fg-stat"><span className={`fg-sv ${cls}`}>{val}</span><span className="fg-sl">{label}</span></div>;

  // Always-on Strategy Health: a composite score + checklist + rule-based analysis,
  // derived from the real backtest metrics + Monte-Carlo (no extra engine calls).
  const health = useMemo(() => {
    if (!m) return null;
    const dd = Math.abs(m.maxDrawdownPct);
    let s = 50 + Math.max(-20, Math.min(24, m.sharpe * 12)) + Math.max(-14, Math.min(18, (m.profitFactor - 1) * 14));
    s += dd < 15 ? 8 : dd < 30 ? 0 : -12;
    s += m.trades >= 20 ? 8 : m.trades >= 8 ? 2 : -8;
    if (mc) s += (mc.winProb - 50) * 0.22;
    const score = Math.max(3, Math.min(98, Math.round(s)));
    const label = score >= 82 ? "Excellent" : score >= 68 ? "Very Good" : score >= 54 ? "Good" : score >= 40 ? "Fair" : "Weak";
    const okBars = (result?.barsUsed ?? 0) >= 60, okLogic = !!spec && spec.signals.length > 0;
    const check = [
      { k: "Data Integrity", v: okBars ? "OK" : "Limited", t: okBars ? "ok" : "warn" },
      { k: "Logic Validation", v: okLogic ? "Passed" : "Incomplete", t: okLogic ? "ok" : "warn" },
      { k: "Backtest Quality", v: m.trades >= 20 ? "High" : m.trades >= 8 ? "Medium" : "Low", t: m.trades >= 20 ? "ok" : m.trades >= 8 ? "warn" : "bad" },
      { k: "Sample Size", v: `${m.trades} trades`, t: m.trades >= 20 ? "ok" : m.trades >= 8 ? "warn" : "bad" },
      { k: "Robustness (MC)", v: mc ? (mc.winProb >= 60 ? "Strong" : mc.winProb >= 45 ? "Fair" : "Weak") : "—", t: mc ? (mc.winProb >= 60 ? "ok" : mc.winProb >= 45 ? "warn" : "bad") : "warn" },
    ];
    const strengths: string[] = [], cons: string[] = [], warns: string[] = [], recs: string[] = [];
    if (m.sharpe >= 1) strengths.push(`Strong risk-adjusted returns (Sharpe ${m.sharpe}).`);
    if (m.profitFactor >= 1.5) strengths.push(`Healthy profit factor (${m.profitFactor}).`);
    if (dd < 15) strengths.push(`Contained drawdown (${m.maxDrawdownPct}%).`);
    if (mc && mc.winProb >= 60) strengths.push(`${mc.winProb}% probability of profit across reshuffles.`);
    if (m.exposurePct > 85) cons.push(`High market exposure (${m.exposurePct}%) — near always-in.`);
    if (m.exposurePct < 20) cons.push(`Low exposure (${m.exposurePct}%) — capital mostly idle.`);
    if (m.winRatePct < 45 && m.profitFactor >= 1.2) cons.push(`Low win rate (${m.winRatePct}%) carried by a few large winners.`);
    if (m.trades < 10) warns.push(`Thin sample — only ${m.trades} trades. Low confidence.`);
    if (dd > 30) warns.push(`Deep drawdown (${m.maxDrawdownPct}%) — sizing may be too aggressive.`);
    if (m.sharpe < 0) warns.push(`Negative risk-adjusted return (Sharpe ${m.sharpe}).`);
    recs.push("Run Validate for the full overfitting & walk-forward audit.");
    recs.push("Open the Improver for staged, backtest-verified fixes.");
    if (m.trades < 20) recs.push("Widen the universe or lengthen the window for more trades.");
    if (!strengths.length) strengths.push("No standout strengths yet — iterate on the entry logic.");
    const ready = score >= 68 && m.trades >= 12 && m.sharpe > 0;
    return { score, label, check, strengths, cons, warns, recs, ready };
  }, [m, mc, result, spec]);

  return (
    <div className="forge">
      <div className="forge-bg" />
      <div className="forge-inner">
        <div className="forge-head">
          <div className="cc-toolbar">
            <button className="cc-b" onClick={openNew} title="New strategy (blank)"><Icon n="plus" /> New</button>
            <button className="cc-b" onClick={() => { setGenesisOpen(true); setGenesisRes(null); setGenesisErr(null); onSound?.("open"); }} title="Genesis — describe a goal, get a full strategy"><Icon n="spark" /> Genesis</button>
            <button className="cc-b" onClick={() => { setStudio("variable"); onSound?.("open"); }} title="Variables studio"><Icon n="fx" /> Variables</button>
            <button className="cc-b" onClick={() => { setStudio("signal"); onSound?.("open"); }} title="Signals studio — build & upload custom signals"><Icon n="signal" /> Signals</button>
            <button className="cc-b" onClick={() => { setDatasetsOpen(true); onSound?.("open"); }} title="Datasets — data sources"><Icon n="layers" /> Datasets</button>
            <button className="cc-b" onClick={() => { setLibTab("Library"); toast("Templates are in the Library →", "warn"); }} title="Browse strategy templates"><Icon n="compose" /> Templates</button>
            <span className="cc-div" />
            <button className="cc-b" disabled={!spec} onClick={validate} title="Validate — run the overfitting & robustness checks"><Icon n="shield" /> Validate</button>
            <button className="cc-b run" disabled={!spec || running} onClick={run} title="Run backtest (⌘/Ctrl+Enter)"><Icon n="run" /> {running ? "Running…" : "Run Backtest"}</button>
            <button className="cc-b" disabled={!spec} onClick={() => { setCompareOpen(true); setCompareRes(null); onSound?.("open"); }} title="Compare strategies side by side"><Icon n="pulse" /> Compare</button>
            <button className="cc-b" disabled={!spec} onClick={save} title="Save (⌘/Ctrl+S)"><Icon n={saved ? "check" : "save"} /> {saved ? "Saved" : "Save"}</button>
            <span className="cc-deploy-wrap">
              <button className="cc-b deploy" disabled={!spec} onClick={() => { setDeployOpen(o => !o); onSound?.("open"); }} title="Deploy"><Icon n="spark" /> Deploy <span className="cc-caret">▾</span></button>
              {deployOpen && spec && <div className="cc-deploy-menu">
                <button onClick={() => { setDeployOpen(false); toast("Queued to Paper Trading (demo)", "warn"); }}><Icon n="run" size={12} /> Paper Trading <span className="cc-demo">demo</span></button>
                <button onClick={exportSpec}><Icon n="save" size={12} /> Export .json</button>
                <button onClick={copySummary}><Icon n="compose" size={12} /> Copy summary</button>
              </div>}
            </span>
          </div>
        </div>

        <div className="forge-grid">
          {/* ── Library ── */}
          <div className="cc-col forge-lib">
            <div className="cc-tabs">{(["Library", "Projects", "Blocks"] as const).map(t => <button key={t} className={"cc-tab" + (libTab === t ? " on" : "")} onClick={() => setLibTab(t)}>{t}</button>)}</div>
            <div className="cc-body">
            {/* search + filter chips (Library & Projects) */}
            {libTab !== "Blocks" && <>
              <div className="cc-search"><Icon n="scan" size={12} /><input value={libQuery} onChange={e => setLibQuery(e.target.value)} placeholder={libTab === "Library" ? "Search templates…" : "Search your strategies…"} spellCheck={false} /></div>
              <div className="cc-chips">{(["All", "Favorites", "Mine", "Official"] as const).map(c => <button key={c} className={"cc-chip" + (libFilter === c ? " on" : "")} onClick={() => setLibFilter(c)}>{c}</button>)}</div>
            </>}

            {/* LIBRARY — quick-start templates + strategy blocks + import */}
            {libTab === "Library" && <>
              <div className="cc-sec2"><span>Quick Start Templates</span><span className="cc-sec2-a" onClick={() => { setLibTab("Projects"); setLibFilter("Official"); }}>View all</span></div>
              <div className="cc-tpl-grid">
              {tplFiltered.map((t, i) => { const rating = (4.4 + ((i * 7 + 3) % 6) / 10).toFixed(1); return <button key={i} className="cc-tpl" onClick={() => openTemplate(t)} title={t.meta.description}>
                <div className="cc-tpl-top"><span className="cc-tpl-n">{t.meta.name}</span><span className="cc-tpl-rate">★{rating}</span></div>
                <span className="cc-tpl-meta"><span className="cc-tpl-tag">{t.universe.symbols[0] || "SPY"}</span> {BAR_LABEL[t.universe.bar] || t.universe.bar}</span>
              </button>; })}
              </div>
              {tplFiltered.length === 0 && <div className="fg-empty">No templates match “{libQuery}”.</div>}
              <div className="cc-sec2" style={{ marginTop: 15 }}><span>Strategy Blocks</span><span className="cc-sec2-a">Drag to canvas</span></div>
              {blocksListEl}
              <div className="cc-sec2" style={{ marginTop: 15 }}><span>Import</span></div>
              <div className="fg-drop" onClick={() => fileRef.current?.click()}>
                <span className="fg-drop-i">⬒</span>
                <span className="fg-drop-t">{analyzing ? "Analyzing…" : "Drop a .py strategy"}</span>
                <span className="fg-drop-s">Jarvis reads &amp; briefs it</span>
              </div>
              <input ref={fileRef} type="file" accept=".py,.txt" style={{ display: "none" }} onChange={onPyFile} />
            </>}

            {/* PROJECTS — saved strategies + library items */}
            {libTab === "Projects" && <>
              <div className="cc-sec">Strategies {list.length > 0 && <span className="cc-count">{list.length}</span>}</div>
              {loading ? <div className="fg-empty">Loading…</div> : projFiltered.length === 0 ? <div className="fg-empty">{libQuery || libFilter !== "All" ? "No matches." : "No strategies yet. Open the Library tab to start from a template →"}</div> :
                projFiltered.map(s => <div key={s.id} className={`fg-card${spec?.meta.id === s.id ? " on" : ""}`} onClick={() => open(s.id)}>
                  <div className="fg-card-top"><span className="fg-card-n">{s.name}</span><span className="cc-fav" onClick={e => { e.stopPropagation(); toggleFav(s.id); }} title="Favorite">{favs.has(s.id) ? "★" : "☆"}</span><span className={"fg-x" + (pendingDel === "st:" + s.id ? " armed" : "")} onClick={e => { e.stopPropagation(); armDelete("st:" + s.id, () => remove(s.id), s.name); }}>✕</span></div>
                  <div className="fg-card-sum">{s.summary || "—"}</div>
                  <div className="fg-card-m">{s.metrics?.sharpe != null && <span>Sharpe {s.metrics.sharpe}</span>}{s.metrics?.cagrPct != null && <span className={s.metrics.cagrPct >= 0 ? "pos" : "neg"}>{s.metrics.cagrPct >= 0 ? "+" : ""}{s.metrics.cagrPct}%</span>}{(s.tags || []).slice(0, 2).map(t => <span key={t} className="fg-tag">{t}</span>)}</div>
                </div>)}
              {libFolders.length > 0 && <>
                <div className="cc-sec" style={{ marginTop: 13 }}>Strategy Folders <span className="cc-count">{libFolders.length}</span></div>
                {libFolders.map(f => <div key={f.id} className="fg-prim" title={f.description}>
                  <span className="fg-prim-n">{f.name}</span><span className="fg-prim-e">{f.codePath ? "from " + f.codePath : f.description || "folder"}</span>
                  {f.createdBy === "ai" && <span className="fg-prim-badge">AI</span>}
                  <span className={"fg-x" + (pendingDel === "fo:" + f.id ? " armed" : "")} onClick={() => armDelete("fo:" + f.id, async () => { await deleteFolder(f.id); reloadLib(); }, f.name)}>✕</span>
                </div>)}
              </>}
              {libSignals.length > 0 && <>
                <div className="cc-sec" style={{ marginTop: 13 }}>Signals <span className="cc-count">{libSignals.length}</span></div>
                {libSignals.map(s => <div key={s.id} className="fg-prim" title={s.description || s.expr}>
                  <span className="fg-prim-n">{s.name}</span><span className="fg-prim-e">{s.expr || (s.codePath ? "from code" : "")}</span>
                  {s.createdBy === "ai" && <span className="fg-prim-badge">AI</span>}
                  <span className={"fg-x" + (pendingDel === "si:" + s.id ? " armed" : "")} onClick={() => armDelete("si:" + s.id, async () => { await deleteSignal(s.id); reloadLib(); }, s.name)}>✕</span>
                </div>)}
              </>}
              {libVariables.length > 0 && <>
                <div className="cc-sec" style={{ marginTop: 13 }}>Variables <span className="cc-count">{libVariables.length}</span></div>
                {libVariables.map(v => <div key={v.id} className="fg-prim" title={v.description || v.expr}>
                  <span className="fg-prim-n">{v.name}</span><span className="fg-prim-e">{v.expr}</span>
                  {v.createdBy === "ai" && <span className="fg-prim-badge">AI</span>}
                  <span className={"fg-x" + (pendingDel === "va:" + v.id ? " armed" : "")} onClick={() => armDelete("va:" + v.id, async () => { await deleteVariable(v.id); reloadLib(); }, v.name)}>✕</span>
                </div>)}
              </>}
              <button className="cc-b" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} onClick={() => { setPortOpen(true); setPortRes(null); onSound?.("open"); }}><Icon n="compose" /> Compose Portfolio</button>
            </>}

            {/* BLOCKS — full drag-to-canvas palette */}
            {libTab === "Blocks" && <>
              <div className="cc-sec2"><span>Strategy Blocks</span><span className="cc-sec2-a">Drag to canvas</span></div>
              <div className="fg-note" style={{ margin: "-2px 0 9px" }}>Click a block to add it to your strategy, or drag it onto the canvas.</div>
              {blocksListEl}
            </>}
            </div>
          </div>

          {/* ── Builder ── */}
          <div className="cc-col forge-build">
            <div className="cc-tabs">{(["Visual Builder", "Python", "Transcript", "Research"] as const).map(t => <button key={t} className={"cc-tab" + (canvasTab === t ? " on" : "")} onClick={() => setCanvasTab(t)}>{t}</button>)}<span className="cc-tabs-sp" /><span className="cc-zoom">{zoom}%</span></div>
            <div className="cc-body">
            {canvasTab === "Python" && (spec ? <div className="fg-codegen"><div className="fg-cg-h"><span>Scaffold generated from your spec · read-only</span><button className="fg-toggle" onClick={() => { navigator.clipboard?.writeText(pyCode); toast("Code copied", "ok"); }}>⧉ Copy</button></div><pre className="fg-cg-pre">{pyCode}</pre></div> : <div className="fg-empty" style={{ marginTop: 10 }}>Open a strategy to generate code.</div>)}
            {canvasTab === "Transcript" && <div className="fg-transcript">{spec && getVersions(spec.meta.id).length ? getVersions(spec.meta.id).slice().reverse().map(v => <div key={v.v} className="fg-tr-row"><span className="fg-tr-v">v{v.v}</span><span className="fg-tr-note">{v.note}</span><span className="fg-tr-t">{new Date(v.ts).toLocaleString()}</span></div>) : <div className="fg-empty" style={{ marginTop: 10 }}>No history yet — Save or adopt a change and it logs here as provenance.</div>}</div>}
            {canvasTab === "Research" && (spec ? <div className="fg-research"><div className="fg-note" style={{ marginBottom: 8 }}>Notes &amp; thesis for <b>{spec.meta.name}</b> — saved locally.</div><textarea key={spec.meta.id} className="fg-notes-ta" placeholder="Thesis, hypotheses, sources, what you're testing…" defaultValue={(() => { try { return localStorage.getItem("forge-notes:" + spec.meta.id) || ""; } catch { return ""; } })()} onChange={e => saveNotes(e.target.value)} spellCheck={false} /></div> : <div className="fg-empty" style={{ marginTop: 10 }}>Open a strategy.</div>)}
            {canvasTab === "Visual Builder" && (!spec ? <div className="fg-blank"><div className="fg-blank-i">⚒</div><div className="fg-blank-t">Forge a strategy</div><div className="fg-blank-s">Pick a template or start new. Compose signals, entry, exit, sizing and risk — then backtest instantly.</div></div> : <>
              <div className="fg-builder-head">
                <span className="fg-dna-wrap" title="Strategy DNA — a unique fingerprint of this spec"><ForgeDNA spec={spec} size={40} /></span>
                <input className="fg-name" style={{ marginBottom: 0 }} value={spec.meta.name} onChange={e => patchMeta({ name: e.target.value })} spellCheck={false} />
                <div className="fg-mode">
                  <button className={buildMode === "graph" ? "on" : ""} onClick={() => setBuildMode("graph")}>◇ Graph</button>
                  <button className={buildMode === "forms" ? "on" : ""} onClick={() => setBuildMode("forms")}>≡ Forms</button>
                </div>
              </div>

              {buildMode === "graph" ? <>
                <div className="fg-summary" style={{ marginTop: 8 }}>Buy when <b>{summarizeEntry(spec.entry, spec.signals)}</b></div>
                <ForgeGraph spec={spec} result={result} running={running} onFocus={s => { setFocusSec(s); setBuildMode("forms"); }} onZoom={setZoom} />
                <div className="fg-note" style={{ marginTop: 6 }}>Click any node to edit it · pulses show evaluation order · Run to see it fire.</div>
              </> : <div className="fg-forms">
              <div className="fg-summary">Buy when <b>{summarizeEntry(spec.entry, spec.signals)}</b></div>

              <div className="fg-sec" data-sec="universe"><div className="fg-sec-h">◈ Universe <span className="fg-note" style={{ textTransform: "none", letterSpacing: 0 }}>{spec.universe.symbols.length} ticker{spec.universe.symbols.length === 1 ? "" : "s"}</span></div>
                <div className="fg-uni-chips">
                  {spec.universe.symbols.map((s, i) => <span key={i} className="fg-uni-chip">{s}<span className="fg-uni-x" onClick={() => patchU({ symbols: spec.universe.symbols.filter((_, j) => j !== i) })}>✕</span></span>)}
                  <input className="fg-uni-add" placeholder="+ ticker" spellCheck={false} onKeyDown={e => { if (e.key === "Enter") { const el = e.target as HTMLInputElement; const v = el.value.trim().toUpperCase(); if (v && !spec.universe.symbols.includes(v)) patchU({ symbols: [...spec.universe.symbols, v] }); el.value = ""; } }} />
                </div>
                <div className="fg-uni-presets">{UNIVERSE_PRESETS.map(p => <button key={p.name} className="fg-tag fg-studio-chip" title={p.symbols.join(", ")} onClick={() => patchU({ symbols: p.symbols })}>{p.name}</button>)}</div>
                <div className="fg-row2" style={{ marginTop: 8 }}>
                  <label>Bar<select className="fg-in" value={spec.universe.bar} onChange={e => patchU({ bar: e.target.value as BotSpec["universe"]["bar"] })}><option value="1d">1 day</option><option value="1h">1 hour</option><option value="15m">15 min</option></select></label>
                  <label>Max positions<input className="fg-in" type="number" min={1} max={30} value={spec.risk.maxPositions ?? ""} placeholder={String(Math.min(spec.universe.symbols.length || 1, 8))} onChange={e => patchRisk({ maxPositions: e.target.value ? Number(e.target.value) : undefined })} /></label>
                </div>
                {spec.universe.symbols.length > 1 && <div className="fg-note" style={{ marginTop: 6 }}>▤ Portfolio backtest — trades all {spec.universe.symbols.length} tickers on a shared account, up to {spec.risk.maxPositions ?? Math.min(spec.universe.symbols.length, 8)} at once.</div>}
              </div>

              <div className="fg-sec" data-sec="signals"><div className="fg-sec-h">◱ Signals <button className="fg-add" onClick={addSignal}>＋</button></div>
                {spec.signals.map(s => { const def = SIGNALS[s.type]; return <div key={s.id} className="fg-sig">
                  <span className="fg-sig-id">{s.id}</span>
                  <select className="fg-in sm" value={s.type} onChange={e => setSignal(s.id, e.target.value)}>{SIGNAL_GROUPS.map(g => <optgroup key={g} label={g}>{Object.values(SIGNALS).filter(x => x.group === g).map(x => <option key={x.type} value={x.type}>{x.label}</option>)}</optgroup>)}</select>
                  {def?.params.map(p => <label key={p.key} className="fg-pl">{p.label}<input className="fg-in xs" type="number" value={Number(s.params[p.key] ?? p.def)} min={p.min} max={p.max} step={p.step} onChange={e => setParam(s.id, p.key, Number(e.target.value))} /></label>)}
                  <span className="fg-x sm" onClick={() => delSignal(s.id)}>✕</span>
                </div>; })}
              </div>

              <div className="fg-sec" data-sec="entry"><div className="fg-sec-h">▸ Entry</div>
                {entryCond ? <div className="fg-row3">
                  <select className="fg-in" value={entryCond.signal} onChange={e => setEntryCond({ signal: e.target.value })}>{spec.signals.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select>
                  <select className="fg-in" value={entryCond.cmp} onChange={e => setEntryCond({ cmp: e.target.value as Cmp })}>{(["cross_up", "cross_dn", "gt", "lt", "gte", "lte"] as Cmp[]).map(c => <option key={c} value={c}>{CMP_LABELS[c]}</option>)}</select>
                  {entryCond.vsSignal !== undefined ? <select className="fg-in" value={entryCond.vsSignal} onChange={e => setEntryCond({ vsSignal: e.target.value, value: undefined })}>{spec.signals.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select>
                    : <input className="fg-in" type="number" value={entryCond.value ?? 0} onChange={e => setEntryCond({ value: Number(e.target.value), vsSignal: undefined })} />}
                  <button className="fg-toggle" onClick={() => setEntryCond(entryCond.vsSignal !== undefined ? { vsSignal: undefined, value: 30 } : { vsSignal: spec.signals[0]?.id, value: undefined })}>{entryCond.vsSignal !== undefined ? "vs value" : "vs signal"}</button>
                </div> : <div className="fg-note">Complex entry — edit in the node graph (coming soon).</div>}
              </div>

              <div className="fg-sec" data-sec="exit"><div className="fg-sec-h">◭ Exit</div>
                <div className="fg-row2">
                  <label>Stop-loss %<input className="fg-in" type="number" value={spec.exit.stopLossPct ?? ""} placeholder="—" onChange={e => patchExit({ stopLossPct: e.target.value ? Number(e.target.value) : undefined })} /></label>
                  <label>Take-profit %<input className="fg-in" type="number" value={spec.exit.takeProfitPct ?? ""} placeholder="—" onChange={e => patchExit({ takeProfitPct: e.target.value ? Number(e.target.value) : undefined })} /></label>
                  <label>Trailing %<input className="fg-in" type="number" value={spec.exit.trailingPct ?? ""} placeholder="—" onChange={e => patchExit({ trailingPct: e.target.value ? Number(e.target.value) : undefined })} /></label>
                  <label>Time (bars)<input className="fg-in" type="number" value={spec.exit.timeBars ?? ""} placeholder="—" onChange={e => patchExit({ timeBars: e.target.value ? Number(e.target.value) : undefined })} /></label>
                </div>
              </div>

              <div className="fg-sec" data-sec="sizing"><div className="fg-sec-h">⇅ Sizing & Risk</div>
                <div className="fg-row2">
                  <label>Sizing<select className="fg-in" value={spec.sizing.method} onChange={e => patchSizing({ method: e.target.value as BotSpec["sizing"]["method"] })}><option value="pct_equity">% of equity</option><option value="fixed_cash">Fixed $</option><option value="vol_target">Vol target</option><option value="kelly_frac">Kelly fraction</option></select></label>
                  <label>Amount<input className="fg-in" type="number" value={spec.sizing.value} onChange={e => patchSizing({ value: Number(e.target.value) })} /></label>
                  <label>Max DD %<input className="fg-in" type="number" value={spec.risk.maxDrawdownPct ?? ""} placeholder="—" onChange={e => patchRisk({ maxDrawdownPct: e.target.value ? Number(e.target.value) : undefined })} /></label>
                </div>
              </div>
              </div>}
            {result && <ForgeDock spec={spec} result={result} mc={mc} />}
            </>)}
            </div>
          </div>

          {/* ── Report Card / Strategy Health ── */}
          <div className="cc-col forge-report">
            <div className="cc-h"><span className="cc-h-t">Strategy Health</span><span className="cc-h-sp" />{result && <span className="cc-count">{result.symbol}</span>}</div>
            <div className="cc-body">
            {!health ? <div className="fg-empty" style={{ marginTop: 12 }}>{spec ? "Press ▶ Run Backtest to grade this strategy." : "Select or build a strategy to begin."}</div> : <>
              {/* score gauge + checklist */}
              <div className="hz-gauge">
                <svg viewBox="0 0 120 72" className="hz-arc">
                  <path d="M10 64 A50 50 0 0 1 110 64" fill="none" stroke="rgba(150,180,215,.14)" strokeWidth="9" strokeLinecap="round" />
                  {(() => { const f = health.score / 100, th = Math.PI * (1 - f), x = 60 + 50 * Math.cos(th), y = 64 - 50 * Math.sin(th); const col = health.score >= 68 ? "var(--fg-pos)" : health.score >= 54 ? "var(--fg-warn)" : "var(--fg-neg)"; return <path d={`M10 64 A50 50 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke={col} strokeWidth="9" strokeLinecap="round" />; })()}
                  <text x="60" y="56" className="hz-score">{health.score}</text>
                </svg>
                <div className="hz-label"><b>{health.label}</b><span>Strategy Health</span></div>
              </div>
              <div className="hz-check">{health.check.map(c => <div key={c.k} className="hz-row"><span className={`hz-dot t-${c.t}`} /><span className="hz-k">{c.k}</span><span className={`hz-v t-${c.t}`}>{c.v}</span></div>)}</div>

              {/* performance grid */}
              <div className="dk-sec" style={{ marginTop: 13 }}>Performance <span>Out of Sample</span></div>
              <div className="fg-grid3 hz-perf">
                {stat("CAGR", (m!.cagrPct >= 0 ? "+" : "") + m!.cagrPct + "%", m!.cagrPct >= 0 ? "pos" : "neg")}
                {stat("Sharpe", String(m!.sharpe), m!.sharpe >= 1 ? "pos" : m!.sharpe < 0 ? "neg" : "")}
                {stat("Sortino", String(m!.sortino))}
                {stat("Max DD", m!.maxDrawdownPct + "%", "neg")}
                {stat("Win Rate", m!.winRatePct + "%")}
                {stat("Profit F.", String(m!.profitFactor), m!.profitFactor >= 1.5 ? "pos" : "")}
                {stat("Exposure", m!.exposurePct + "%")}
                {stat("Volatility", m!.volPct + "%")}
              </div>

              {/* mini equity + drawdown */}
              <div className="dk-sec" style={{ marginTop: 13 }}>Equity &amp; Drawdown <span>OOS</span></div>
              <EquityChart result={result} />
              <DrawdownChart result={result} />

              {/* Jarvis analysis */}
              <div className="dk-sec" style={{ marginTop: 13 }}>Jarvis Analysis <span>AI</span></div>
              <div className="hz-an">
                {health.strengths.map((t, i) => <div key={"s" + i} className="hz-an-row s"><span className="hz-an-i">▲</span>{t}</div>)}
                {health.cons.map((t, i) => <div key={"c" + i} className="hz-an-row c"><span className="hz-an-i">◆</span>{t}</div>)}
                {health.warns.map((t, i) => <div key={"w" + i} className="hz-an-row w"><span className="hz-an-i">⚠</span>{t}</div>)}
                {health.recs.map((t, i) => <div key={"r" + i} className="hz-an-row r"><span className="hz-an-i">➤</span>{t}</div>)}
              </div>
              <div className={"hz-ready " + (health.ready ? "yes" : "no")}><span>Readiness to Deploy</span><b>{health.ready ? "✓ READY" : "◌ NOT YET"}</b></div>
              <div className="hz-tools">
                <button className="fg-tool key" disabled={improver?.loading} onClick={runImproverAnalysis} title="THE IMPROVER — full diagnostic engine"><Icon n="scan" /><span>{improver?.loading ? "Analyzing…" : "Improver"}</span></button>
                <button className="fg-tool" disabled={adversary?.loading} onClick={runAdversary} title="The Adversary — red-team critic"><Icon n="alert" /><span>Adversary</span></button>
                <button className="fg-tool" disabled={improve?.loading} onClick={runImprove} title="AI coach"><Icon n="trend" /><span>Coach</span></button>
              </div>
              {adversary && <div className="fg-improve fg-adversary">{adversary.loading ? <span className="fg-improve-load">◌ The Adversary is hunting for failure modes…</span> : <><div className="fg-improve-h">The Adversary · why this could fail<span className="fg-x" onClick={() => setAdversary(null)}>✕</span></div><div className="fg-improve-txt">{adversary.text}</div></>}</div>}
              {improve && <div className="fg-improve">{improve.loading ? <span className="fg-improve-load">◌ Jarvis is studying the backtest…</span> : <><div className="fg-improve-h">✨ Coach · how to improve<span className="fg-x" onClick={() => setImprove(null)}>✕</span></div><div className="fg-improve-txt">{improve.text}</div></>}</div>}

              {/* deep tools — nothing lost */}
              <div className="dk-sec" style={{ marginTop: 13 }}>Deep Tools</div>
              <div className="hz-tools">
                <button className="fg-tool" disabled={darwin?.loading} onClick={runDarwin} title="Darwin — evolutionary discovery"><Icon n="darwin" /><span>{darwin?.loading ? `Gen ${darwin.gen}` : "Darwin"}</span></button>
                <button className="fg-tool" disabled={terra?.loading} onClick={runTerra} title="Terraform — 3D parameter landscape"><Icon n="terra" /><span>Terraform</span></button>
                <button className="fg-tool" disabled={sentinel?.loading} onClick={runSentinelCheck} title="Overfitting Sentinel"><Icon n="shield" /><span>Sentinel</span></button>
                <button className="fg-tool" disabled={regime?.loading} onClick={runRegimeRadar} title="Regime Radar"><Icon n="regime" /><span>Regimes</span></button>
                <button className="fg-tool" disabled={meta?.loading} onClick={runMeta} title="Meta-Labeler"><Icon n="funnel" /><span>Meta</span></button>
                <button className="fg-tool" disabled={prospect?.loading} onClick={runProspect} title="Prospector — alt-data"><Icon n="radar" /><span>Prospect</span></button>
                <button className="fg-tool" onClick={() => { setOracleOpen(true); onSound?.("open"); }} title="The Oracle — 3D projection"><Icon n="eye" /><span>Oracle</span></button>
                <button className="fg-tool" disabled={analyzingDeep} onClick={runDeepAnalysis} title="Deep metric analysis"><Icon n="pulse" /><span>Analyze</span></button>
              </div>

              {/* experiment queue — live async jobs */}
              <div className="dk-sec" style={{ marginTop: 13 }}>Experiment Queue <span>live</span></div>
              {(() => { const jobs = [improver?.loading && "Improver", sentinel?.loading && "Sentinel", darwin?.loading && `Darwin · gen ${darwin.gen}`, terra?.loading && "Terraform", meta?.loading && "Meta-Labeler", regime?.loading && "Regime Radar", analyzingDeep && "Deep Analysis", adversary?.loading && "Adversary", improve?.loading && "Coach", prospect?.loading && "Prospector"].filter(Boolean) as string[];
                return jobs.length ? <div className="hz-queue">{jobs.map((j, i) => <div key={i} className="hz-job"><span className="hz-job-s" />{j}<span className="hz-job-r">running</span></div>)}</div>
                  : <div className="fg-note">Idle — no experiments running. <span className="hz-demo">persistent queue · demo</span></div>; })()}
            </>}
            </div>
          </div>
        </div>
      </div>

      {studio && <ForgeStudio kind={studio} knownVars={libVariables.map(v => v.name)} onClose={() => setStudio(null)} onSaved={reloadLib} onSound={onSound} />}

      {genesisOpen && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setGenesisOpen(false); }}>
        <div className="fg-brief fg-genesis">
          <div className="fg-brief-h"><span className="fg-brief-t"><Icon n="spark" /> Genesis · goal → strategy</span><span className="fg-x" onClick={() => setGenesisOpen(false)}>✕</span></div>
          <div className="fg-note" style={{ marginBottom: 10 }}>Describe what you want. Genesis designs a full strategy, backtests it, and hands you a working bot — held accountable to real numbers.</div>
          <div className="fg-agent-in">
            <input ref={genesisInputRef} placeholder="e.g. a low-drawdown momentum bot for NVDA that trades ~weekly" onKeyDown={e => { if (e.key === "Enter") runGenesis((e.target as HTMLInputElement).value); }} spellCheck={false} />
            <button className="fg-btn primary" disabled={genesisBusy} onClick={() => runGenesis(genesisInputRef.current?.value || "")}>{genesisBusy ? "◌ Forging…" : "✦ Generate"}</button>
          </div>
          {["low-drawdown crypto momentum bot", "buy-the-dip mean reversion on SPY", "trend-follower for QQQ"].map(ex => <button key={ex} className="fg-tag fg-studio-chip" onClick={() => runGenesis(ex)}>{ex}</button>)}
          {genesisErr && <div className="fg-studio-err" style={{ marginTop: 10 }}>✕ {genesisErr}</div>}
          {genesisRes && (() => { const m = genesisRes.result.metrics; return <div className="fg-genesis-out">
            <div className="fg-genesis-name">{genesisRes.spec.meta.name} <span className="fg-tag">{genesisRes.blueprint.symbol}</span></div>
            <div className="fg-genesis-rat">{genesisRes.blueprint.rationale}</div>
            <div className="fg-genesis-sum">Buy when <b>{summarizeEntry(genesisRes.spec.entry, genesisRes.spec.signals)}</b> · exit {[genesisRes.spec.exit.stopLossPct && `SL ${genesisRes.spec.exit.stopLossPct}%`, genesisRes.spec.exit.takeProfitPct && `TP ${genesisRes.spec.exit.takeProfitPct}%`, genesisRes.spec.exit.trailingPct && `trail ${genesisRes.spec.exit.trailingPct}%`].filter(Boolean).join(" · ")}</div>
            <div className="fg-grid3" style={{ marginTop: 8 }}>
              {stat("Total Return", (m.totalReturnPct >= 0 ? "+" : "") + m.totalReturnPct + "%", m.totalReturnPct >= 0 ? "pos" : "neg")}
              {stat("Sharpe", String(m.sharpe), m.sharpe >= 1 ? "pos" : "")}
              {stat("Max DD", m.maxDrawdownPct + "%", "neg")}
            </div>
            <button className="fg-btn primary" style={{ marginTop: 12 }} onClick={adoptGenesis}>✓ Adopt & open in builder</button>
          </div>; })()}
        </div>
      </div>}

      {terra && (terra.loading ? <div className="terra-back" style={{ display: "grid", placeItems: "center", color: "#dbe8f5", fontFamily: "var(--fg-disp)" }}><div style={{ textAlign: "center" }}><div className="fg-imp-spin"><Icon n="terra" size={32} /></div><div style={{ marginTop: 10 }}>Sweeping the parameter grid…<br /><span className="fg-note">121 backtests · building the fitness landscape</span></div></div></div>
        : terra.res ? <Suspense fallback={<div className="terra-back" style={{ display: "grid", placeItems: "center", color: "#dbe8f5" }}>◌ Rendering terrain…</div>}><ForgeTerraform terrain={terra.res} onClose={() => setTerra(null)} onApply={applyTerra} /></Suspense>
          : <div className="fg-brief-back" onClick={() => setTerra(null)}><div className="fg-brief" style={{ maxWidth: 420 }}><div className="fg-brief-h"><span className="fg-brief-t"><Icon n="terra" /> Terraform</span><span className="fg-x" onClick={() => setTerra(null)}>✕</span></div><div className="fg-note">Need ≥60 bars to sweep the landscape.</div></div></div>)}

      {oracleOpen && result && <Suspense fallback={<div className="oracle-back" style={{ display: "grid", placeItems: "center", color: "#dbe8f5", fontFamily: "var(--fg-disp)" }}>◌ Summoning The Oracle…</div>}>
        <ForgeOracle result={result} mc={mc} name={spec?.meta.name || "Strategy"} onClose={() => setOracleOpen(false)} />
      </Suspense>}

      {prospect && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setProspect(null); }}>
        <div className="fg-brief fg-prospect">
          <div className="fg-brief-h"><span className="fg-brief-t"><Icon n="radar" /> Prospector · alt-data signals</span><span className="fg-x" onClick={() => setProspect(null)}>✕</span></div>
          {prospect.loading ? <div className="fg-imp-loading"><div className="fg-imp-spin"><Icon n="radar" size={30} /></div><div>Mining free alt-data…<br /><span className="fg-note">SEC insider filings · news tone · macro regime</span></div></div>
            : !prospect.signals || prospect.signals.length === 0 ? <div className="fg-note">No alt-data signals surfaced for {spec?.universe.symbols[0]} right now (insider/news feeds may be quiet).</div>
              : <><div className="fg-note" style={{ marginBottom: 10 }}>Free alternative data turned into candidate signals for {spec?.universe.symbols[0]}. Add any to your library to build with.</div>
                {prospect.signals.map(m => <div key={m.id} className="fg-prospect-card">
                  <div className="fg-prospect-h"><span className="fg-prospect-ic">{m.icon}</span><span className="fg-prospect-n">{m.name}</span><span className={`fg-prospect-str ${m.strength >= 0 ? "pos" : "neg"}`}>{m.strength >= 0 ? "▲" : "▼"} {Math.abs(m.strength).toFixed(2)}</span></div>
                  <div className="fg-prospect-read">{m.reading}</div>
                  <div className="fg-prospect-desc">{m.description}</div>
                  <div className="fg-prospect-foot"><code>{m.dslHint}</code>{prospect.added.has(m.id) ? <span className="fg-prospect-added">✓ added</span> : <button className="fg-btn" onClick={() => addMined(m)}>＋ Add to library</button>}</div>
                </div>)}</>}
        </div>
      </div>}

      {meta && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setMeta(null); }}>
        <div className="fg-brief fg-meta">
          {meta.loading ? <div className="fg-imp-loading"><div className="fg-imp-spin"><Icon n="funnel" size={30} /></div><div>Training the meta-label model…<br /><span className="fg-note">features = your signals at entry · target = did the trade win</span></div></div>
            : !meta.res ? <><div className="fg-brief-h"><span className="fg-brief-t"><Icon n="funnel" /> Meta-Labeler</span><span className="fg-x" onClick={() => setMeta(null)}>✕</span></div><div className="fg-note">Need ≥12 trades to train a meta-label classifier. Run a longer/wider backtest.</div></>
              : (() => { const mr = meta.res!; const lift = mr.filteredReturnPct - mr.baseReturnPct; return <>
                <div className="fg-brief-h"><span className="fg-brief-t"><Icon n="funnel" /> Meta-Labeler <span className={`fg-grade g-${mr.auc >= 0.6 ? "A" : mr.auc >= 0.55 ? "B" : "D"}`}>AUC {mr.auc}</span></span><span className="fg-x" onClick={() => setMeta(null)}>✕</span></div>
                <div className="fg-brief-sum">{mr.verdict}</div>
                <div className="fg-meta-ba">
                  <div className="fg-meta-col"><div className="fg-meta-h">All {mr.nTrades} trades</div><div className={`fg-meta-v ${mr.baseReturnPct >= 0 ? "pos" : "neg"}`}>{mr.baseReturnPct >= 0 ? "+" : ""}{mr.baseReturnPct}%</div><div className="fg-note">{mr.baseWinRate}% win rate</div></div>
                  <div className="fg-meta-arrow">→</div>
                  <div className="fg-meta-col"><div className="fg-meta-h">Meta-filtered ({mr.kept} kept)</div><div className={`fg-meta-v ${mr.filteredReturnPct >= 0 ? "pos" : "neg"}`}>{mr.filteredReturnPct >= 0 ? "+" : ""}{mr.filteredReturnPct}%</div><div className="fg-note">{mr.filteredWinRate}% win rate · skipped {mr.skipped}</div></div>
                </div>
                {lift > 0 && <div className="fg-note" style={{ color: "var(--fg-pos)", marginBottom: 8 }}>▲ Meta-filter adds {lift.toFixed(1)}% by skipping low-confidence trades.</div>}
                <div className="fg-sec-h">Most predictive entry features</div>
                {mr.features.map(f => <div key={f.name} className="fg-meta-feat"><span>{f.name}</span><div className="fg-meta-bar"><i className={f.weight >= 0 ? "pos" : "neg"} style={{ width: `${Math.min(100, Math.abs(f.weight) * 60)}%` }} /></div><span className="fg-meta-w">{f.weight}</span></div>)}
                <div className="fg-note" style={{ marginTop: 10 }}>A positive weight means higher values of that feature at entry predict a winning trade. Meta-labeling filters direction calls by confidence (López de Prado).</div>
              </>; })()}
        </div>
      </div>}

      {darwin && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) { if (!darwin.loading) setDarwin(null); } }}>
        <div className="fg-brief fg-darwin">
          {darwin.loading ? <div className="fg-imp-loading"><div className="fg-imp-spin"><Icon n="darwin" size={30} /></div><div>Evolving strategies… generation {darwin.gen}<br /><span className="fg-note">mutate · crossbreed · select by risk-adjusted fitness</span></div></div>
            : !darwin.res ? <><div className="fg-brief-h"><span className="fg-brief-t"><Icon n="darwin" /> Darwin</span><span className="fg-x" onClick={() => setDarwin(null)}>✕</span></div><div className="fg-note">Need ≥60 bars of history to evolve.</div></>
              : (() => { const d = darwin.res!; const m = d.bestMetrics; const H = d.history; const lo = Math.min(...H.map(h => h.best)), hi = Math.max(...H.map(h => h.best)), rg = hi - lo || 1; return <>
                <div className="fg-brief-h"><span className="fg-brief-t"><Icon n="darwin" /> Darwin · evolved winner</span><span className="fg-x" onClick={() => setDarwin(null)}>✕</span></div>
                <div className="fg-brief-sum">Bred {d.evaluated} strategies over {H.length} generations. The winner scores <b>{d.bestFitness}</b> fitness{d.improvementPct > 0 ? ` — ${d.improvementPct}% better than your seed` : ""}.</div>
                <svg className="fg-darwin-chart" viewBox="0 0 300 70" preserveAspectRatio="none">
                  <polyline fill="none" stroke="#eaf6ff" strokeWidth="1.6" points={H.map((h, i) => `${(i / (H.length - 1)) * 300},${64 - ((h.best - lo) / rg) * 58}`).join(" ")} />
                  {H.map((h, i) => <circle key={i} cx={(i / (H.length - 1)) * 300} cy={64 - ((h.best - lo) / rg) * 58} r="1.6" fill="#4dffb0" />)}
                </svg>
                <div className="fg-note" style={{ marginBottom: 8 }}>Fitness per generation — the population climbing toward a better strategy.</div>
                <div className="fg-genesis-sum">Winner: <b>{summarizeEntry(d.best.entry, d.best.signals)}</b> · exit {[d.best.exit.stopLossPct && `SL ${d.best.exit.stopLossPct}%`, d.best.exit.takeProfitPct && `TP ${d.best.exit.takeProfitPct}%`, d.best.exit.trailingPct && `trail ${d.best.exit.trailingPct}%`].filter(Boolean).join(" · ")}</div>
                <div className="fg-grid3" style={{ marginTop: 8 }}>
                  {stat("Total Return", (m.totalReturnPct >= 0 ? "+" : "") + m.totalReturnPct + "%", m.totalReturnPct >= 0 ? "pos" : "neg")}
                  {stat("Sharpe", String(m.sharpe), m.sharpe >= 1 ? "pos" : "")}
                  {stat("Max DD", m.maxDrawdownPct + "%", "neg")}
                </div>
                <button className="fg-btn primary" style={{ marginTop: 12 }} onClick={adoptDarwin}>✓ Adopt the winner</button>
              </>; })()}
        </div>
      </div>}

      {sentinel && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setSentinel(null); }}>
        <div className="fg-brief fg-sentinel">
          {sentinel.loading ? <div className="fg-imp-loading"><div className="fg-imp-spin"><Icon n="shield" size={30} /></div><div>Stress-testing for overfitting…<br /><span className="fg-note">deflated Sharpe · trade-shuffle · parameter jitter re-backtests</span></div></div>
            : !sentinel.res ? <><div className="fg-brief-h"><span className="fg-brief-t"><Icon n="shield" /> Overfitting Sentinel</span><span className="fg-x" onClick={() => setSentinel(null)}>✕</span></div><div className="fg-note">Need ≥30 bars to run the checks.</div></>
              : (() => { const s = sentinel.res!; const dsrNum = parseFloat(String(s.dsr.evidence.find(e => e.stat === "DSR")?.value || "0")); const mcProb = parseFloat(String(s.mc.evidence.find(e => e.stat === "P(profit)")?.value || "0%")); const robust = Math.max(0, 100 - (s.sensitivity.sharpeStd / 0.6) * 100);
                const bar = (label: string, pct: number, note: string) => <div className="fg-sent-dim"><div className="fg-sent-dim-h"><span>{label}</span><span>{Math.round(pct)}/100</span></div><div className="fg-sent-track"><i style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} /></div><div className="fg-note">{note}</div></div>;
                return <>
                  <div className="fg-brief-h"><span className="fg-brief-t"><Icon n="shield" /> Overfitting Sentinel</span><span className="fg-x" onClick={() => setSentinel(null)}>✕</span></div>
                  <div className="fg-sent-gauge"><div className={`fg-sent-score t-${s.trust >= 80 ? "hi" : s.trust >= 60 ? "mid" : s.trust >= 40 ? "lo" : "bad"}`}>{s.trust}</div><div className="fg-sent-label"><b>{s.grade}</b><span>trust score</span></div></div>
                  <div className="fg-brief-sum" style={{ marginTop: 4 }}>{s.verdict}</div>
                  {bar("Statistical significance (Deflated Sharpe)", dsrNum * 100, `DSR ${dsrNum.toFixed(2)} — ${s.dsr.finding.slice(0, 100)}`)}
                  {bar("Parameter robustness", robust, `Sharpe swings ±${s.sensitivity.sharpeStd.toFixed(2)} across param jitters (${s.sensitivity.samples.length} re-backtests). ${s.sensitivity.robust ? "Robust plateau." : "Fragile — on a cliff."}`)}
                  {bar("Out-of-sample efficiency (walk-forward)", Math.min(100, s.wf.wfe * 100), `Re-optimized on rolling windows: OOS Sharpe ${s.wf.oosSharpe} vs IS ${s.wf.isSharpe} → WF-efficiency ${(s.wf.wfe * 100).toFixed(0)}% across ${s.wf.windows} windows. ${s.wf.wfe >= 0.5 ? "Holds up out-of-sample." : "Degrades out-of-sample — overfit to the training window."}`)}
                  {bar("Sequence robustness (Monte-Carlo)", mcProb, s.mc.finding.slice(0, 110))}
                  <div className="fg-note" style={{ marginTop: 10 }}>Deflated Sharpe corrects for the number of configs you tried; parameter jitter re-runs the backtest to see if the edge is a plateau or a spike. This is the honest overfit gate.</div>
                </>; })()}
        </div>
      </div>}

      {regime && (regime.loading ? <div className="fg-brief-back"><div className="fg-brief" style={{ maxWidth: 420 }}><div className="fg-imp-loading"><div className="fg-imp-spin"><Icon n="regime" size={30} /></div><div>Classifying market regimes…</div></div></div></div>
        : regime.analysis ? <ForgeRegime analysis={regime.analysis} onClose={() => setRegime(null)} />
          : <div className="fg-brief-back" onClick={() => setRegime(null)}><div className="fg-brief" style={{ maxWidth: 420 }}><div className="fg-brief-h"><span className="fg-brief-t">◫ Regime Radar</span><span className="fg-x" onClick={() => setRegime(null)}>✕</span></div><div className="fg-note">Need ≥30 bars of price history to classify regimes.</div></div></div>)}

      {improver && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setImprover(null); }}>
        <div className="fg-brief fg-improver">
          {improver.loading ? <div className="fg-imp-loading"><div className="fg-imp-spin"><Icon n="scan" size={30} /></div><div>THE IMPROVER is diagnosing the run…<br /><span className="fg-note">building the ledger · running testers · growing the diagnosis tree</span></div></div>
            : !improver.analysis ? <><div className="fg-brief-h"><span className="fg-brief-t"><Icon n="scan" /> The Improver</span><span className="fg-x" onClick={() => setImprover(null)}>✕</span></div><div className="fg-note">Couldn't build the analysis (need ≥30 bars of price history). Try a longer backtest.</div></>
              : (() => { const r = improver.analysis!.report; return <>
                <div className="fg-brief-h"><span className="fg-brief-t"><Icon n="scan" /> The Improver · {spec?.meta.name} <span className={`fg-grade g-${r.grade[0]}`}>{r.grade}</span></span><span className="fg-x" onClick={() => setImprover(null)}>✕</span></div>
                <div className="fg-brief-sum">{r.summary}</div>
                <div className="fg-imp-stats"><span>{r.stats.nodes} tree nodes</span><span>{r.stats.confirmed} confirmed weakness{r.stats.confirmed === 1 ? "" : "es"}</span><span>{r.clusters.length} themes</span><span>{r.strengths.length} strengths</span></div>

                {r.cards.length > 0 && <><div className="fg-sec-h" style={{ marginTop: 12 }}>➤ Action cards <span className="fg-note">— staged, stamped by the metric each targets</span></div>
                  {r.cards.map(c => { const ct = cardTest[c.id]; const dlt = (a?: number, b?: number) => (a != null && b != null ? b - a : 0);
                    return <div key={c.id} className="fg-imp-card">
                    <div className="fg-imp-card-h"><span className="fg-imp-stage">{c.stage}</span><span className="fg-imp-card-t">{c.title}</span><span className={`fg-imp-risk r-${c.risk}`}>{c.risk}</span></div>
                    <div className="fg-imp-card-m">{c.targetedMetrics.map(m => <span key={m} className="fg-tag">{m}</span>)}<span className="fg-imp-delta">{c.expectedDelta}</span></div>
                    <div className="fg-imp-card-r">{c.rationale}</div>
                    {c.patch && <div className="fg-imp-card-act">
                      {!ct?.after ? <button className="fg-btn" disabled={ct?.applying} onClick={() => applyCard(c.id, c.patch!)}>{ct?.applying ? "◌ Re-testing…" : "▶ Apply & re-backtest"}</button>
                        : <>
                          <div className="fg-imp-ba">
                            {([["Return", "totalReturnPct", "%"], ["Sharpe", "sharpe", ""], ["Max DD", "maxDrawdownPct", "%"], ["Profit F.", "profitFactor", ""]] as [string, keyof BacktestResult["metrics"], string][]).map(([lbl, key, u]) => { const d = dlt(ct.before?.[key] as number, ct.after?.[key] as number); const better = key === "maxDrawdownPct" ? d > 0 : d > 0; return <span key={lbl} className={`fg-imp-ba-i ${Math.abs(d) < 0.01 ? "" : better ? "up" : "down"}`}>{lbl} {ct.after?.[key]}{u} <b>{d >= 0 ? "+" : ""}{d.toFixed(2)}</b></span>; })}
                          </div>
                          <button className="fg-btn primary" onClick={() => adoptCard(c.id)}>✓ Adopt this fix</button>
                        </>}
                    </div>}
                  </div>; })}</>}

                {r.strengths.length > 0 && <><div className="fg-sec-h" style={{ marginTop: 12, color: "var(--fg-pos)" }}>✓ Strengths — what to keep</div>
                  {r.strengths.map((s, i) => <div key={i} className="fg-deep-li">{s.claim}</div>)}</>}

                <details className="fg-tree-details"><summary className="fg-sec-h" style={{ marginTop: 12, cursor: "pointer" }}>🌳 Diagnosis tree · {r.stats.nodes} nodes</summary>
                  <div className="fg-tree">{flattenTree(r.nodes, r.rootId).map(({ node, depth }) => <div key={node.id} className={`fg-tree-row k-${node.kind} v-${node.verdict}`} style={{ paddingLeft: 4 + depth * 16 }}>
                    <span className="fg-tree-glyph">{node.kind === "chunk" ? "◆" : node.kind === "weakness" ? (node.verdict === "confirmed" ? "⚠" : "○") : node.kind === "rootcause" ? "→" : node.kind === "strength" ? "✓" : "·"}</span>
                    <span className="fg-tree-claim">{node.claim}</span>
                  </div>)}</div>
                </details>
                <div className="fg-sec-h" style={{ marginTop: 12 }}>◪ Metric X-ray</div>
                <div className="fg-deep-grid">{r.metrics.filter(m => m.verdict !== "na").slice(0, 18).map(m => <div key={m.id} className={`fg-stat fg-imp-metric v-${m.verdict}`} title={m.diagnosis}><span className="fg-sv">{m.value}{m.unit}</span><span className="fg-sl">{m.label}</span></div>)}</div>
                <div className="fg-note" style={{ marginTop: 10 }}>Diagnosis tree · {r.stats.nodes} nodes · every finding tested against the backtest. Hover a metric for what a bad value means.</div>

                <div className="fg-agent">
                  <div className="fg-sec-h" style={{ marginTop: 4 }}>◈ Ask the analyst <span className="fg-note">— it computes on demand, never dead-ends</span></div>
                  <div className="fg-agent-log">
                    {agentMsgs.length === 0 && <div className="fg-agent-hint">Try: "what's my Sortino?" · "why is the grade {r.grade}?" · "which fix should I do first?" · "is this overfit?"</div>}
                    {agentMsgs.map((m, i) => <div key={i} className={`fg-agent-msg ${m.role}`}>{m.role === "agent" && <span className="fg-agent-tag">◈</span>}{m.text}</div>)}
                    {agentBusy && <div className="fg-agent-msg agent"><span className="fg-agent-tag">◈</span><span className="fg-agent-think">analyzing…</span></div>}
                  </div>
                  <div className="fg-agent-in">
                    <input ref={agentInputRef} placeholder="Ask anything about this strategy…" onKeyDown={e => { if (e.key === "Enter") askAgent((e.target as HTMLInputElement).value); }} spellCheck={false} />
                    <button className="fg-btn" disabled={agentBusy} onClick={() => askAgent(agentInputRef.current?.value || "")}>➤</button>
                  </div>
                </div>
              </>; })()}
        </div>
      </div>}

      {deepRep && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setDeepRep(null); }}>
        <div className="fg-brief fg-deep">
          <div className="fg-brief-h"><span className="fg-brief-t"><Icon n="pulse" /> Deep Analysis · {deepRep.name} <span className={`fg-grade g-${deepRep.grade[0]}`}>{deepRep.grade}</span></span><span className="fg-x" onClick={() => setDeepRep(null)}>✕</span></div>
          <div className="fg-brief-sum">{deepRep.narrative.summary}</div>
          <div className="fg-deep-grid">
            {([["Sharpe", deepRep.metrics.sharpe], ["Sortino", deepRep.metrics.sortino], ["Calmar", deepRep.metrics.calmar], ["Max DD", deepRep.metrics.maxDrawdownPct + "%"], ["Ulcer", deepRep.metrics.ulcerIndex], ["Recovery", deepRep.metrics.recoveryFactor], ["VaR 95", deepRep.metrics.var95Pct + "%"], ["CVaR 95", deepRep.metrics.cvar95Pct + "%"], ["Tail Ratio", deepRep.metrics.tailRatio], ["Skew", deepRep.metrics.skew], ["Kurtosis", deepRep.metrics.kurtosis], ["Profit Factor", deepRep.metrics.profitFactor], ["Payoff", deepRep.metrics.payoffRatio], ["Gain/Pain", deepRep.metrics.gainToPain], ["Kelly", deepRep.metrics.kellyPct + "%"], ["Win Rate", deepRep.metrics.winRatePct + "%"], ["Expectancy", deepRep.metrics.expectancyPct + "%"], ["$100 →", "$" + deepRep.metrics.finalEquityFrom100]] as [string, string | number][]).map(([k, v]) => <div key={k} className="fg-stat"><span className="fg-sv">{v}</span><span className="fg-sl">{k}</span></div>)}
          </div>
          <div className="fg-deep-cols">
            <div><div className="fg-sec-h" style={{ color: "var(--fg-pos)" }}>✓ Strengths</div>{deepRep.narrative.strengths.map((s, i) => <div key={i} className="fg-deep-li">{s}</div>)}</div>
            <div><div className="fg-sec-h" style={{ color: "var(--fg-neg)" }}>△ Weaknesses</div>{deepRep.narrative.weaknesses.map((s, i) => <div key={i} className="fg-deep-li">{s}</div>)}</div>
            <div><div className="fg-sec-h">➤ How to improve</div>{deepRep.narrative.improve.map((s, i) => <div key={i} className="fg-deep-li">{s}</div>)}</div>
          </div>
          <div className="fg-note" style={{ marginTop: 10 }}>Saved to the strategy so Jarvis can answer questions like "what's my Sortino on {deepRep.name}?" · engine js-1 · {deepRep.generatedAtLabel}</div>
        </div>
      </div>}

      {portOpen && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setPortOpen(false); }}>
        <div className="fg-brief" style={{ maxWidth: 620 }}>
          <div className="fg-brief-h"><span className="fg-brief-t">⧉ Compose Portfolio</span><span className="fg-x" onClick={() => setPortOpen(false)}>✕</span></div>
          <div className="fg-note" style={{ marginBottom: 8 }}>Select strategies to blend into a diversified book. We backtest each, allocate capital, and report blended metrics + diversification.</div>
          <div className="fg-port-method">
            <span className="fg-note">Allocator:</span>
            <button className={portMethod === "hrp" ? "on" : ""} onClick={() => setPortMethod("hrp")} title="Hierarchical Risk Parity — clusters correlated strategies, allocates by inverse variance (López de Prado)">◈ HRP</button>
            <button className={portMethod === "equal" ? "on" : ""} onClick={() => setPortMethod("equal")}>≡ Equal-weight</button>
          </div>
          {list.length === 0 ? <div className="fg-empty">Save some strategies first, then compose them here.</div> :
            <div className="fg-port-list">{list.map(s => <label key={s.id} className={`fg-port-item${portSel.has(s.id) ? " on" : ""}`}><input type="checkbox" checked={portSel.has(s.id)} onChange={() => toggleSel(s.id)} /><span className="fg-port-n">{s.name}</span><span className="fg-port-m">{s.metrics?.sharpe != null ? "Sharpe " + s.metrics.sharpe : ""}</span></label>)}</div>}
          <button className="fg-btn primary" style={{ marginTop: 12 }} onClick={compose} disabled={composing || portSel.size < 1}>{composing ? "◌ Composing…" : `▶ Compose ${portSel.size || ""}`}</button>
          {portRes && <div className="fg-robust" style={{ marginTop: 14 }}>
            <div className="fg-sec-h">Blended Portfolio · {portRes.legs.length} strategies · {portMethod === "hrp" ? "HRP" : "equal-weight"}</div>
            <div className="fg-port-weights">{portRes.legs.map(l => <span key={l.name}>{l.name}: {l.weight}%</span>)}</div>
            <div className="fg-grid3" style={{ marginTop: 8 }}>
              {stat("Total Return", (portRes.totalReturnPct >= 0 ? "+" : "") + portRes.totalReturnPct + "%", portRes.totalReturnPct >= 0 ? "pos" : "neg")}
              {stat("Sharpe", String(portRes.sharpe), portRes.sharpe >= 1 ? "pos" : "")}
              {stat("Max DD", portRes.maxDrawdownPct + "%", "neg")}
              {stat("Avg Correlation", String(portRes.avgCorrelation), portRes.avgCorrelation < 0.5 ? "pos" : portRes.avgCorrelation > 0.8 ? "neg" : "")}
            </div>
            <div className="fg-note" style={{ marginTop: 7 }}>{portRes.avgCorrelation < 0.4 ? "Well diversified — low correlation between strategies." : portRes.avgCorrelation > 0.75 ? "Highly correlated — limited diversification benefit." : "Moderate diversification."} {portMethod === "hrp" ? "HRP allocates more to uncorrelated, lower-variance sleeves." : "Equal-weight blend."}</div>
          </div>}
        </div>
      </div>}

      {pyBrief && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setPyBrief(null); }}>
        <div className="fg-brief">
          <div className="fg-brief-h"><span className="fg-brief-t">⬒ Strategy Brief · {pyBrief.filename}</span><span className="fg-x" onClick={() => setPyBrief(null)}>✕</span></div>
          <div className="fg-brief-sum">{pyBrief.summary}</div>
          <div className="fg-brief-grid">
            {pyBrief.framework.length > 0 && <div className="fg-brief-row"><span className="fg-brief-k">Framework</span><span>{pyBrief.framework.join(", ")}</span></div>}
            <div className="fg-brief-row"><span className="fg-brief-k">Type</span><span>{pyBrief.strategyType}</span></div>
            {pyBrief.indicators.length > 0 && <div className="fg-brief-row"><span className="fg-brief-k">Indicators</span><span>{pyBrief.indicators.map(i => <span key={i} className="fg-tag">{i}</span>)}</span></div>}
            {pyBrief.entry.length > 0 && <div className="fg-brief-row"><span className="fg-brief-k">Entry</span><span>{pyBrief.entry.join(" · ")}</span></div>}
            {pyBrief.exit.length > 0 && <div className="fg-brief-row"><span className="fg-brief-k">Exit</span><span>{pyBrief.exit.join(" · ")}</span></div>}
            {pyBrief.risk.length > 0 && <div className="fg-brief-row"><span className="fg-brief-k">Risk</span><span>{pyBrief.risk.join(" · ")}</span></div>}
            {pyBrief.parameters.length > 0 && <div className="fg-brief-row"><span className="fg-brief-k">Parameters</span><span className="fg-brief-params">{pyBrief.parameters.map(p => <span key={p.name} className="fg-param">{p.name}={p.value}</span>)}</span></div>}
            <div className="fg-brief-row"><span className="fg-brief-k">Structure</span><span>{pyBrief.classes.length} classes · {pyBrief.functions.length} functions · {pyBrief.linesOfCode} LOC</span></div>
          </div>
          <div className="fg-note" style={{ marginTop: 10 }}>Static analysis · imports: {pyBrief.imports.slice(0, 8).join(", ") || "none"}. Ask Jarvis to go deeper or help wire this into a bot.</div>
          <button className="fg-btn primary" style={{ marginTop: 12 }} disabled={making} onClick={() => makeStrategy(pyBrief)}>{making ? "◌ Forging…" : "⚒ Make this a strategy"}</button>
          <div className="fg-note" style={{ marginTop: 6 }}>Creates a strategy folder, stores the code path, extracts a signal from its indicators, and seeds a starter bot you can refine.</div>
        </div>
      </div>}

      {compareOpen && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setCompareOpen(false); }}>
        <div className="fg-brief" style={{ maxWidth: 560 }}>
          <div className="fg-brief-h"><span className="fg-brief-t"><Icon n="pulse" /> Compare Strategies</span><span className="fg-x" onClick={() => setCompareOpen(false)}>✕</span></div>
          <div className="fg-note" style={{ marginBottom: 10 }}>Backtest the current strategy against a saved one, side by side — real fills, same engine.</div>
          {!spec ? <div className="fg-empty">Open a strategy first.</div> : list.filter(s => s.id !== spec.meta.id).length === 0 ? <div className="fg-empty">Save another strategy to compare against.</div> : <>
            <div className="fg-note">Current: <b>{spec.meta.name}</b> — pick a challenger:</div>
            <div className="fg-cmp-picks">{list.filter(s => s.id !== spec.meta.id).map(s => <button key={s.id} className="fg-cmp-pick" disabled={comparing} onClick={() => runCompare(s.id)}>{s.name}</button>)}</div>
            {comparing && <div className="fg-note" style={{ marginTop: 8 }}>◌ Backtesting both…</div>}
            {compareRes && (() => { const rows: [string, keyof BacktestResult["metrics"], string, boolean][] = [["CAGR", "cagrPct", "%", true], ["Sharpe", "sharpe", "", true], ["Max DD", "maxDrawdownPct", "%", false], ["Win Rate", "winRatePct", "%", true], ["Profit Factor", "profitFactor", "", true], ["Trades", "trades", "", true]]; return <div className="fg-cmp">
              <div className="fg-cmp-r fg-cmp-hd"><span className="fg-cmp-l" /><span>{compareRes.aName}</span><span>{compareRes.bName}</span></div>
              {rows.map(([lbl, key, u, hi]) => { const av = compareRes.a[key] as number, bv = compareRes.b[key] as number; const aw = hi ? av >= bv : av <= bv; return <div key={lbl} className="fg-cmp-r"><span className="fg-cmp-l">{lbl}</span><span className={"fg-cmp-v" + (aw ? " win" : "")}>{av}{u}</span><span className={"fg-cmp-v" + (!aw ? " win" : "")}>{bv}{u}</span></div>; })}
            </div>; })()}
          </>}
        </div>
      </div>}

      {datasetsOpen && <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) setDatasetsOpen(false); }}>
        <div className="fg-brief" style={{ maxWidth: 520 }}>
          <div className="fg-brief-h"><span className="fg-brief-t"><Icon n="layers" /> Datasets</span><span className="fg-x" onClick={() => setDatasetsOpen(false)}>✕</span></div>
          <div className="fg-note" style={{ marginBottom: 10 }}>The Forge backtests on free, public market data — no proprietary or local feeds, so every strategy stays shareable.</div>
          {([["Price / OHLCV", "Yahoo Finance · Stooq", "daily · hourly · 15-min"], ["Insider filings", "SEC EDGAR (Form 4)", "alt-data signals"], ["News tone", "Public headlines", "sentiment signal"], ["Macro regime", "VIX · rates · indices", "regime radar"], ["Custom uploads", "Your .py / .csv", "derived signals"]] as [string, string, string][]).map(([n, src, use]) => <div key={n} className="fg-ds-row"><div className="fg-ds-n"><b>{n}</b><span>{src}</span></div><span className="fg-ds-use">{use}</span><span className="fg-ds-st">live</span></div>)}
          <div className="fg-note" style={{ marginTop: 10 }}>Provider management &amp; API keys <span className="hz-demo">demo</span> — arriving with the data-connector engine.</div>
        </div>
      </div>}

      {toasts.length > 0 && <div className="fg-toasts">{toasts.map(t => <div key={t.id} className={`fg-toast ${t.kind}`}>{t.msg}</div>)}</div>}
    </div>
  );
}

