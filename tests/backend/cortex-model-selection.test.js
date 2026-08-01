const test = require("node:test");
const assert = require("node:assert/strict");

const { MODELS, resolveCortexExecution } = require("../../server/gemini-models");

test("Cortex Eco uses the main model with minimal thinking", () => {
  assert.deepEqual(resolveCortexExecution({ model: "cortex", strength: "cost-guarded" }), {
    product: "cortex",
    strength: "cost-guarded",
    forceModel: MODELS.main,
    thinkingLevel: "minimal",
    migratedFromPrime: false,
  });
});

test("Cortex Balanced uses the main model with medium thinking", () => {
  const execution = resolveCortexExecution({ model: "cortex", strength: "balanced" });
  assert.equal(execution.forceModel, MODELS.main);
  assert.equal(execution.thinkingLevel, "medium");
  assert.equal(execution.migratedFromPrime, false);
});

test("Cortex Max absorbs the Pro and high-thinking benefit", () => {
  const execution = resolveCortexExecution({ model: "cortex", strength: "full" });
  assert.equal(execution.forceModel, MODELS.reasoning);
  assert.equal(execution.thinkingLevel, "high");
  assert.equal(execution.strength, "full");
});

test("legacy Cortex Prime requests migrate to Cortex Max", () => {
  const execution = resolveCortexExecution({ model: "cortex-prime", strength: "cost-guarded" });
  assert.equal(execution.product, "cortex");
  assert.equal(execution.strength, "full");
  assert.equal(execution.forceModel, MODELS.reasoning);
  assert.equal(execution.thinkingLevel, "high");
  assert.equal(execution.migratedFromPrime, true);
});
