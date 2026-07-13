// P1·W5 tools + memory resonance test. Run: node server/eclipse/evals/test-tools.js
// Calc + Code are REAL local execution; Web/Citation are fixture-deterministic. Zero Gemini.
const assert = require("assert");
const { createToolbox, calcReproduce, codeExec, tokenOverlap } = require("../tools");
const { rankRRF, reflexionNote, selfRAGCheck } = require("../memory/resonance");

let pass = 0;
const okA = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.stack || e.message); process.exitCode = 1; } };

(async () => {
  console.log("ECLIPSE P1·W5 — tools & memory resonance");

  await okA("Calc Reproducer really computes + detects a mismatch", () => {
    assert.equal(calcReproduce({ expression: "2*(3+4)" }).value, 14);
    assert.equal(calcReproduce({ expression: "100*0.15", expected: 15 }).matches, true);
    assert.equal(calcReproduce({ expression: "100*0.15", expected: 14 }).matches, false);
    assert.ok(Math.abs(calcReproduce({ expression: "Math.sqrt(144)" }).value - 12) < 1e-9);
    assert.throws(() => calcReproduce({ expression: "require('fs')" }), /unsafe/); // injection blocked
  });

  await okA("Code Sandbox runs JS, captures result/stdout, and is fault-isolated", () => {
    const r = codeExec({ code: "result = [1,2,3].reduce((a,b)=>a+b,0); console.log('sum', result);" });
    assert.equal(r.ok, true); assert.equal(r.result, 6); assert.ok(r.stdout.includes("sum 6"));
    const bad = codeExec({ code: "throw new Error('boom')" });
    assert.equal(bad.ok, false); assert.ok(/boom/.test(bad.error));
    const noReq = codeExec({ code: "result = typeof require" });
    assert.equal(noReq.result, "undefined", "no require in sandbox");
  });

  await okA("Web Reader returns live for known fixtures, dead otherwise", async () => {
    const tb = createToolbox({ fixtures: { "https://x/a": { text: "hello evidence world" } } });
    const live = await tb["web.fetch"].run({ url: "https://x/a" });
    assert.equal(live.live, true); assert.ok(live.excerpt.includes("evidence"));
    const dead = await tb["web.fetch"].run({ url: "https://x/missing" });
    assert.equal(dead.live, false);
  });

  await okA("Citation Verifier confirms supported quotes, flags unsupported/dead", async () => {
    const tb = createToolbox({ fixtures: { "https://x/a": { text: "The sky is blue because of Rayleigh scattering." } } });
    const good = await tb["citation.verify"].run({ url: "https://x/a", quote: "sky is blue because of rayleigh" });
    assert.equal(good.supported, true); assert.equal(good.live, true);
    const bad = await tb["citation.verify"].run({ url: "https://x/a", quote: "the moon is made of cheese" });
    assert.equal(bad.supported, false);
    const dead = await tb["citation.verify"].run({ url: "https://x/gone", quote: "anything" });
    assert.equal(dead.live, false); assert.equal(dead.supported, false);
  });

  await okA("Memory Resonance RRF ranks the relevant doc first", () => {
    const corpus = [
      { id: "m1", text: "LangGraph durable checkpoints SqliteSaver crash recovery" },
      { id: "m2", text: "cooking pasta with tomato sauce and basil" },
      { id: "m3", text: "React hooks useState useEffect component lifecycle" },
    ];
    const top = rankRRF("durable checkpoint recovery in langgraph", corpus, 2);
    assert.equal(top[0].id, "m1");
    assert.ok(top[0].reason.includes("lexical"));
  });

  await okA("Reflexion note + Self-RAG grounding check", () => {
    const note = reflexionNote({ taskSignature: "compare-frameworks", failure: "cited a dead link", lesson: "verify liveness first" });
    assert.equal(note.kind, "reflexion");
    assert.equal(selfRAGCheck("x", [{ entailment: 0.8 }]).grounded, true);
    assert.equal(selfRAGCheck("x", []).needsMore, true);
    assert.equal(selfRAGCheck("x", [{ entailment: 0.2 }]).grounded, false);
  });

  console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
})();
