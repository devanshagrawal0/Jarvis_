// ECLIPSE Lattice branch intelligence (P2·W7). When a subtask is hard/contested, exploring a
// single chain is fragile — the Lattice explores a small tree of candidates, scores them,
// prunes by expected value, and returns the best. The reasoning is provider-agnostic: callers
// inject generate() (produce candidates) and score() (rate a candidate), so this is fully
// deterministic and zero-Gemini in tests; in production those are model calls.
//
//   selectPolicy → pick beam/tree/debate/counterfactual/direct from difficulty + budget
//   explore      → run the chosen policy, budget-bounded, with economic pruning
//   targetedRepair → smallest-subgraph fix: re-run ONLY the failing node until a verifier passes

// ── Policy router ────────────────────────────────────────────────────────────────────────
// signals: { depth, consequence, ambiguity, contested } (0..1-ish) + budgetRemaining (calls)
function selectPolicy(signals = {}, { budgetRemaining = 20 } = {}) {
  const depth = signals.depth || 0, consequence = signals.consequence || 0, ambiguity = signals.ambiguity || 0, contested = signals.contested || 0;
  if (budgetRemaining < 3) return decision("direct", 1, 1, "budget too low to branch");
  if (consequence >= 0.7 || contested >= 0.6) return decision("debate", 2, 1, "high-consequence/contested → argue both sides + judge");
  if (ambiguity >= 0.6) return decision("counterfactual", 2, 1, "ambiguous → test a competing assumption");
  if (depth >= 3) return decision("tree", 3, 2, "deep problem → widen + deepen the search");
  if (depth >= 1.5) return decision("beam", 3, 1, "moderate → keep the best of a few candidates");
  return decision("direct", 1, 1, "simple → a single pass is enough");
}
function decision(policy, width, depth, reason) { return { policy, width, depth, reason }; }

// ── Branch economics ─────────────────────────────────────────────────────────────────────
// Expected value of pursuing a node: quality per unit cost. Prune anything below the frontier.
function branchValue(node) {
  const score = node.score ?? 0, cost = node.cost ?? 1;
  return score / (1 + cost);
}
function prune(nodes, { keep, minValue = 0 }) {
  const ranked = nodes.map((n) => ({ n, v: branchValue(n) })).filter((x) => x.v >= minValue).sort((a, b) => b.v - a.v);
  return ranked.slice(0, keep).map((x) => x.n);
}

// ── Explorer ─────────────────────────────────────────────────────────────────────────────
// opts: { policy, width, depth, root, generate(node)->[children], score(node)->0..1, budget }
// generate/score may be async. Returns { best, explored, spent, policy }.
async function explore(opts) {
  const { root, generate, score } = opts;
  const width = opts.width || 3, depth = opts.depth || 1, policy = opts.policy || "beam";
  let budget = opts.budget ?? 40;
  const explored = [];
  const spend = () => { budget -= 1; };

  async function evalNode(n) { spend(); n.score = await score(n); n.cost = n.cost ?? 1; explored.push(n); return n; }
  async function expand(n) { spend(); const kids = (await generate(n)) || []; return kids.map((k) => ({ ...k, parent: n.id, depth: (n.depth || 0) + 1 })); }

  root.depth = 0;
  if (policy === "direct") { await evalNode(root); return done(root, root); }

  if (policy === "debate") {
    // Generate opposing candidates, score each (the "judge"), take the winner.
    const cands = await expand({ ...root, stance: "for" });
    for (const c of cands) { if (budget <= 0) break; await evalNode(c); }
    const best = pickBest(cands.length ? cands : [root]);
    return done(best, root);
  }

  if (policy === "counterfactual") {
    // Original + a candidate that negates the key assumption; keep whichever verifies better.
    const cands = await expand({ ...root, mode: "counterfactual" });
    await evalNode(root);
    for (const c of cands) { if (budget <= 0) break; await evalNode(c); }
    return done(pickBest([root, ...cands]), root);
  }

  // beam / tree: level-by-level frontier expansion with economic pruning.
  let frontier = [root];
  await evalNode(root);
  for (let d = 0; d < depth && budget > 2; d++) {
    let children = [];
    for (const node of frontier) { if (budget <= 1) break; children.push(...(await expand(node))); }
    for (const c of children) { if (budget <= 0) break; await evalNode(c); }
    if (!children.length) break;
    const keep = policy === "tree" ? width : Math.max(1, Math.ceil(width / 2));
    frontier = prune(children, { keep, minValue: 0.01 });
  }
  return done(pickBest(explored), root);

  function done(best, r) { return { best, explored, spent: (opts.budget ?? 40) - budget, policy, rootId: r.id }; }
}
function pickBest(nodes) { return nodes.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] || null; }

// ── Verifier-guided targeted repair ────────────────────────────────────────────────────────
// Re-run ONLY the failing unit (smallest subgraph) until a verifier passes or attempts run out.
// regenerate(prevResult, attempt) -> newResult ; verify(result) -> { pass, reason }
async function targetedRepair({ node, regenerate, verify, maxAttempts = 2 }) {
  let result = node, attempts = 0, last = await verify(node);
  const history = [{ attempt: 0, ...last }];
  while (!last.pass && attempts < maxAttempts) {
    attempts += 1;
    result = await regenerate(result, attempts);
    last = await verify(result);
    history.push({ attempt: attempts, ...last });
  }
  return { repaired: last.pass, result, attempts, history };
}

module.exports = { selectPolicy, explore, branchValue, prune, targetedRepair, pickBest };
