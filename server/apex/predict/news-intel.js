// APEX Oracle — News Intelligence pipeline. Multi-source ingestion → dedupe → entity tagging →
// EVENT CLASSIFICATION (not word-counting) → sentiment + impact scoring → PROPAGATION GRAPH
// (how a story ripples to competitors / suppliers / customers / sector). Free sources only.
//
// Inject { getBars } for the propagation correlations. Uses global fetch (Node 18+).

const { PEERS } = require("./signals");
const { clamp, std, mean } = require("./mathx");
const NB = require("./news-brain");

// Minimal commodity/cross-asset exposure map (Yahoo-servable ETF proxies). Sign = co-move direction.
const COMMODITY_MAP = {
  XLE: [{ sym: "USO", kind: "oil", sign: 1 }], XOM: [{ sym: "USO", kind: "oil", sign: 1 }], CVX: [{ sym: "USO", kind: "oil", sign: 1 }],
  XLK: [{ sym: "SOXX", kind: "semis", sign: 1 }], NVDA: [{ sym: "SOXX", kind: "semis", sign: 1 }], AMD: [{ sym: "SOXX", kind: "semis", sign: 1 }],
  GLD: [{ sym: "GLD", kind: "gold", sign: 1 }], NEM: [{ sym: "GLD", kind: "gold", sign: 1 }],
  XLF: [{ sym: "TLT", kind: "rates", sign: -1 }], JPM: [{ sym: "TLT", kind: "rates", sign: -1 }],
  TSLA: [{ sym: "LIT", kind: "lithium", sign: 1 }], F: [{ sym: "USO", kind: "oil", sign: -1 }],
};

// ── Event taxonomy: each type has a directional prior + typical magnitude (event-study style) ──
const EVENTS = [
  { type: "earnings_beat", label: "Earnings Beat", dir: +1, mag: 3, re: /(earnings|revenue|profit|eps|q[1-4]|quarter)\b[^.]{0,40}\b(beat|beats|top|tops|above|exceed)|beat(s)? (estimate|expectation|forecast|street)|tops estimate|record (profit|revenue|earnings)|blows past estimate|smashes (estimate|expectation)/i },
  { type: "earnings_miss", label: "Earnings Miss", dir: -1, mag: 3, re: /miss(es|ed|\b)|below (estimate|expectation|forecast)|disappoint|falls short/i },
  { type: "guidance_up", label: "Guidance Raised", dir: +1, mag: 3, re: /rais(e|es|ed) (its )?(guidance|outlook|forecast|target)|hik(e|es) forecast|boosts outlook/i },
  { type: "guidance_down", label: "Guidance Cut", dir: -1, mag: 3, re: /cut(s)? (its )?(guidance|outlook|forecast)|lower(s|ed) (guidance|outlook)|warns|profit warning|slash(es)? (outlook|forecast)/i },
  { type: "upgrade", label: "Analyst Upgrade", dir: +1, mag: 2, re: /upgrad(e|es|ed)|raised to (buy|outperform|overweight)|initiat(e|ed) (buy|overweight)/i },
  { type: "downgrade", label: "Analyst Downgrade", dir: -1, mag: 2, re: /downgrad(e|es|ed)|cut to (sell|underperform|underweight)|lowered to (hold|neutral)/i },
  { type: "pt_raise", label: "Price Target Raised", dir: +1, mag: 1.5, re: /price target (rais|hik|boost|lift)|pt to \$|target price increase/i },
  { type: "pt_cut", label: "Price Target Cut", dir: -1, mag: 1.5, re: /price target (cut|lower|slash|reduc)/i },
  { type: "ma_target", label: "Acquisition Target", dir: +1, mag: 4, re: /to be acquired|takeover (bid|offer)|buyout offer|agrees to be bought|acquisition of/i },
  { type: "ma_acquirer", label: "Making Acquisition", dir: -0.3, mag: 2, re: /to acquire|acquires|to buy|agrees to purchase|deal to buy/i },
  { type: "product", label: "Product / Launch", dir: +1, mag: 1.5, re: /launch(es|ed)?|unveil(s|ed)?|new (chip|model|product|device|drug)|announces .*(gpu|ai|platform)/i },
  { type: "partnership", label: "Partnership / Deal", dir: +1, mag: 1.5, re: /partner(ship|s with)|collaborat|signs deal|contract (win|award)|wins .*contract|expands deal/i },
  { type: "regulatory_ok", label: "Regulatory Approval", dir: +1, mag: 2.5, re: /fda approval|approved by|clearance|granted (approval|patent)|wins approval/i },
  { type: "lawsuit", label: "Legal / Probe", dir: -1, mag: 2, re: /lawsuit|sued|probe|investigat(e|ion)|subpoena|sec charges|fraud|antitrust|fine(d)?|settlement/i },
  { type: "recall_halt", label: "Recall / Halt", dir: -1, mag: 2.5, re: /recall(s|ed)?|halt(s|ed)? (production|trading)|shutdown|outage|breach|hack/i },
  { type: "buyback_div", label: "Buyback / Dividend", dir: +1, mag: 1.5, re: /buyback|repurchase|dividend (hik|rais|increas|boost)|special dividend/i },
  { type: "layoffs", label: "Layoffs / Cost Cut", dir: +0.4, mag: 1.5, re: /layoff|job cuts|restructur|cost.cutting|slashes jobs/i },
  { type: "insider", label: "Insider Activity", dir: 0, mag: 1, re: /insider (buy|sell|selling|buying)|ceo (buys|sells)|form 4/i },
];

// Expanded finance sentiment lexicon (Loughran-McDonald flavored).
const POS_W = ["surge", "surges", "soar", "soars", "jump", "jumps", "rally", "rallies", "gain", "gains", "rise", "rises", "climb", "climbs", "record", "strong", "growth", "profit", "beat", "beats", "upgrade", "raises", "raised", "outperform", "bullish", "wins", "win", "approval", "approved", "tops", "boost", "boosts", "expands", "accelerate", "robust", "upbeat", "optimistic", "rebound", "breakthrough", "milestone", "buyback", "surged"];
const NEG_W = ["plunge", "plunges", "slump", "slumps", "tumble", "tumbles", "drop", "drops", "fall", "falls", "sink", "sinks", "slide", "slides", "cut", "cuts", "downgrade", "weak", "weakness", "loss", "losses", "lawsuit", "probe", "warning", "warns", "bearish", "recall", "halt", "miss", "misses", "disappoint", "fraud", "investigation", "decline", "declines", "slowdown", "concern", "concerns", "fears", "risk", "risks", "layoff", "layoffs", "bankruptcy", "default", "downturn", "crash", "selloff"];

function lexScore(t) {
  const s = t.toLowerCase(); let p = 0, n = 0;
  for (const w of POS_W) if (s.includes(w)) p++;
  for (const w of NEG_W) if (s.includes(w)) n++;
  return (p - n) / (p + n + 1);
}

function classify(title) {
  for (const e of EVENTS) if (e.re.test(title)) return { type: e.type, label: e.label, dir: e.dir, mag: e.mag };
  return { type: "general", label: "General", dir: 0, mag: 0.5 };
}

// Minimal RSS parser (regex over <item> blocks). Robust to Yahoo & Google feeds.
function parseRss(xml, source) {
  const items = []; const re = /<item[\s>]([\s\S]*?)<\/item>/gi; let m;
  while ((m = re.exec(xml)) && items.length < 40) {
    const blk = m[1];
    let title = (blk.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "";
    title = title.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    if (!title) continue;
    const link = (blk.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "";
    const pub = (blk.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || "";
    // Google News suffixes titles with " - Publisher"
    let src = source; const dash = title.lastIndexOf(" - ");
    if (source === "Google" && dash > 20) { src = title.slice(dash + 3).trim(); title = title.slice(0, dash).trim(); }
    items.push({ title, link: link.trim(), ts: pub ? Date.parse(pub) : Date.now(), source: src });
  }
  return items;
}

async function fetchFeed(url, source) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (APEX Oracle)" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return []; return parseRss(await r.text(), source);
  } catch { return []; }
}

// Near-duplicate detection via token-set Jaccard.
function tokset(t) { return new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3)); }
function jaccard(a, b) { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); }

// ── The pipeline ──
async function analyzeNews(symbol, deps = {}) {
  const sym = String(symbol || "").replace(/USDT?$/i, "").toUpperCase();
  const feeds = await Promise.all([
    fetchFeed(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`, "Yahoo"),
    fetchFeed(`https://news.google.com/rss/search?q=${encodeURIComponent(sym + " stock")}&hl=en-US&gl=US&ceid=US:en`, "Google"),
  ]);
  const raw = feeds.flat();
  // dedupe (keep the earliest of near-duplicates; count corroboration)
  const uniq = [];
  for (const it of raw) {
    const ts = tokset(it.title); let dup = null;
    for (const u of uniq) if (jaccard(ts, u._ts) > 0.55) { dup = u; break; }
    if (dup) { dup.corroboration++; dup.sources.add(it.source); }
    else uniq.push({ ...it, _ts: ts, corroboration: 1, sources: new Set([it.source]) });
  }
  const now = Date.now(); const halfLifeMs = 18 * 3.6e6; // 18h recency half-life
  const known = new Set([...(PEERS[sym]?.peers || []), ...Object.keys(PEERS)]);
  let bull = 0, bear = 0;
  const items = uniq.slice(0, 24).map((it) => {
    const ev = classify(it.title);
    // Grammar-aware LM sentiment (negation/intensifier/modality) replaces the naive lexicon count.
    const gr = NB.grammarScore(it.title);
    // blend event-prior direction with grammar sentiment; event dir dominates when it fired
    const sentiment = clamp(ev.type !== "general" ? 0.6 * ev.dir + 0.4 * gr.score : gr.score, -1, 1);
    const ageH = (now - it.ts) / 3.6e6;
    const recency = Math.exp(-(now - it.ts) / halfLifeMs);
    const novelty = 1 / it.corroboration ** 0.5;            // repeated stories add less new info
    // Independence-weighted credibility (noisy-OR across source families) + rumor down-weight.
    const cred = NB.corroborationConfidence([...it.sources]);
    const rumorDamp = 1 - 0.4 * gr.modality;                // hedged/rumored language counts less
    const weight = recency * (0.5 + 0.5 * cred.confidence) * rumorDamp;
    const w = ev.mag * weight;                 // attention weight (magnitude × recency × credibility × certainty)
    const impact = sentiment * w;
    if (sentiment > 0.1) bull++; else if (sentiment < -0.1) bear++;
    // tickers this headline explicitly names
    const tags = [...known].filter((t) => new RegExp(`\\b${t}\\b`).test(it.title.toUpperCase())).slice(0, 4);
    return { title: it.title, source: it.source, sources: [...it.sources], corroboration: it.corroboration, credibility: cred.confidence, independentSources: cred.independentSources, rumor: +gr.modality.toFixed(2), ageH: +ageH.toFixed(1), ts: it.ts, event: ev.type, eventLabel: ev.label, sentiment: +sentiment.toFixed(2), w, impact: +impact.toFixed(2), tags };
  });
  // aggregate = attention-weighted MEAN of sentiment (naturally in [-1,1]; no saturation).
  const wSum = items.reduce((s, x) => s + x.w, 0) || 1;
  const newsScore = clamp(items.reduce((s, x) => s + x.sentiment * x.w, 0) / wSum, -1, 1);
  const eventCounts = {}; for (const it of items) if (it.event !== "general") eventCounts[it.eventLabel] = (eventCounts[it.eventLabel] || 0) + 1;

  // dominant event magnitude (for reaction-gap expected move)
  const domMag = items.reduce((m, it) => (it.event !== "general" ? Math.max(m, classify(it.title).mag) : m), 0.5);

  // ── CROSS-ASSET PROPAGATION (transfer-entropy who-moves-whom) + NEWS BRAIN ──
  const cfg = PEERS[sym] || { etf: "SPY", peers: [] };
  const dir = Math.sign(newsScore);
  const neighborSpecs = [
    ...cfg.peers.slice(0, 4).map((s) => ({ sym: s, kind: "peer" })),
    { sym: cfg.etf, kind: "sector ETF" },
    ...((COMMODITY_MAP[sym] || COMMODITY_MAP[cfg.etf] || []).slice(0, 2).map((c) => ({ sym: c.sym, kind: c.kind }))),
  ];
  let propagation = neighborSpecs.map((n) => ({ sym: n.sym, kind: n.kind, te: null, rho: null, effect: 0, dir: "flat", lead: null }));
  let brain = null;
  if (deps.getBars) {
    const symBars = await deps.getBars(sym, { interval: "1d", range: "6mo" }).catch(() => []);
    const symR = ret(symBars);
    const spyBars = await deps.getBars("SPY", { interval: "1d", range: "6mo" }).catch(() => []);
    // neighbor bars in parallel
    const nbBars = await Promise.all(neighborSpecs.map((n) => deps.getBars(n.sym, { interval: "1d", range: "6mo" }).catch(() => [])));
    const neighbors = neighborSpecs.map((n, i) => ({ ...n, rets: ret(nbBars[i]) }));
    if (symR.length >= 20) propagation = NB.propagate(dir, symR, neighbors);
    // market model + reaction gap ("no movement is information")
    const mm = NB.marketModel(symBars, spyBars);
    const reaction = mm ? NB.reactionGap(newsScore, domMag, mm, 0.5) : null;
    // velocity / reflexivity from story arrival times; abnormal coverage from the REAL PIT archive.
    const archiveDaily = deps.newsDaily ? (deps.newsDaily(sym) || null) : null;
    const vel = NB.velocity(items.map((it) => it.ts).filter(Boolean), null, archiveDaily);
    // compression: abnormal coverage vs realized-vol z (only meaningful once abnCoverage is real)
    let comp = { score: null, signal: "n/a (coverage baseline building)" };
    if (vel.abnCoverage != null && symR.length > 25) {
      const recent = std(symR.slice(-5)); const hist = []; for (let i = 25; i > 5; i--) hist.push(std(symR.slice(-i, -i + 5)));
      const mh = mean(hist), sh = std(hist) || 1e-6; const realizedVolZ = (recent - mh) / sh;
      comp = NB.compression(vel.abnCoverage, realizedVolZ);
    }
    // overall credibility of the current news set
    const allSources = [...new Set(items.flatMap((it) => it.sources))];
    const overallCred = NB.corroborationConfidence(allSources);
    brain = {
      marketModel: mm ? { beta: +mm.beta.toFixed(2), sigmaARpct: +(mm.sigmaAR * 100).toFixed(2), arTodayPct: +(mm.arToday * 100).toFixed(2), car5pct: +(mm.car(5) * 100).toFixed(2) } : null,
      reaction, velocity: vel, compression: comp,
      credibility: { confidence: overallCred.confidence, independentSources: overallCred.independentSources },
      dominantMag: +domMag.toFixed(1),
    };
  }

  return {
    symbol: sym, count: items.length, sources: [...new Set(raw.map((r) => r.source))],
    newsScore: +newsScore.toFixed(2), bull, bear, eventCounts,
    items, propagation, brain,
    topEvents: Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ label: k, n: v })),
  };
}

function ret(bars) { const c = (bars || []).map((b) => b.c); const o = []; for (let i = 1; i < c.length; i++) if (c[i - 1] > 0) o.push(Math.log(c[i] / c[i - 1])); return o; }
function corr(a, b) { const n = Math.min(a.length, b.length); if (n < 5) return 0; const A = a.slice(-n), B = b.slice(-n); const ma = A.reduce((s, x) => s + x, 0) / n, mb = B.reduce((s, x) => s + x, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (A[i] - ma) * (B[i] - mb); da += (A[i] - ma) ** 2; db += (B[i] - mb) ** 2; } return da > 0 && db > 0 ? clamp(num / Math.sqrt(da * db), -1, 1) : 0; }

module.exports = { analyzeNews, classify, lexScore, EVENTS };
