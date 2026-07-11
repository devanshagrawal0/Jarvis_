# THE IMPROVER — Master Spec
### A Diagnostic OS for Trading Strategies, inside THE FORGE
Synthesized from 3 research streams (our 53-file quant library · quant-substance agent · systems-architecture agent), 2026-07-10. This is the crown-jewel engine; the 8 planned features become consumers of its shared substrate (§15).

---

## 1. Thesis & invariants
THE IMPROVER treats a `(BotSpec, BacktestRun)` pair as a defendant and runs an adversarial investigation: every weakness is a **claim**, every claim is **tested against the backtest oracle**, every confirmed claim is **decomposed into root causes with a justification sub-tree**, and every conclusion carries a **reasoning chain back to raw evidence**. It is intentionally credit/compute-heavy — depth over speed.

Five invariants (kept independent so none compromises another):
1. **Termination** — global budgets (nodes/depth/wall-ms/credits) + ε marginal-info floor + per-chunk cap + dedup-collapse. No unbounded path exists.
2. **Groundedness** — every node's `evidence[]` points at concrete ledger rows / metric computations / cited sources. No claim is prose-only.
3. **Never dead-ends** — the Metric Registry + Knowledge Layer guarantee any query resolves to a computed number + explanation; never "not supported."
4. **Deterministic oracle** — the client-side JS backtest is the ONLY truth for "did the fix work." Gemini proposes; the oracle disposes.
5. **Reproducibility** — tree/ledger/report persisted in SQLite, content-hashed by `runHash`; replayable + diffable.

---

## 2. The canonical Run artifact (single source everything reads)
```
Run = {
  meta:   { symbol, timeframe, start, end, barCount, initialCapital, feesBps, slippageBps, A /*barsPerYear*/ },
  bars:   [{ t,o,h,l,c,v, rv?, iv?, putCall? }],
  equity: [{ t, value, drawdown, exposure, cashPct }],           // per-bar mark-to-market
  trades: [{ id, side, entryT, exitT, entryPx, exitPx, size, notional, entryBarIdx, exitBarIdx, barsHeld,
             grossRet, netRet, pnl, feesPaid, slippagePaid, mae, mfe, tMFE, ttfe,
             exitReason /*stop|target|signal|timeout|trail|eod|endOfData*/,
             entryProb?, entryScore?, entrySignals?:{[k]:v}, label? }],
  benchmark?: [{ t, ret }],
  spec: BotSpec
}
```
Derived once, reused everywhere: `R_bar[i]=equity[i]/equity[i-1]-1`, `R_trade[]=trades[].netRet`, ATR@entry (unit for all thresholds → scale-free), excursions MAE/MFE/tMFE/TTFE (§6.0). **Annualize with `meta.A`, never hardcode 252.**

---

## 3. THE RECURSIVE DIAGNOSIS-TREE ENGINE  *(the core)*
### 3.1 Node schema (condensed)
`DiagNode { id, parentId, kind, claim, claimHash, evidence[], tests[], childIds[], verdict, confidence(0..1), metricImpact[], dollarImpact, status, depth, priority, provenance, budgetSpent }`
- `kind ∈ {root, chunk, weakness, tester, rootcause, justification, strength}`.
- **Rule:** weakness nodes are the ONLY place Gemini free-generates hypotheses; tester nodes are deterministic; rootcause/justification require ≥1 confirming tester in their ancestry. The LLM's creativity is fenced to hypothesis generation; every conclusion passes through the oracle.

### 3.2 Expansion policy — best-first, MCTS-flavored (no rollouts)
```
priority(n) = (|dollarImpact| · uncertainty · noveltyBonus) / expansionCost · depthPenalty
uncertainty  = 4·conf·(1−conf)                      // peaks at 0.5, →0 near certainty
noveltyBonus = 1 + c·sqrt(ln(totalExpansions+1)/(1+siblingExpansions))   // UCB-style exploration
depthPenalty = γ^depth   (γ≈0.85)
```
Select the max-priority frontier node. `dollarImpact` dominates → credits flow to the $4k-drawdown weakness before the $80 one. A node with `uncertainty→0` (confidently confirmed OR refuted) stops attracting expansion — natural per-branch info-termination.

### 3.3 Confidence (Bayesian, from tester results)
`logit(conf') = logit(conf) + Σ weight_t·signal_t`, signal∈[−1,+1]. Verdict: `≥0.8 confirmed`, `≤0.2 refuted`, `0.45–0.55 after ≥2 tests → inconclusive` (stop — diminishing returns).

### 3.4 Testers = node-expanders (5 kinds → §7 for the concrete 11)
a. **Statistical** — slice ledger, compute a stat vs baseline (cheap, Web Worker) → rootcause + justification(distribution).
b. **Counterfactual replay** — clone BotSpec, apply ONE mutation, re-run the backtest oracle, diff metrics → rootcause("changing X recovers $Y") + a candidate ActionCard seed. *(oracle-grounded)*
c. **Attribution** — SHAP-lite over the DSL rule firings; decompose P&L/metric by trade/regime/rule → ranked rootcauses.
d. **Knowledge probe** — ask Metric Registry / Knowledge Layer if a known failure pattern matches (may web-search) → rootcause + cited justification.
e. **Gemini hypothesis** — from a chunk's ledger summary, generate ≤K weaknesses, **each pre-loaded with a falsifiable tester of kind a/b/c**. Fires only on weakness generation, never as a leaf verdict.

### 3.5 Guards & currency
- **Dedup:** `claimHash=hash(normalizedClaim, chunkId, targetMetric)`; on hit → merge (union evidence, max confidence) not duplicate. Semantic near-dup: cosine>0.93 on claim embeddings. **Cycle guard:** a child may not restate any ancestor's claimHash. **Sibling saturation:** K consecutive dedup'd hypotheses at a chunk → mark `saturated`, stop generating there.
- **Dollar-impact currency:** precompute `∂metric/∂$` per metric by perturbing equity/P&L → common axis so heterogeneous weaknesses (a Brier flaw vs a Calmar flaw) compare in one priority queue.

### 3.6 Budget & termination
`Budget{ maxNodes≈400, maxDepth≈6, maxWallMs≈90k, maxCredits≈60, epsilon, perChunkCap≈40 }`. Loop ends when ANY of: budget exhausted, frontier empty, or `max(priority)<epsilon`. Testers pre-declare `cost`; a Gemini tester degrades to a cheap statistical proxy if `credits→0`. Justification/tester-result leaves don't re-enter the frontier (bounds fan-out).

### 3.7 Core loop (pseudocode)
```
runImprover(spec, run, budget):
  ledger = buildLedger(spec, run); sens = metricSensitivities(run)
  tree = Tree(); index = NodeIndex()
  for c in decompose(run, ledger): tree.addChild(root, chunkNode(c))
  frontier = MaxHeap(priority·depthPenalty); frontier.pushAll(tree.frontier())
  while !frontier.empty() and budget.hasRoom():
    n = frontier.pop(); if priority(n) < budget.epsilon: break
    if n.depth>=maxDepth or chunkCount(n)>=perChunkCap: n.close(); continue
    for ch in expand(n, ledger, sens, budget, index):    // dispatch by kind (§3.4)
      ch = index.dedup(ch); if ch.isNew: { tree.addChild(n,ch); if worthExpanding(ch) frontier.push(ch) }
    updateConfidenceUpTree(n); budget.charge(n.budgetSpent)
  strengths = strengthsPass(ledger, run); clusters = clusterErrors(tree, index)
  report = synthesize(tree, clusters, strengths, sens); persist(...); return report
```

---

## 4. The 9-layer pipeline (each a typed, persisted hand-off)
L0 **Ingest/validate** (content-hash spec+run+data) → L1 **Decompose→chunks** (by regime, symbol, time-window, trade-cluster, metric-owner) → L2 **Per-trade LEDGER** (§10; incl. synthesized *mistrades/missed-entries* via counterfactual replay so omissions are diagnosable) → L3 **Diagnosis tree** (§3) → L4 **Error grouping/clustering** (§11) → L5 **Strengths pass** (§8) → L6 **Synthesis** (report + staged ActionCards) → L7 **Persist** (SQLite by runHash) → L8 **Agent** (§13).

---

## 5. THE METRIC UNIVERSE  *(inputs → formula → what a BAD value diagnoses)*
Full formulas in the quant-substance appendix; the diagnostic punchlines:
- **Entry-model classification** (when entryProb/score+label exist; else synth score from rule strength): **AUC** (≈0.5 → signal has no ordering power; <0.5 → inverted), **Brier** (high → miscalibrated probs; decompose reliability−resolution+uncertainty), **Log-loss** (high+confident-wrongs → overconfident sizing risk), **Precision/Recall/F1** (low P → over-entry; low R → missing setups), **Calibration/ECE** (below diagonal → overconfidence — the key sizing diagnostic), **KS** (low → winner/loser scores overlap).
- **Return/risk:** **Sharpe** (blind to tails — always pair), **Sortino** (≪Sharpe → downside is the problem), **Calmar/MAR** (low → returns don't justify worst DD), **Sterling** (penalizes recurring DDs), **Omega(τ)**, **Kappa-3** (bad but OK Sortino → fat left tail), **Ulcer/UPI** (deep AND long DDs), **Serenity**, **Information Ratio** (low → no consistent excess).
- **Tail/drawdown:** **VaR/CVaR** (CVaR≫VaR → catastrophic beyond cutoff), **EVT/GPD ξ** (heavy-tail extrapolation — the loss you haven't seen), **Tail ratio** (<1 → lose more on bad days than make on good), **MaxDD**, **DD duration/recovery** (capital dead-time), **Pain index** (chronically underwater).
- **Trade quality:** win-rate (only with payoff), **Profit factor** (<1.25 thin), **Payoff** (low+high-winrate → cutting winners/running losers), **Expectancy** (+ per-bar), **SQN** (<1.6 poor), **Kelly** (f*≪size → overbetting), **Gain-to-pain**, **MAE/MFE efficiency** (low exit-eff → exiting below the move), **Avg hold by outcome** (winners≪losers → disposition effect).
- **Benchmark/factor:** **Alpha/Beta** (β≈1,α≈0 → closet buy-&-hold), **Treynor**, **Up/Down capture** (down>up → worst of both), **R²** (high → returns are market, not skill).
- **Robustness/overfit:** **Probabilistic Sharpe (PSR)**, **Deflated Sharpe (DSR)** (<0.95 → Sharpe is a multiple-testing artifact — THE overfit gate), **PBO** (>0.5 → optimization worse than random), **Walk-forward efficiency** (<0.5 → degrades OOS), **MinBTL** (sample < MinBTL → too short to trust).
- **Signal quality:** **IC / rank-IC** (≈0 → dead signal; rank≫linear → nonlinear→use thresholds), **IC-IR** (low → unstable edge).

---

## 6. TRADE-FAILURE TAXONOMY (14 · detect → fix)
Excursion primitives per trade (from OHLC, ATR-normalized): MAE, MFE, tMFE, TTFE, distToLocalExtreme.
1. **Stopped-then-reversed** — stop-exit then price returns through entry to target within m bars → widen stop to ~1.5×median-winner-MAE / ATR-scale / add re-entry.
2. **Timed-out in profit** — timeout with netRet>0 & MFE still rising → trailing/momentum exit, raise maxHold.
3. **Entered too early** — MAE after entry, distToLocalLow>0.75 ATR → add confirmation / delay to structure break.
4. **Entered too late** — entryPx−localExtreme>2 ATR → advance trigger / limit entries.
5. **Exit too tight** — target-exit, price continues ≥0.5·MFE, exitEff<0.5 → raise target / trail.
6. **Exit too loose** — gave back >40% of MFE → tighten trail / partial TP.
7. **Whipsaw in chop** — cluster of small |netRet| in low-ADX/low-vol → regime/vol-floor filter, entry hysteresis.
8. **Gap-through-stop** — |open−prevClose|>stopDist, filled worse → cap overnight size, defined-risk, avoid event bars (EDGAR/Finnhub calendar).
9. **Regime mismatch** — win-rate/expectancy significantly worse in a regime bucket (χ²/bootstrap) → regime conditioner on entry.
10. **Signal conflict** — entrySignals disagree (e.g. long vs HTF-down) & poor expectancy → multi-timeframe alignment filter.
11. **Oversized in vol** — losers cluster in high-rv bars; corr(entryATR,|loss|) high → vol-targeted sizing.
12. **Crowded/slippage-eaten** — costs>0.3·|grossPnl| or edge dies at 2× slippage → reduce frequency / min-edge filter / liquid symbols.
13. **Missed-the-move** — filter blocked a signal whose forward return was large (needs rejected-signal log) → loosen over-strict filter (recover recall).
14. **Held-a-loser (disposition)** — avg hold(losers)>hold(winners), early stop breached → hard stop / max-adverse-hold.
Each hit → a **MistradeRecord** (§10) with evidence, degraded metric, and a concrete BotSpec-node fix.

---

## 7. THE ~11 INTERNAL TESTERS (inputs → algo → output → weakness exposed)
T1 **Walk-Forward** (rolling anchored IS/OOS, stitch OOS equity → WFE) — overfit to a static window. T2 **CPCV→PBO+DSR** (combinatorial purged CV w/ purge+embargo) — selection/multiple-testing overfit (strongest gate). T3 **Parameter sensitivity** (1-D sweeps + top-2 2-D grid, plateau-width) — fragile params (cliff vs plateau). T4 **Regime-conditional** (label trend×vol[×macro], per-regime expectancy+bootstrap CI) — regime dependence. T5 **Meta-label lift** (in-JS logistic/stumps on entry features → precision-at-top-decile, filtered equity) — a learnable filter the rules miss. T6 **Monte-Carlo/synthetic** (trade-order bootstrap + block bootstrap + synthetic OHLC re-run → P5/P50/P95 DD, P(ruin)) — luck vs skill / sequence risk. T7 **Capacity/impact** (√-law slippage vs AUM → capacity curve) — toy-size-only edge. T8 **MAE/MFE efficiency** (optimal stop where marginal stopped-winner loss = saved-loser gain; optimal target from MFE dist) — exit/stop mis-parameterization. T9 **Equity trend + residuals** (OLS log-equity, R², runs test, structural-break/Chow → decay date) — decaying/lumpy edge. T10 **Benchmark/factor attribution** (multi-OLS vs momentum/vol/size proxies) — repackaged factor beta, no alpha. T11 **Exit-reason decomposition** (per exitReason expectancy+MFE-capture) — which exit path bleeds money.

---

## 8. STRENGTHS PASS (symmetric, single-pass)
Best regime (T4, bootstrap-significant, n≥20); best trade cluster (k-means on entry features → highest expectancy·√n = the "sweet-spot setup"); **genuine-edge gate** (DSR/PSR≥0.95 & positive OOS → "statistically supported" vs "unproven"); most-predictive signal (rank-IC/meta-importance); robustness wins (params on a plateau, low PBO, tight MC band → "safe to leave alone"); cost resilience (survives 2× slippage). Feeds the report's "keep" section AND a **regression guard**: any ActionCard whose re-backtest degrades a listed strength is auto-flagged `⚠ breaks-strength`.

---

## 9. COMPUTE-ON-DEMAND METRIC REGISTRY (never says "no")
Each metric is a descriptor `{ id, aliases, category, needs[], params, formula(string), compute(run,ctx), interpret(v,ctx)→{verdict,diagnosis,threshold}, goodDirection }`. Resolution ladder: (1) lookup by id/fuzzy-alias; (2) topo-resolve `needs` (deps are artifact fields or other metrics, recurse+cache); (3) **derive missing inputs** (R_bar from equity, MAE/MFE from OHLC, synth entryScore from rule strength, fetch benchmark); (4) **graceful degradation** — truly-absent hard input → `PartialResult{status:'unavailable', reason, proxy, proxyValue}` (always offers the closest computable proxy, never refuses); (5) **novel metric** — accept a `{formula,needs}` payload from Gemini, validate needs against the derive graph, evaluate via the same safe DSL used for BotSpec (so "ratio of Sortino to Ulcer" composes two descriptors); (6) every result carries `{value, inputsUsed, wasDerived, confidence, missing[]}`. It's a small computer-algebra layer over the run, not a lookup table.

---

## 10. REASONED RECORD SCHEMAS
**TradeRecord** (per executed trade): outcome, netRet, rMultiple, excursion{mae,mfe,tMFE,ttfe,entryEff,exitEff,wastedProfit}, context{regime,entrySignals,exitReason,costs}, classification{entryProb?,label}, quality{contribToExpectancy,isTailEvent}, flags[taxonomy hits], narrative(one-line plain-English).
**MistradeRecord** (per weakness instance/theme): `{ type, scope(single|cluster|systemic), tradeIds[], what, why, evidence{stat,value,n,comparison,test}, metricsDegraded[{metric,current,estimatedIfFixed}], severity, dollarImpact{estimate,method}, diagnosisTree{confirmedBy[],refutedBy[],rootCause,justification}, fixHypothesis{botspecChange,staged[],predictedMetricDeltas(honest tradeoffs),risk}, confidence, targetMetricStamp }`.
**Confidence formula:** `.3·sampleAdequacy(n) + .3·testSignificance(1−p) + .25·testerAgreement(k/total) + .15·(1−paramSensitivity)`, clamped. A fix backed by 4 testers on 60 trades outranks a 5-trade hunch. Gates "recommended" vs "investigate."

---

## 11. GROUPING / SORTING / CLUSTERING (5-axis tags + index)
Every error record gets `Tag{theme, metricDegraded[], fixType, severity(1-5), dollarImpact, confidence}`. **NodeIndex**: `byClaimHash` (dedup), `byTheme`, **`byMetric`** (the headline "show all Calmar-hurting errors"), `byFixType`, `bySeverity` (sorted), `embeddings` (HNSW-lite "find similar errors"). Clustering: hard-bucket by `(theme × primaryMetric)` then soft agglomerative-merge on claim embeddings (collapse restatements); cluster stores overlap-corrected aggregate $impact. SQLite mirror `node_tags(node_id, axis, value)` + covering indexes → agent filters are single indexed queries.

---

## 12. KNOWLEDGE LAYER (our quant library first, then reason, then web)
Router: (1) **LOCAL** — our 53-file quant library (`Desktop\quant project\`, anchors López de Prado/Chan/Carver/Natenberg/etc.) + Metric Registry formulas [free, instant, cited]; (2) **REASON** — `callGemini` closed-book, grounded in local top-K, for hypotheses/synthesis [credit]; (3) **RETRIEVE→WEB** — WebSearch/WebFetch for a formula/technique we lack [credit+latency]. Policy: **facts/formulas → retrieve (local first, web second); judgment → reason. Never let Gemini invent a formula the registry can derive or the web can cite.** Cache w/ provenance `{source, citation?, computedFrom[], confidence, ttl}` (formulas permanent, web facts TTL'd).

---

## 13. THE DEDICATED ANALYSIS AGENT (scoped, never-say-no)
A Jarvis fork whose whole world is ONE run's artifacts `{tree, ledger, clusters, report, cards, run, spec}` — cannot see other strategies/users/global state. Tools: `queryTree({filter})`, `queryLedger({where})`, `computeMetric({id,scope})` (the never-no path), `runTester({kind,params})` (spawn a live tester node), `proposeFix({nodeId})`, `applyAndBacktest({cardId})`, `explainNode({id})`, `citeKnowledge({need})`. Protocol: Gemini plans tool calls grounded in the artifact summary; if `computeMetric` misses → Knowledge route finds/derives formula → computes → continues; if anything can't fully resolve → degrade to the closest computable answer + explicit reasoning about the gap + what data would resolve it. Every answer ends with provenance chips. **"What's my Ulcer Index?"** (not first-class) → registry derives it live, shows the formula. **"Fix it"** → propose→apply→before/after 12 metrics + strength-break flags.

---

## 14. REPORT + CUSTOM ACTION CARDS
`ActionCard{ id, sourceNodeId, title, targetedMetrics[] /*the stamp*/, mutation(BotSpecPatch), expectedDelta[] (from the counterfactual replay that birthed it — oracle-grounded, not a guess), risk(low/med/high from confidence×overfit-proximity×strength-collision), rationale(→reason chain+provenance), stage, status, beforeAfter?, breaksStrength? }`. Primary UI axis = **filter/sort by targetedMetrics** (AUC/Brier/Calmar/Sortino/tail/maxDD/…). One-click **apply→re-backtest** clones spec, applies patch, runs the SAME oracle, diffs all metrics + equity side-by-side (revertible). **Adaptive staging:** topo-sort by mutation-conflict graph → within stage order by expectedΔ$ desc, risk asc → after each applied stage re-run a diagnosis DELTA to re-price/retire downstream cards (a later fix may become unnecessary). Surfaces: Diagnosis-Tree view (r3f/DOM, nodes colored by verdict, sized by $impact), Cluster board (kanban by theme, metric chips), Action-Cards deck (sortable/stageable), Metric cockpit (live deltas), Agent dock.

---

## 15. STACK INTEGRATION + FEATURE UPLIFT
Substrate map: strategy=BotSpec AST; mutations=serializable BotSpecPatch; **oracle**=client-side JS backtest; parallel node eval=**Web-Worker pool** (each worker owns a cloned engine for counterfactual replays → 400-node investigation in bounded wall-clock); reasoning=callGemini; persistence=better-sqlite3 (`diag_node, ledger_row, node_tags, cluster, report, action_card, knowledge_cache, metric_def`, keyed by runHash); 3D=the r3f Oracle repurposed as the spatial tree/landscape renderer; knowledge=quant library + web + registry.

THE IMPROVER is the **shared diagnostic kernel** — one ledger, one oracle harness, one metric registry, one clustering index — so the 8 features stop re-deriving substrate and get faster + more advanced:
- **Regime Radar** ← L1 regime segmentation + per-regime ledger attribution (free).
- **Overfitting Sentinel** ← becomes a *tester kind* (T2/DSR/PBO) the tree already spawns; consumes the sensitivity table.
- **Meta-Labeler** ← ledger `mistrade/nearMiss` rows + `contextSnapshot` = a labeled dataset out of the box.
- **Darwin** ← ActionCard `mutation` patches + oracle re-backtest = ready mutation+fitness operator; seeds its population from IMPROVER's cards (directed → converges faster).
- **Terraform** ← metric-sensitivity + counterfactual sweeps already probe the neighborhood; renders the cached landscape in the same r3f surface.
- **Prospector** ← the Knowledge Layer's web/provenance pipeline; unexplained residual-$impact nodes become its search targets.
- **Portfolio Forge/HRP** ← per-strategy ledger + equity-correlation + strengths list define sleeves & weights.
- **Genesis** ← runs IMPROVER as its inner-loop critic/fitness/repair oracle (draft→diagnose→cards-as-constraints→regenerate).

---

## 16. BUILD PLAN (phased — kernel first, features consume it)
- **K0 · Substrate** — canonical Run artifact + the per-trade **Ledger** (excursions, regime tags, rule-firing attribution) + **Metric Registry** (start ~25 metrics with interpret()) + metric-sensitivity table. *Everything else needs this.*
- **K1 · Testers** — the 11 testers as pure functions over Ledger+oracle (T4 regime, T8 MAE/MFE, T11 exit-reason, T1 walk-forward, T2 CPCV/PBO/DSR, T6 MC first; rest next).
- **K2 · Diagnosis-tree engine** — node/frontier/priority/confidence/dedup/budget + the 5 tester-kind expanders + Web-Worker pool.
- **K3 · Grouping + Strengths + Synthesis** — 5-axis tags, clustering, strengths pass, report assembly + ActionCards (metric-stamped, adaptive staging, apply→re-backtest).
- **K4 · Knowledge Layer + Metric Registry never-no** — quant-library index + web fallback + provenance.
- **K5 · The Analysis Agent** — scoped Jarvis fork, 8 tools, never-no protocol.
- **K6 · The Analysis Panel UI** — tree view (r3f) + cluster board + cards deck + metric cockpit + agent dock.
- **Then** the 8 features fold in as consumers (§15).

Persist artifacts in SQLite; gate every recommended fix through T1/T2 (no fix is "recommended" if it wouldn't survive out-of-sample). ATR-normalize all thresholds. DSR/PBO are the overfit gates.
