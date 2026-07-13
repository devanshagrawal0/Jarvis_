// P1·W3 model-layer test — router + ledger + retry + adapter (stub). Run:
//   node server/eclipse/evals/test-model.js
// Pure/local/deterministic. ZERO Gemini (adapter runs in stub mode). Exit 1 on failure.
const assert = require("assert");
const { z } = require("zod");
const { modelForNode } = require("../model/capabilities");
const { createLedger, BudgetExceeded } = require("../model/cost-ledger");
const retry = require("../model/retry");
const { createAdapter } = require("../model/adapter");

let pass = 0;
const ok = (name, fn) => { Promise.resolve().then(fn).then(() => { pass++; console.log("  ✓", name); }, (e) => { console.error("  ✗", name, "\n     ", e.message); process.exitCode = 1; }); };
const okA = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.message); process.exitCode = 1; } };

(async () => {
  console.log("ECLIPSE P1·W3 — model layer");

  // 1. node→model routing
  await okA("modelForNode maps roles; commit is model-less", () => {
    assert.equal(modelForNode("plan").role, "reasoning");
    assert.equal(modelForNode("worker").role, "main");
    assert.equal(modelForNode("intake").role, "router");
    assert.equal(modelForNode("worker", "totality").thinking, "high"); // escalation
    assert.equal(modelForNode("worker", "deep").thinking, "medium");
    assert.equal(modelForNode("commit"), null);
    assert.ok(modelForNode("plan").modelId && typeof modelForNode("plan").modelId === "string");
  });

  // 2. cost ledger accrual + hard cap
  await okA("ledger accrues and trips hard cap", () => {
    const L = createLedger({ maxCostUsd: 1.0, maxTokens: 10000 });
    L.add({ node: "worker", tokensIn: 1000, tokensOut: 500, cost: { in: 0.30, out: 1.20 } });
    const s = L.snapshot();
    assert.equal(s.tokens, 1500);
    assert.ok(s.costUsd > 0 && s.costUsd < 0.01);
    assert.throws(() => L.assertWithinCap(20000, 0), BudgetExceeded); // token cap
    assert.throws(() => L.assertWithinCap(0, 5.0), BudgetExceeded);   // cost cap
    L.assertWithinCap(100, 0.001); // within → no throw
  });

  // 3. retry classification
  await okA("retry.classify: rate-limit / transient / bad-request / auth", () => {
    assert.equal(retry.classify({ status: 429 }, 0).kind, "rate_limit");
    assert.equal(retry.classify({ status: 429 }, 0).retry, true);
    const t = retry.classify({ status: 503 }, 1);
    assert.equal(t.kind, "transient"); assert.equal(t.retry, true); assert.equal(t.fallback, true);
    const b = retry.classify({ status: 400 }, 0);
    assert.equal(b.kind, "bad_request"); assert.equal(b.retry, false); assert.equal(b.fixDontRetry, true);
    assert.equal(retry.classify({ status: 403 }, 0).fatal, true);
    assert.ok(retry.classify({ status: 503 }, 2).backoffMs >= retry.classify({ status: 503 }, 0).backoffMs); // backoff grows
  });

  // 4. adapter stub run + ledger integration
  await okA("adapter stub run returns text and accounts usage", async () => {
    const L = createLedger({ maxCostUsd: 1, maxTokens: 100000 });
    const a = createAdapter({ mode: "stub", ledger: L });
    const r = await a.run({ node: "worker", input: "hello world" });
    assert.ok(r.text.startsWith("[stub:worker]"));
    assert.equal(r.role, "main");
    assert.ok(L.snapshot().tokens > 0);
  });

  // 5. structured-output validation + repair loop
  await okA("adapter repairs invalid structured output then validates", async () => {
    const schema = z.object({ answer: z.string(), score: z.number() });
    let n = 0;
    const stubResponder = (call) => {
      n++;
      // first call: bad (score missing); repair pass: good
      return call.repairPass
        ? { json: { answer: "ok", score: 0.9 }, usage: { tokensIn: 10, tokensOut: 5 } }
        : { json: { answer: "ok" }, usage: { tokensIn: 10, tokensOut: 5 } };
    };
    const a = createAdapter({ mode: "stub", stubResponder });
    const r = await a.run({ node: "verify", input: "judge", schema });
    assert.deepEqual(r.json, { answer: "ok", score: 0.9 });
    assert.equal(r.repaired, 1);
    assert.ok(n >= 2);
  });

  // 6. adapter gives up after repair budget → ECLIPSE_OUTPUT
  await okA("adapter throws ECLIPSE_OUTPUT when output never validates", async () => {
    const schema = z.object({ x: z.number() });
    const a = createAdapter({ mode: "stub", stubResponder: () => ({ json: { x: "not-a-number" } }) });
    await assert.rejects(() => a.run({ node: "verify", input: "j", schema }), (e) => e.code === "ECLIPSE_OUTPUT");
  });

  // 7. adapter retries transient errors then succeeds (no real sleep)
  await okA("adapter retries 503 then succeeds", async () => {
    let calls = 0;
    const stubResponder = () => { calls++; return calls <= 2 ? { throw: { status: 503 } } : { text: "recovered", usage: { tokensIn: 5, tokensOut: 5 } }; };
    const a = createAdapter({ mode: "stub", stubResponder, sleep: () => Promise.resolve() });
    const r = await a.run({ node: "worker", input: "x" });
    assert.equal(r.text, "recovered");
    assert.ok(calls === 3);
  });

  // 8. adapter refuses a call that would exceed the cap (pre-flight)
  await okA("adapter pre-flight cap refuses oversized call", async () => {
    const L = createLedger({ maxCostUsd: 1, maxTokens: 5 }); // absurdly tiny token cap
    const a = createAdapter({ mode: "stub", ledger: L });
    await assert.rejects(() => a.run({ node: "worker", input: "a much longer prompt than five tokens allows" }), (e) => e.code === "ECLIPSE_BUDGET");
  });

  // allow async oks to flush
  await new Promise((r) => setTimeout(r, 10));
  console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
})();
