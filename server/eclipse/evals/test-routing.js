// P1·W2 gate test — smart routing. Run: node server/eclipse/evals/test-routing.js
// Pure/local/deterministic: no Gemini, no DB. Verifies each worked-example prompt routes to
// the expected tier (the "normal prompts stay cheap" contract). Exit 1 on any mismatch.
const assert = require("assert");
const { classify } = require("../routing/eligibility");
const cases = require("./fixtures/routing");

let pass = 0, fail = 0;
console.log("ECLIPSE P1·W2 — smart routing");
for (const c of cases) {
  const d = classify(c.prompt);
  const label = `[${d.tier}] "${c.prompt}"`;
  try {
    assert.equal(d.tier, c.expect);
    pass++;
    console.log(`  ✓ ${label}  (score ${d.score}, ${d.stage})`);
  } catch {
    fail++;
    process.exitCode = 1;
    console.error(`  ✗ ${label} — expected ${c.expect}, got ${d.tier} · ${d.stage} · score ${d.score}`);
    console.error(`      genome:`, JSON.stringify(d.genome), `\n      reasons:`, d.reasons.join(" | "));
  }
}

// A couple of invariants beyond the table:
function inv(name, fn) { try { fn(); pass++; console.log("  ✓", name); } catch (e) { fail++; process.exitCode = 1; console.error("  ✗", name, "\n     ", e.message); } }
inv("missions can be globally disabled (flag off → never above pulse)", () => {
  const d = classify("research the competitive landscape for AI trading copilots and draft a brief", { allowMissions: false });
  assert.ok(d.tier === "pulse" || d.tier === "cortex", `got ${d.tier}`);
});
inv("memory-answerable question deflates the score", () => {
  const cold = classify("compare LangGraph vs CrewAI for our runtime");
  const warm = classify("compare LangGraph vs CrewAI for our runtime", { answerableFromMemory: 1 });
  assert.ok(warm.score <= cold.score, `warm ${warm.score} > cold ${cold.score}`);
});
inv("consequence gate flags approval and does not fan out", () => {
  const d = classify("email the board my Q3 summary");
  assert.equal(d.tier, "pulse");
  assert.equal(d.requiresApproval, true);
});

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ", 0 failed"}`);
