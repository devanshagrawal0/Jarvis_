// P2·W7 Lattice branch-intelligence test. Run: node server/eclipse/evals/test-lattice.js
// Deterministic (scripted generate/score). Zero Gemini.
const assert = require("assert");
const { selectPolicy, explore, branchValue, prune, targetedRepair, pickBest } = require("../reasoning/lattice");

let pass = 0;
const okA = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.stack || e.message); process.exitCode = 1; } };

(async () => {
  console.log("ECLIPSE P2·W7 — Lattice branch intelligence");

  await okA("policy router picks by difficulty + budget", () => {
    assert.equal(selectPolicy({ depth: 0.5 }).policy, "direct");
    assert.equal(selectPolicy({ depth: 2 }).policy, "beam");
    assert.equal(selectPolicy({ depth: 3 }).policy, "tree");
    assert.equal(selectPolicy({ consequence: 0.8 }).policy, "debate");
    assert.equal(selectPolicy({ ambiguity: 0.7 }).policy, "counterfactual");
    assert.equal(selectPolicy({ depth: 3 }, { budgetRemaining: 2 }).policy, "direct", "no budget → no branching");
  });

  await okA("branchValue = quality/cost; prune keeps top-k above minValue", () => {
    assert.ok(branchValue({ score: 0.9, cost: 1 }) > branchValue({ score: 0.9, cost: 4 }));
    const kept = prune([{ id: "a", score: 0.9, cost: 1 }, { id: "b", score: 0.2, cost: 1 }, { id: "c", score: 0.8, cost: 1 }], { keep: 2 });
    assert.deepEqual(kept.map((k) => k.id), ["a", "c"]);
  });

  await okA("beam explore returns the highest-scoring candidate", async () => {
    // generate makes 3 children with ids encoding a score; score reads it.
    const generate = (n) => (n.depth >= 1 ? [] : [{ id: "x1", q: 0.3 }, { id: "x2", q: 0.9 }, { id: "x3", q: 0.6 }]);
    const score = (n) => n.q ?? 0.5;
    const r = await explore({ policy: "beam", width: 3, depth: 1, root: { id: "root", q: 0.5 }, generate, score, budget: 40 });
    assert.equal(r.best.id, "x2");
    assert.ok(r.spent > 0 && r.explored.length >= 4);
  });

  await okA("tree explore deepens and still finds the best leaf", async () => {
    const generate = (n) => (n.depth >= 2 ? [] : [{ id: n.id + ".a", q: (n.q ?? 0.5) + 0.05 }, { id: n.id + ".b", q: (n.q ?? 0.5) - 0.1 }]);
    const score = (n) => Math.min(1, n.q ?? 0.5);
    const r = await explore({ policy: "tree", width: 3, depth: 2, root: { id: "r", q: 0.6 }, generate, score, budget: 60 });
    assert.ok(r.best.q >= 0.6, "best improves with depth");
    assert.equal(r.policy, "tree");
  });

  await okA("debate picks the winner between opposing candidates", async () => {
    const generate = () => [{ id: "for", q: 0.4 }, { id: "against", q: 0.85 }];
    const score = (n) => n.q ?? 0.5;
    const r = await explore({ policy: "debate", root: { id: "root" }, generate, score, budget: 20 });
    assert.equal(r.best.id, "against");
  });

  await okA("counterfactual compares original vs negated assumption", async () => {
    const generate = () => [{ id: "cf", q: 0.9 }];
    const score = (n) => n.q ?? 0.5;
    const r = await explore({ policy: "counterfactual", root: { id: "orig", q: 0.5 }, generate, score, budget: 20 });
    assert.equal(r.best.id, "cf", "counterfactual beats the weaker original");
  });

  await okA("explore respects the budget ceiling", async () => {
    let calls = 0;
    const generate = (n) => (n.depth >= 3 ? [] : [{ id: "a" + calls }, { id: "b" + calls }]);
    const score = () => { calls++; return 0.5; };
    const r = await explore({ policy: "tree", width: 5, depth: 5, root: { id: "r" }, generate, score, budget: 8 });
    assert.ok(r.spent <= 9, `spent ${r.spent} within budget+1`);
  });

  await okA("targetedRepair re-runs only the failing unit until it verifies", async () => {
    let n = 0;
    const regenerate = () => ({ id: "fix", ok: ++n >= 2 }); // fixed on the 2nd attempt
    const verify = (r) => ({ pass: !!r.ok, reason: r.ok ? "ok" : "still failing" });
    const rep = await targetedRepair({ node: { id: "bad", ok: false }, regenerate, verify, maxAttempts: 3 });
    assert.equal(rep.repaired, true);
    assert.equal(rep.attempts, 2);
    assert.equal(rep.history.length, 3); // initial + 2 attempts
  });

  await okA("targetedRepair gives up after maxAttempts (honest failure)", async () => {
    const rep = await targetedRepair({ node: { ok: false }, regenerate: () => ({ ok: false }), verify: (r) => ({ pass: !!r.ok }), maxAttempts: 2 });
    assert.equal(rep.repaired, false);
    assert.equal(rep.attempts, 2);
  });

  console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
})();
